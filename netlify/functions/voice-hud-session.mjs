import { json } from '../lib/referrals.mjs';
import { PortalError, portalStore, requireAccount } from '../lib/portal-auth.mjs';

// Tells the voice HUD whether the signed-in visitor is the BLVCK OAK owner. Owner status comes
// only from the verified session and the private OWNER_AUTH_EMAIL setting. The browser cannot
// claim it. Visitors who are signed out or not the owner get a plain { owner: false } and
// nothing else, so the response reveals nothing about accounts.
export function createVoiceHudSessionHandler({ getStore = portalStore, authenticate = requireAccount } = {}) {
  return async function handler(request) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    try {
      const auth = await authenticate(request, getStore());
      return json({ owner: auth.isOwner === true });
    } catch (error) {
      if (error instanceof PortalError && (error.status === 401 || error.status === 403)) return json({ owner: false });
      return json({ error: 'Voice HUD session is unavailable.' }, 503);
    }
  };
}

export default createVoiceHudSessionHandler();
