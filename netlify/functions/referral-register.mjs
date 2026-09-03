import { json, getSiteUrl } from '../lib/referrals.mjs';

// Legacy links now lead to the signed-in partner flow. Existing referral records are preserved.
export default async function handler(request) {
  if (request.method === 'GET') return Response.redirect(new URL('/partners.html?legacy=1', getSiteUrl(request)).toString(), 302);
  return json({ error: 'Create an account or sign in at /partners.html to manage your referral code.', signInUrl: '/partners.html' }, 410);
}
