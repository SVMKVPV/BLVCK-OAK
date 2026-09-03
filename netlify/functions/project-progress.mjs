import { json } from '../lib/referrals.mjs';
import { PortalError, assertSameOrigin, clientError, portalStore, quoteIdPattern, readBody, safeEqual, tokenPattern } from '../lib/portal-auth.mjs';
import { publicProjectProgress } from '../lib/project-progress.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 60 } };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    assertSameOrigin(request);
    const body = await readBody(request, 4096);
    if (body.action !== 'view' || !quoteIdPattern.test(body.id || '') || !tokenPattern.test(body.token || '')) throw new PortalError('This private progress link is incomplete.', 404);
    const quote = await portalStore().get(`quote/${body.id}`, { type: 'json' });
    if (!quote || !safeEqual(body.token, quote.publicToken) || ['pending_approval', 'declined'].includes(quote.status)) throw new PortalError('This project progress link is not approved or is unavailable.', 404);
    return json({ project: publicProjectProgress(quote) });
  } catch (error) {
    console.error('Project progress request failed:', error.name);
    const result = clientError(error); return json({ error: result.error }, result.status);
  }
}
