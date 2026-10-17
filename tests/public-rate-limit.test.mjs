import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { config as auditConfig } from '../netlify/functions/website-audit.mjs';
import { config as checkoutConfig } from '../netlify/functions/package-checkout.mjs';
import {
  PUBLIC_QUOTAS,
  claimPublicQuota,
  cleanupExpiredQuotaClaims,
  enforcePublicQuota,
} from '../netlify/lib/public-rate-limit.mjs';

class AtomicStore {
  constructor() { this.values = new Map(); this.revision = 0; this.writes = 0; }
  async get(key) { return this.values.get(key)?.value ?? null; }
  async getWithMetadata(key) {
    const entry = this.values.get(key);
    return entry ? { data: entry.value, etag: entry.etag, metadata: entry.options.metadata } : null;
  }
  async set(key, value, options = {}) {
    if (options.onlyIfNew && this.values.has(key)) return { modified: false };
    const etag = `"${++this.revision}"`;
    this.values.set(key, { value, options, etag });
    this.writes += 1;
    return { modified: true, etag };
  }
  async setJSON(key, value, options = {}) {
    const existing = this.values.get(key);
    if (options.onlyIfNew && existing) return { modified: false };
    if (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
    if (options.onlyIfMatch && !existing) return { modified: false };
    const etag = `"${++this.revision}"`;
    this.values.set(key, { value, options, etag });
    this.writes += 1;
    return { modified: true, etag };
  }
  async delete(key) { this.values.delete(key); }
  async *list({ prefix = '' } = {}) {
    yield { blobs: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const hour = Date.UTC(2026, 9, 17, 4, 0, 0);
const secret = 'test-only-public-rate-limit-secret';

test('public acquisition quotas use deliberate one-hour ceilings', () => {
  assert.deepEqual(PUBLIC_QUOTAS.contact, { limit: 3, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS.booking, { limit: 3, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS.audit, { limit: 5, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS.checkout, { limit: 12, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS.analytics, { limit: 120, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS['nearby-businesses'], { limit: 30, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS['partner-api'], { limit: 240, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS['partner-auth'], { limit: 20, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS.portfolio, { limit: 120, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS['project-progress'], { limit: 300, windowSeconds: 3600 });
  assert.deepEqual(PUBLIC_QUOTAS['quote-payment'], { limit: 300, windowSeconds: 3600 });
});

test('the atomic counter enforces the hard quota and never places the raw IP in storage', async () => {
  const store = new AtomicStore();
  const ip = '203.0.113.42';
  const outcomes = [];
  for (let request = 0; request < 4; request += 1) {
    outcomes.push(await claimPublicQuota({ endpoint: 'contact', ip, now: hour, store, secret, requestId: `request-${request}` }));
  }

  assert.deepEqual(outcomes.map(({ allowed }) => allowed), [true, true, true, false]);
  assert.equal(outcomes[3].retryAfterSeconds, 3600);
  assert.equal([...store.values.keys()].some((key) => key.includes(ip)), false);
  assert.equal([...store.values.keys()].filter((key) => key.startsWith('quota/contact/')).length, 1);
  assert.equal(store.writes, 3);
});

test('concurrent attempts cannot over-claim a quota window', async () => {
  const store = new AtomicStore();
  const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) => claimPublicQuota({
    endpoint: 'booking',
    ip: '2001:db8::13',
    now: hour,
    store,
    secret,
    requestId: `concurrent-${index}`,
  })));

  assert.equal(outcomes.filter(({ allowed }) => allowed).length, PUBLIC_QUOTAS.booking.limit);
  assert.equal(outcomes.filter(({ allowed }) => !allowed).length, 7);
});

test('a new fixed window allows new requests and keeps endpoint quotas separate', async () => {
  const store = new AtomicStore();
  for (let request = 0; request < PUBLIC_QUOTAS.contact.limit; request += 1) {
    assert.equal((await claimPublicQuota({ endpoint: 'contact', ip: '198.51.100.8', now: hour, store, secret })).allowed, true);
  }
  assert.equal((await claimPublicQuota({ endpoint: 'booking', ip: '198.51.100.8', now: hour, store, secret })).allowed, true);
  assert.equal((await claimPublicQuota({ endpoint: 'contact', ip: '198.51.100.8', now: hour + 3600_000, store, secret })).allowed, true);
});

test('scheduled cleanup removes expired claims but preserves recent windows and the private salt', async () => {
  const store = new AtomicStore();
  await claimPublicQuota({ endpoint: 'contact', ip: '198.51.100.18', now: hour, store, secret });
  await claimPublicQuota({ endpoint: 'contact', ip: '198.51.100.18', now: hour + 3 * 3600_000, store, secret });
  await store.set('salt/v1', 'A'.repeat(43), { onlyIfNew: true });

  const result = await cleanupExpiredQuotaClaims({ store, now: hour + 4 * 3600_000 });
  assert.equal(result.deleted, 1);
  assert.equal([...store.values.keys()].filter((key) => key.startsWith('quota/contact/')).length, 1);
  assert.equal(store.values.has('salt/v1'), true);
});

test('bounded CAS contention fails closed instead of amplifying writes', async () => {
  const store = new AtomicStore();
  store.setJSON = async () => ({ modified: false });
  const result = await claimPublicQuota({
    endpoint: 'analytics', ip: '192.0.2.99', now: hour, store, secret, maxAttempts: 3,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.busy, true);
  assert.equal(result.retryAfterSeconds, 1);
  assert.equal(store.writes, 0);
});

test('quota enforcement returns a non-cacheable 429 with retry metadata', async () => {
  const store = new AtomicStore();
  const context = { ip: '192.0.2.24', requestId: 'netlify-request' };
  for (let request = 0; request < PUBLIC_QUOTAS.audit.limit; request += 1) {
    assert.equal(await enforcePublicQuota('audit', context, { now: hour, store, secret }), null);
  }
  const response = await enforcePublicQuota('audit', context, { now: hour, store, secret });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '3600');
  assert.equal(response.headers.get('x-ratelimit-limit'), '5');
  assert.equal(response.headers.get('x-ratelimit-remaining'), '0');
});

test('production requests fail closed when Netlify cannot supply a verified IP', async () => {
  const original = process.env.CONTEXT;
  process.env.CONTEXT = 'production';
  try {
    const response = await enforcePublicQuota('contact', {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    if (original === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = original;
  }
});

test('only the two expensive endpoints consume valid platform rate-limit rules', () => {
  assert.deepEqual(auditConfig.path, ['/api/website-audit', '/.netlify/functions/website-audit']);
  assert.deepEqual(auditConfig.rateLimit, {
    action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 180, windowLimit: 5,
  });
  assert.deepEqual(checkoutConfig.path, ['/api/checkout/package', '/.netlify/functions/package-checkout']);
  assert.deepEqual(checkoutConfig.rateLimit, {
    action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 12,
  });
});

test('every exported platform rate-limit rule has a path and a supported window', async () => {
  const directory = new URL('../netlify/functions/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.mjs'));
  const configured = [];
  for (const file of files) {
    const source = await readFile(new URL(file, directory), 'utf8');
    if (!/\brateLimit\s*:/.test(source)) continue;
    configured.push(file);
    assert.match(source, /export const config\s*=\s*\{[\s\S]*?\bpath\s*:/, file);
    const windows = [...source.matchAll(/\bwindowSize\s*:\s*(\d+)/g)].map((match) => Number(match[1]));
    assert.ok(windows.length > 0, file);
    assert.ok(windows.every((seconds) => seconds > 0 && seconds <= 180), file);
  }
  assert.deepEqual(configured.sort(), ['package-checkout.mjs', 'website-audit.mjs']);
});

test('handlers check method and origin before quota, then quota before parsing', async () => {
  const endpoints = [
    ['contact-submit.mjs', "enforcePublicQuota('contact'"],
    ['booking-submit.mjs', "enforcePublicQuota('booking'"],
    ['website-audit.mjs', "enforcePublicQuota('audit'"],
    ['package-checkout.mjs', "enforcePublicQuota('checkout'"],
  ];

  for (const [file, quotaCall] of endpoints) {
    const source = await readFile(new URL(`../netlify/functions/${file}`, import.meta.url), 'utf8');
    const method = source.indexOf("request.method !== 'POST'");
    const origin = source.indexOf('publicFeatureAccess(request)');
    const quota = source.indexOf(quotaCall);
    const body = source.indexOf('readBody(request');
    assert.ok(method >= 0 && method < origin, file);
    assert.ok(origin < quota, file);
    assert.ok(quota < body, file);
  }
});

test('legacy protected and storage-backed handlers enforce application quotas in safe order', async () => {
  const cases = [
    ['analytics-visit.mjs', 'publicFeatureAccess(request)', "enforcePublicQuota('analytics'", 'readBody(request'],
    ['nearby-businesses.mjs', 'assertCsrf(request, auth)', "enforcePublicQuota('nearby-businesses'", 'readBody(request'],
    ['partner-api.mjs', 'requireAccount(request, store)', "enforcePublicQuota('partner-api'", 'readBody(request'],
    ['partner-auth.mjs', 'assertSameOrigin(request)', "enforcePublicQuota('partner-auth'", 'readBody(request'],
    ['portfolio.mjs', "request.method !== 'GET'", "enforcePublicQuota('portfolio'", 'portalStore()'],
    ['project-progress.mjs', 'featureAccess(request)', "enforcePublicQuota('project-progress'", 'readBody(request'],
    ['quote-payment.mjs', 'featureAccess(request)', "enforcePublicQuota('quote-payment'", 'readBody(request'],
  ];

  for (const [file, gateText, quotaText, workText] of cases) {
    const source = await readFile(new URL(`../netlify/functions/${file}`, import.meta.url), 'utf8');
    const gate = source.indexOf(gateText);
    const quota = source.indexOf(quotaText);
    const work = source.indexOf(workText, quota);
    assert.ok(gate >= 0 && gate < quota, file);
    assert.ok(quota < work, file);
  }
});
