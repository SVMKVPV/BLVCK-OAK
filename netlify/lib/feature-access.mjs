import { requireAccount, clientError, assertSameOrigin, SESSION_COOKIE } from './portal-auth.mjs';
import { json } from './referrals.mjs';

// Apply before parsing input, fetching a website, sending email or opening Checkout.
export async function featureAccess(request) {
  if (!String(request.headers.get('cookie') || '').split(';').some(part => part.trim().startsWith(SESSION_COOKIE + '='))) {
    return json({ error: 'Log in to use this feature.' }, 401);
  }
  try {
    await requireAccount(request);
    if (request.method !== 'GET') assertSameOrigin(request);
    return null;
  } catch (error) {
    const result = clientError(error);
    return json({ error: result.error }, result.status);
  }
}

// Public acquisition endpoints do not require an account, but browser writes
// must still originate from this site. Keep this separate from featureAccess so
// private client and partner handlers cannot become public by accident.
export function publicFeatureAccess(request) {
  try {
    assertSameOrigin(request);
    return null;
  } catch (error) {
    const result = clientError(error);
    return json({ error: result.error }, result.status);
  }
}
