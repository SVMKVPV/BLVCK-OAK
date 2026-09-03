import {
  ENTERPRISE_REFERRAL_LIMIT,
  getEnterpriseCoupon,
  getStripe,
  json,
} from '../lib/referrals.mjs';

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  try {
    const coupon = await getEnterpriseCoupon(getStripe());
    const used = Math.min(ENTERPRISE_REFERRAL_LIMIT, Math.max(0, coupon?.times_redeemed || 0));
    return json({
      used,
      limit: ENTERPRISE_REFERRAL_LIMIT,
      remaining: ENTERPRISE_REFERRAL_LIMIT - used,
      offerActive: coupon ? coupon.valid && used < ENTERPRISE_REFERRAL_LIMIT : true,
    }, 200, {
      'cache-control': 'public, max-age=30',
      'netlify-cdn-cache-control': 'public, max-age=60, durable',
    });
  } catch (error) {
    console.error('Enterprise offer counter failed:', error.message);
    return json({ error: 'The live offer count is temporarily unavailable.' }, 503);
  }
}
