import { json, runtimeEnv } from '../lib/referrals.mjs';
import { assertCsrf, clientError, portalStore, readBody, requireAccount } from '../lib/portal-auth.mjs';
import { consumeLeadSearchQuota, searchNearbyBusinesses, validateLeadSearch } from '../lib/nearby-businesses.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 10 } };

export default async function handler(request) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const store = portalStore();
    const auth = await requireAccount(request, store);
    assertCsrf(request, auth);
    const input = validateLeadSearch(await readBody(request));
    const apiKey = runtimeEnv('GOOGLE_MAPS_API_KEY');
    if (!apiKey) return json({ error: 'The lead finder is not configured yet. Add GOOGLE_MAPS_API_KEY in Netlify.' }, 503);
    const quota = await consumeLeadSearchQuota(store, auth.account.id, auth.isOwner);
    const leads = await searchNearbyBusinesses(input, apiKey);
    return json({ leads, remainingSearches: quota.remaining, checkedCount: 20 });
  } catch (error) {
    console.error('Nearby lead request failed:', error.name);
    const result = clientError(error);
    return json({ error: result.error }, result.status);
  }
}
