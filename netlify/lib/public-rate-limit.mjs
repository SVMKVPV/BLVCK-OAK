import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { getStore } from '@netlify/blobs';
import { deployContext, json, scopedStoreName } from './referrals.mjs';

export const PUBLIC_QUOTAS = Object.freeze({
  contact: Object.freeze({ limit: 3, windowSeconds: 60 * 60 }),
  booking: Object.freeze({ limit: 3, windowSeconds: 60 * 60 }),
  audit: Object.freeze({ limit: 5, windowSeconds: 60 * 60 }),
  checkout: Object.freeze({ limit: 12, windowSeconds: 60 * 60 }),
  analytics: Object.freeze({ limit: 120, windowSeconds: 60 * 60 }),
  'nearby-businesses': Object.freeze({ limit: 30, windowSeconds: 60 * 60 }),
  'partner-api': Object.freeze({ limit: 240, windowSeconds: 60 * 60 }),
  'partner-auth': Object.freeze({ limit: 20, windowSeconds: 60 * 60 }),
  portfolio: Object.freeze({ limit: 120, windowSeconds: 60 * 60 }),
  'project-progress': Object.freeze({ limit: 300, windowSeconds: 60 * 60 }),
  'quote-payment': Object.freeze({ limit: 300, windowSeconds: 60 * 60 }),
});

const saltKey = 'salt/v1';
let cachedSaltPromise;

export const publicRateLimitStore = () => getStore({
  name: scopedStoreName('black-oak-public-rate-limits'),
  consistency: 'strong',
});

async function loadSalt(store) {
  const existing = await store.get(saltKey, { type: 'text', consistency: 'strong' });
  if (/^[A-Za-z0-9_-]{43}$/.test(existing || '')) return existing;

  const candidate = randomBytes(32).toString('base64url');
  const saved = await store.set(saltKey, candidate, { onlyIfNew: true });
  if (saved.modified) return candidate;

  const winner = await store.get(saltKey, { type: 'text', consistency: 'strong' });
  if (!/^[A-Za-z0-9_-]{43}$/.test(winner || '')) throw new Error('Rate-limit salt is unavailable.');
  return winner;
}

async function rateLimitSalt(store) {
  if (!cachedSaltPromise) {
    cachedSaltPromise = loadSalt(store).catch((error) => {
      cachedSaltPromise = undefined;
      throw error;
    });
  }
  return cachedSaltPromise;
}

export async function claimPublicQuota({
  endpoint,
  ip,
  now = Date.now(),
  store = publicRateLimitStore(),
  secret,
  maxAttempts = 6,
}) {
  const policy = PUBLIC_QUOTAS[endpoint];
  if (!policy) throw new Error('Unknown public quota.');
  if (!isIP(ip)) throw new Error('A verified client IP address is required.');

  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid quota timestamp.');
  const windowMs = policy.windowSeconds * 1000;
  const bucket = Math.floor(timestamp / windowMs);
  const resetAt = (bucket + 1) * windowMs;
  const privateSalt = secret || await rateLimitSalt(store);
  const subject = createHmac('sha256', privateSalt).update(`${endpoint}:${bucket}:${ip}`).digest('hex');
  const key = `quota/${endpoint}/${bucket}/${subject}`;
  const attempts = Math.max(1, Math.min(10, Math.floor(Number(maxAttempts) || 1)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const count = Number.isSafeInteger(entry?.data?.count) && entry.data.count >= 0 ? entry.data.count : 0;
    if (count >= policy.limit) {
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - timestamp) / 1000)),
      };
    }

    const saved = await store.setJSON(
      key,
      { count: count + 1, resetAt },
      entry?.etag
        ? { onlyIfMatch: entry.etag, metadata: { expiresAt: resetAt } }
        : { onlyIfNew: true, metadata: { expiresAt: resetAt } },
    );
    if (saved.modified) {
      return {
        allowed: true,
        limit: policy.limit,
        remaining: policy.limit - count - 1,
        resetAt,
      };
    }
  }

  return {
    allowed: false,
    busy: true,
    limit: policy.limit,
    remaining: null,
    resetAt,
    retryAfterSeconds: 1,
  };
}

export async function cleanupExpiredQuotaClaims({
  store = publicRateLimitStore(),
  now = Date.now(),
  graceMilliseconds = 2 * 60 * 60 * 1000,
  maxDeletes = 2000,
} = {}) {
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid cleanup timestamp.');
  const cutoff = timestamp - Math.max(0, Number(graceMilliseconds) || 0);
  const keys = [];
  let scanned = 0;

  for await (const page of store.list({ prefix: 'quota/', paginate: true })) {
    for (const blob of page.blobs || []) {
      scanned += 1;
      const match = /^quota\/([^/]+)\/(\d+)\//.exec(blob.key);
      const policy = match ? PUBLIC_QUOTAS[match[1]] : null;
      const bucket = match ? Number(match[2]) : NaN;
      if (!policy || !Number.isSafeInteger(bucket)) continue;
      const expiresAt = (bucket + 1) * policy.windowSeconds * 1000;
      if (expiresAt <= cutoff) keys.push(blob.key);
      if (keys.length >= maxDeletes) break;
    }
    if (keys.length >= maxDeletes) break;
  }

  for (let start = 0; start < keys.length; start += 50) {
    await Promise.all(keys.slice(start, start + 50).map((key) => store.delete(key)));
  }
  return { scanned, deleted: keys.length, capped: keys.length >= maxDeletes };
}

export async function enforcePublicQuota(endpoint, context = {}, options = {}) {
  const ip = String(context?.ip || '').trim();
  if (!isIP(ip)) {
    const contextName = String(context?.deploy?.context || deployContext()).toLowerCase();
    if (contextName === 'production') {
      return json({ error: 'Request verification is temporarily unavailable. Please try again.' }, 503);
    }
    // Unit tests and direct local handler calls do not receive Netlify context.
    return null;
  }

  try {
    const result = await claimPublicQuota({
      endpoint,
      ip,
      ...options,
    });
    if (result.allowed) return null;
    if (result.busy) {
      return json(
        { error: 'Requests are arriving too quickly. Please try again.' },
        503,
        { 'retry-after': String(result.retryAfterSeconds) },
      );
    }
    return json(
      { error: 'Too many requests from this network. Please try again later.' },
      429,
      {
        'retry-after': String(result.retryAfterSeconds),
        'x-ratelimit-limit': String(result.limit),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.ceil(result.resetAt / 1000)),
      },
    );
  } catch (error) {
    console.error(`Public quota failed for ${endpoint}:`, error.name);
    return json({ error: 'Request verification is temporarily unavailable. Please try again.' }, 503);
  }
}
