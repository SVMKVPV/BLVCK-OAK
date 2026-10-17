import { json } from '../lib/referrals.mjs';
import { cleanupExpiredQuotaClaims } from '../lib/public-rate-limit.mjs';

export const config = { schedule: '37 * * * *' };

export default async function handler() {
  try {
    return json(await cleanupExpiredQuotaClaims());
  } catch (error) {
    console.error('Rate-limit cleanup failed:', error.name);
    return json({ error: 'Rate-limit cleanup failed.' }, 503);
  }
}
