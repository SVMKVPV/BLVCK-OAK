import {
  CHECKOUT_VERSION,
  ENTERPRISE_REFERRAL_DISCOUNT_PERCENT,
  ENTERPRISE_REFERRAL_LIMIT,
  calculateEnterpriseReferralReward,
  calculateReward,
  expectedPaidAmount,
  getEnterpriseCoupon,
  getPackage,
  getSiteUrl,
  getStripe,
  isReferralAccountEligible,
  isValidCode,
  json,
  normaliseCode,
  referralsStore,
  sameEmail,
} from '../lib/referrals.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestIdPattern = /^[A-Za-z0-9-]{16,80}$/;

export const config = {
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 60,
    windowLimit: 12,
  },
};

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 4096) return json({ error: 'Checkout request is too large.' }, 413);

    const body = await request.json();
    const packageItem = getPackage(body.packageId);
    if (!packageItem) return json({ error: 'Choose a valid Black Oak package.' }, 400);

    const rawReferralCode = String(body.referralCode || '').trim();
    const referralCode = normaliseCode(rawReferralCode);
    const hasReferral = rawReferralCode.length > 0;
    const customerEmail = String(body.customerEmail || '').trim().toLowerCase().slice(0, 160);
    const requestId = String(body.requestId || '').trim();

    if (!requestIdPattern.test(requestId)) return json({ error: 'Refresh the page and try checkout again.' }, 400);
    if (hasReferral && !isValidCode(referralCode)) {
      return json({ error: 'Use a complete referral code in the format BO-AB12CD34EF.' }, 400);
    }
    if (hasReferral && !emailPattern.test(customerEmail)) {
      return json({ error: 'Enter the customer email that will be used at Stripe checkout.' }, 400);
    }

    const stripe = getStripe();
    let coupon = null;

    if (hasReferral) {
      const referral = await referralsStore().get(`code/${referralCode}`, { type: 'json', consistency: 'strong' });
      if (!referral || referral.status === 'suspended' || referral.status === 'closed') {
        return json({ error: 'That referral code is not active.' }, 404);
      }
      if (sameEmail(customerEmail, referral.email)) {
        return json({ error: 'Self-referrals are not eligible for discounts or rewards.' }, 403);
      }

      if (!referral.stripeAccountId) return json({ error: 'This partner must finish Stripe payout onboarding before the code can be used.' }, 409);
      const account = await stripe.accounts.retrieve(referral.stripeAccountId);
      if (!sameEmail(account.email, referral.email) || !isReferralAccountEligible(account)) {
        return json({ error: 'This partner must complete Stripe identity and payout verification before the code can be used.' }, 409);
      }

      if (packageItem.id === 'enterprise') {
        coupon = await getEnterpriseCoupon(stripe, { create: true });
        const offerExhausted = !coupon
          || !coupon.valid
          || coupon.duration !== 'once'
          || coupon.percent_off !== ENTERPRISE_REFERRAL_DISCOUNT_PERCENT
          || coupon.max_redemptions !== ENTERPRISE_REFERRAL_LIMIT
          || coupon.times_redeemed >= ENTERPRISE_REFERRAL_LIMIT
          || coupon.metadata?.program !== 'black_oak_enterprise_referral';

        if (offerExhausted) {
          return json({ error: 'The first 1,000 Enterprise referral offers have been claimed.' }, 409);
        }
      }
    }

    const siteUrl = getSiteUrl(request);
    const successUrl = new URL('/', siteUrl);
    successUrl.searchParams.set('payment', 'success');
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    successUrl.hash = 'packages';
    const cancelUrl = new URL('/', siteUrl);
    cancelUrl.searchParams.set('payment', 'cancelled');
    cancelUrl.hash = 'packages';

    const metadata = {
      checkout_version: CHECKOUT_VERSION,
      package_id: packageItem.id,
      package_list_price_cents: String(packageItem.priceCents),
      referral_program: hasReferral ? 'black_oak_verified_partner' : 'none',
      referral_code: hasReferral ? referralCode : '',
      reward_policy: hasReferral && packageItem.id === 'enterprise' ? 'enterprise_list_price' : hasReferral ? 'standard' : 'none',
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: hasReferral ? referralCode : undefined,
      customer_email: emailPattern.test(customerEmail) ? customerEmail : undefined,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: packageItem.priceCents,
          product_data: {
            name: packageItem.name,
            description: packageItem.description,
            metadata: { package_id: packageItem.id, checkout_version: CHECKOUT_VERSION },
          },
        },
        quantity: 1,
      }],
      discounts: coupon ? [{ coupon: coupon.id }] : undefined,
      payment_method_types: ['card'],
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      customer_creation: 'always',
      billing_address_collection: 'required',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata,
      payment_intent_data: { metadata },
    }, { idempotencyKey: `black-oak-checkout-${requestId}` });

    const dueNowCents = expectedPaidAmount(packageItem.id, hasReferral);
    const referralRewardCents = !hasReferral
      ? 0
      : packageItem.id === 'enterprise'
        ? calculateEnterpriseReferralReward()
        : calculateReward(packageItem.priceCents);

    return json({
      url: session.url,
      pricing: {
        listPriceCents: packageItem.priceCents,
        discountPercent: coupon ? ENTERPRISE_REFERRAL_DISCOUNT_PERCENT : 0,
        dueNowCents,
        referralRewardCents,
      },
    });
  } catch (error) {
    console.error('Package checkout failed:', error.message);
    return json({ error: 'Secure checkout could not be opened. Please try again.' }, 500);
  }
}
