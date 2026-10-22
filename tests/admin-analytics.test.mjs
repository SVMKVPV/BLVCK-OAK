import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { aggregateAnalytics, analyticsRange, coarseTechnology, publicAnalyticsPath, readAnalyticsRows } from '../netlify/lib/site-analytics.mjs';
import { createTrafficHandler } from '../netlify/functions/owner-traffic.mjs';
import { createGa4Handler } from '../netlify/functions/owner-ga4.mjs';
import { createGa4Client, ga4Configuration, ga4ReportRequests } from '../netlify/lib/ga4-reports.mjs';
import { createSession, PortalError, requireAccount } from '../netlify/lib/portal-auth.mjs';
import { csvCell, formatMetric, metricLabels, periodChange, reportCsv, reportTotals } from '../analytics-utils.js';

const NOW = Date.parse('2026-10-23T03:00:00Z');
const request = (query = '') => new Request('https://blvckoak.com.au/.netlify/functions/owner-traffic' + query);
const account = { id: 'owner-1', email: 'owner@example.test', name: 'Owner' };
const configuredEnv = key => ({ GA4_PROPERTY_ID: '123456789', GA4_CLIENT_ID: 'test-client', GA4_CLIENT_SECRET: 'never-return-this-secret', GA4_REFRESH_TOKEN: 'never-return-this-token' })[key];

class MemoryStore {
  values = new Map();
  async setJSON(key, value) { this.values.set(key, value); }
  async get(key) { return this.values.get(key) || null; }
  async list({ prefix }) { return { blobs: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
}

test('both report endpoints require a verified owner before reading data, config or cached reports', async () => {
  for (const factory of [createTrafficHandler, createGa4Handler]) {
    let reads = 0;
    const store = new MemoryStore();
    const handler = factory({ getStore: () => store, authenticate: requireAccount, readRows: async () => { reads++; return { rows: [] }; }, env: () => { reads++; return ''; }, now: () => NOW });
    assert.equal((await handler(request())).status, 401);
    const previous = process.env.OWNER_AUTH_EMAIL;
    process.env.OWNER_AUTH_EMAIL = 'real-owner@example.test';
    try {
      await store.setJSON('account/' + account.id, { ...account, role: 'owner' });
      const { cookie } = await createSession(account, store);
      const response = await handler(new Request(request(), { headers: { cookie } }));
      assert.equal(response.status, 403);
      assert.equal(reads, 0);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    } finally { if (previous === undefined) delete process.env.OWNER_AUTH_EMAIL; else process.env.OWNER_AUTH_EMAIL = previous; }
  }
});

test('owner authorization is checked again for every cached request', async () => {
  let owner = true, reads = 0;
  const handler = createTrafficHandler({ getStore: () => ({}), authenticate: async () => ({ isOwner: owner }), now: () => NOW, readRows: async () => { reads++; return { rows: [], truncated: false, scanned: 0 }; } });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  owner = false;
  assert.equal((await handler(request())).status, 403);
  assert.equal(reads, 1);
});

test('date validation handles Sydney dates, exact comparisons and invalid input', () => {
  const range = analyticsRange(new URLSearchParams('days=7'), NOW);
  assert.equal(range.start, '2026-10-17'); assert.equal(range.end, '2026-10-23');
  assert.equal(range.previousStart, '2026-10-10'); assert.equal(range.previousEnd, '2026-10-16');
  for (const query of ['days=NaN', 'days=367', 'days=-1', 'start=2026-02-30&end=2026-03-01', 'start=2026-10-23&end=2026-10-22', 'start=2026-10-23&end=2027-01-01', 'device=forged', 'page=//evil.test?token=secret']) {
    assert.throws(() => analyticsRange(new URLSearchParams(query), NOW), PortalError);
  }
});

test('first-party reports separate interactions from views and retain unknown historical fields', () => {
  const range = analyticsRange(new URLSearchParams('start=2026-10-22&end=2026-10-23'), NOW);
  const rows = [
    { at: Date.parse('2026-10-21T14:00:00Z'), path: '/', visitor: 'a', source: 'Google' },
    { at: Date.parse('2026-10-23T02:40:00Z'), path: '/quote.html', visitor: 'a', event: 'page_view', device: 'mobile', country: 'Australia' },
    { at: Date.parse('2026-10-23T02:41:00Z'), path: '/quote.html', visitor: 'a', event: 'quote_click', device: 'mobile' },
    { at: Date.parse('2026-10-23T02:42:00Z'), path: '/', visitor: 'b', event: 'page_view', bot: true },
    { at: Date.parse('2026-10-20T01:00:00Z'), path: '/', visitor: 'c', event: 'page_view' },
  ];
  const result = aggregateAnalytics(rows, range, NOW);
  assert.deepEqual(result.summary, { views: 2, visitors: 1, interactions: 1 });
  assert.equal(result.previous.views, 1);
  assert.equal(result.timeline[0].views, 1);
  assert.equal(result.realtime.approximateVisitors, 1);
  assert.ok(result.devices.some(row => row.label === 'Unknown — earlier tracking'));
  const filtered = aggregateAnalytics(rows, { ...range, filters: { country: 'australia', device: 'mobile', page: '/quote' } }, NOW);
  assert.equal(filtered.summary.views, 1); assert.equal(filtered.summary.interactions, 0);
});

test('private paths, query strings, bots and raw User-Agent detail never enter aggregate reports', async () => {
  for (const path of ['/partners.html', '/analytics', '/pay?token=private', '/progress.html', '/oakpay-app.html', '/api/private', '/.netlify/functions/private', '//example.test', '/bad\\path']) assert.equal(publicAnalyticsPath(path), null);
  assert.equal(publicAnalyticsPath('/contact.html?email=private@example.test'), '/contact.html');
  assert.deepEqual(coarseTechnology('Mozilla/5.0 (iPhone; CPU iPhone OS 18) Mobile Safari/600.1'), { device: 'mobile', browser: 'Safari', bot: false });
  assert.equal(coarseTechnology('Googlebot/2.1').bot, true);
  const store = new MemoryStore();
  await store.setJSON('analytics-visit/100-c', { at: 100, path: '/analytics.html' });
  await store.setJSON('analytics-visit/102-c', { at: 102, path: '/' });
  await store.setJSON('analytics-visit/103-c', { at: 103, path: '/contact.html' });
  const data = await readAnalyticsRows(store, 2);
  assert.equal(data.truncated, true); assert.equal(data.rows.length, 2);
});

test('encoded private paths are excluded after decoding and dot-segment normalization', () => {
  for (const path of [
    '/partners%2ehtml', '/%70artners.html', '/partners%252ehtml', '/partners%25252ehtml',
    '/safe/../pay.html', '/safe/%2e%2e/%70rogress.html', '/safe%2f..%2fanalytics.html',
    '/%2fpartners.html', '/%5cpartners.html', '/%00public', '/bad%ZZ', '/API/partners',
    '/partners%2525252ehtml',
  ]) assert.equal(publicAnalyticsPath(path), null, path);
  for (const [supplied, expected] of [
    ['/public/../contact.html%3Femail=private@example.test%23token', '/contact.html'],
    ['/portfolio/caf%C3%A9%20design', '/portfolio/caf%C3%A9%20design'],
    ['/offers/50%25-off', '/offers/50%25-off'],
  ]) {
    assert.equal(publicAnalyticsPath(supplied), expected);
    assert.equal(publicAnalyticsPath(expected), expected, 'normalized paths must remain valid when read again');
  }
});

test('historical query and fragment values never appear in page reports or exports', async () => {
  const store = new MemoryStore();
  await store.setJSON(`analytics-visit/${NOW}-a`, { at: NOW, path: '/contact.html?email=private@example.test#secret', visitor: 'a' });
  await store.setJSON(`analytics-visit/${NOW}-b`, { at: NOW, path: '/safe/../partners%2ehtml', visitor: 'b' });
  const { rows } = await readAnalyticsRows(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, '/contact.html');
  const result = aggregateAnalytics(rows, analyticsRange(new URLSearchParams('days=1'), NOW), NOW);
  assert.deepEqual(result.pages, [{ label: '/contact.html', count: 1 }]);
  const csv = reportCsv({ columns: ['Page', 'Views'], rows: result.pages.map(row => [row.label, row.count]) });
  assert.doesNotMatch(JSON.stringify(result) + csv, /private@example|secret|partners/);
});

test('website reports remain available without Stripe or Google credentials', async () => {
  const handler = createTrafficHandler({ getStore: () => ({}), authenticate: async () => ({ isOwner: true }), now: () => NOW, readRows: async () => ({ rows: [], truncated: false, scanned: 0 }) });
  const response = await handler(request());
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.summary.views, 0); assert.equal(data.source, 'first_party');
});

test('unconfigured Google reports return setup names without credentials or fake data', async () => {
  let called = false;
  const handler = createGa4Handler({ getStore: () => ({}), authenticate: async () => ({ isOwner: true }), env: () => '', now: () => NOW, runReports: async () => { called = true; } });
  const response = await handler(request()); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.connected, false); assert.equal(called, false);
  assert.deepEqual(data.missing, ['GA4_PROPERTY_ID', 'GA4_CLIENT_ID', 'GA4_CLIENT_SECRET', 'GA4_REFRESH_TOKEN']);
  assert.equal(data.reports, undefined);
  assert.equal(ga4Configuration(key => key === 'GA4_PROPERTY_ID' ? 'G-123ABC' : 'set').configured, false);
});

test('Google report definitions bound rows, currency and date filters; realtime excludes historical dates', () => {
  const range = analyticsRange(new URLSearchParams('days=7&country=Australia&device=mobile&page=%2Fwebsites'), NOW);
  const definitions = ga4ReportRequests(range);
  const timeline = definitions.find(report => report.id === 'timeline');
  assert.equal(timeline.body.limit, '366'); assert.equal(timeline.body.currencyCode, 'AUD');
  const realtime = definitions.find(report => report.id === 'realtime');
  assert.equal(realtime.body.dateRanges, undefined);
  assert.equal(realtime.body.dimensionFilter.andGroup.expressions.length, 2);
  assert.equal(definitions.find(report => report.id === 'previous').body.dateRanges[0].endDate, '2026-10-16');
});

test('GA4 client uses server credentials only, handles partial report failure and reuses access tokens', async () => {
  let tokens = 0, reports = 0;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2')) { tokens++; return Response.json({ access_token: 'private-access-token', expires_in: 3600 }); }
    reports++;
    if (JSON.parse(options.body).dimensions?.[0]?.name === 'itemName') return Response.json({ error: { message: 'sensitive upstream detail' } }, { status: 400 });
    return Response.json({ dimensionHeaders: [], metricHeaders: [{ name: 'activeUsers' }], rows: [{ metricValues: [{ value: '7' }] }], rowCount: 1 });
  };
  const run = createGa4Client({ fetcher, now: () => NOW });
  const config = ga4Configuration(configuredEnv), range = analyticsRange(new URLSearchParams('days=7'), NOW);
  const results = await run(config, range); await run(config, range);
  assert.equal(tokens, 1); assert.equal(reports, 30);
  assert.ok(results.find(report => report.id === 'commerce').error);
  assert.deepEqual(results.find(report => report.id === 'summary').rows, [[7]]);
  assert.ok(calls.filter(call => call.url.includes('analyticsdata')).every(call => call.options.headers.Authorization === 'Bearer private-access-token'));
  assert.ok(!JSON.stringify(results).includes('sensitive upstream detail'));
  assert.ok(!JSON.stringify(results).includes('private-access-token'));
});

test('Google owner responses never return config values and cache only successful reports', async () => {
  let calls = 0;
  const handler = createGa4Handler({ getStore: () => ({}), authenticate: async () => ({ isOwner: true }), env: configuredEnv, now: () => NOW, runReports: async () => { calls++; return [{ id: 'summary', columns: ['activeUsers'], rows: [[12]] }]; } });
  const first = await (await handler(request())).json(); const second = await (await handler(request())).json();
  assert.equal(first.connected, true); assert.equal(second.cached, true); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(first).includes('never-return'));
});

test('CSV exports quote correctly and neutralise spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(csvCell('-2+4'), '"\'-2+4"'); assert.equal(csvCell(-2), '"-2"');
  assert.equal(reportCsv({ columns: ['Page', 'Views'], rows: [['a,b\n"c"', 2]] }), '\uFEFF"Page","Views"\r\n"a,b\n""c""","2"');
  assert.equal(periodChange(1, 0), 'No previous-period baseline');
});


test('the report UI rechecks owner access on every load, focus and history restore', async () => {
  class Element {
    children = []; listeners = new Map(); dataset = {}; attributes = new Map(); hidden = false; value = ''; textContent = '';
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; this.textContent = ''; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  }
  const elements = new Map();
  const element = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  element('#period').value = '30';
  const sourceButton = new Element(); sourceButton.dataset.source = 'first_party';
  const listeners = new Map();
  const document = {
    querySelector: element,
    querySelectorAll: selector => selector === '[data-source]' ? [sourceButton] : [],
    createElement: () => new Element(), createElementNS: () => new Element(),
  };
  class FormData {
    *[Symbol.iterator]() { for (const key of ['period', 'start', 'end']) yield [key, element('#' + key).value]; }
  }
  const range = analyticsRange(new URLSearchParams('days=1'), NOW);
  const payload = {
    source: 'first_party', range, generatedAt: new Date(NOW).toISOString(), notes: [],
    ...aggregateAnalytics([{ at: NOW, path: '/', visitor: 'owner-private-data', source: 'private-source' }], range, NOW),
  };
  let authorized = true, calls = 0;
  const fetch = async () => { calls++; return authorized ? Response.json(payload) : Response.json({ error: 'Sign in again.' }, { status: 401 }); };
  const code = (await readFile(new URL('../analytics.js', import.meta.url), 'utf8')).replace(/^import [^\n]+\n/, '');
  await runInNewContext(code, {
    document, window: { addEventListener: (name, callback) => listeners.set(name, callback) },
    FormData, URLSearchParams, fetch, setTimeout, formatMetric, metricLabels, periodChange, reportCsv, reportTotals,
  });
  assert.equal(calls, 1);
  assert.equal(element('#analytics-workspace').hidden, false);
  assert.ok(element('#reports').children.length);
  sourceButton.listeners.get('click')();
  await setImmediate();
  assert.equal(calls, 2, 'reselecting the same report still verifies its session');

  authorized = false;
  const focusCheck = listeners.get('focus')();
  assert.equal(element('#analytics-workspace').hidden, true, 'hide old reports while checking a returning tab');
  assert.equal(element('#reports').children.length, 0);
  await focusCheck;
  assert.equal(calls, 3);
  assert.equal(element('#access-panel').hidden, false);
  assert.equal(element('#metrics').children.length, 0);
  assert.equal(element('#timeline-table').children.length, 0);

  authorized = true;
  await listeners.get('pageshow')({ persisted: false });
  assert.equal(calls, 3, 'ordinary initial pageshow does not create an extra request');
  await listeners.get('pageshow')({ persisted: true });
  assert.equal(calls, 4);
  assert.equal(element('#analytics-workspace').hidden, false);
  assert.equal(element('#access-panel').hidden, true);
});
