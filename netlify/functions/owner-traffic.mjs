import { json } from '../lib/referrals.mjs';
import { clientError, portalStore, requireAccount } from '../lib/portal-auth.mjs';
import { aggregateAnalytics, analyticsRange, readAnalyticsRows } from '../lib/site-analytics.mjs';

export function createTrafficHandler({ getStore = portalStore, authenticate = requireAccount, now = Date.now, readRows = readAnalyticsRows } = {}) {
  const cache = new Map();
  let recentRecords = null;
  return async function handler(request) {
    try {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      const store = getStore();
      const auth = await authenticate(request, store);
      if (!auth.isOwner) return json({ error: 'This page is available to the BLVCK OAK owner only.' }, 403);
      const range = analyticsRange(new URL(request.url).searchParams, now());
      const key = JSON.stringify(range);
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return json({ ...cached.data, cached: true });
      if (!recentRecords || recentRecords.expires <= now()) recentRecords = { ...(await readRows(store)), expires: now() + 30000 };
      const { rows, truncated, scanned } = recentRecords;
      const result = {
        source: 'first_party', generatedAt: new Date(now()).toISOString(), range,
        ...aggregateAnalytics(rows, range, now()),
        coverage: { scanned, truncated, earliestAvailable: rows.length ? new Date(Math.min(...rows.map(row => Number(row.at)))).toISOString() : null },
        notes: [
          'First-party records are separate from Google Analytics. They are not GA4 users or sessions.',
          'Visitor counts estimate distinct network addresses. Shared networks, changing IP addresses, blockers and bots affect counts. Raw IP addresses and full User-Agent strings are not stored.',
          'Sources describe page views; internal navigation is retained. This is not first-touch or session attribution.',
          'New device and interaction fields begin with this release. Earlier records remain unknown. Location is approximate.',
          ...(truncated ? ['This report covers the latest 10,000 available records. Older periods may be incomplete.'] : []),
        ],
      };
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(key, { data: result, expires: now() + 30000 });
      return json(result);
    } catch (error) {
      const result = clientError(error);
      return json({ error: result.error }, result.status);
    }
  };
}

export default createTrafficHandler();
