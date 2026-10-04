import { featureAccess } from '../lib/feature-access.mjs';
import { json } from '../lib/referrals.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const denied = await featureAccess(request);
  return denied || json({ authenticated: true });
}
