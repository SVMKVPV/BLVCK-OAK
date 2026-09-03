import { createHash, randomBytes } from 'node:crypto';

import { getStore } from '@netlify/blobs';
import Stripe from 'stripe';

export const REFERRAL_STORE = 'black-oak-referrals';
export const REWARD_STORE = 'black-oak-referral-rewards';
export const CHECKOUT_VERSION = 'black_oak_v2';
export const ENTERPRISE_LIST_PRICE_CENTS = 290000;
export const ENTERPRISE_REFERRAL_DISCOUNT_PERCENT = 60;
export const ENTERPRISE_REFERRAL_LIMIT = 1000;
export const ENTERPRISE_COUPON_ID = process.env.STRIPE_ENTERPRISE_REFERRAL_COUPON_ID || 'bo-ent-60-first-1000';
export const REFERRAL_CODE_PATTERN = /^BO-[A-F0-9]{10}$/;

export const PACKAGE_CATALOG = Object.freeze({
  essential: Object.freeze({
    id: 'essential',
    name: 'Black Oak Essential website package',
    priceCents: 50000,
    description: 'Strategy kick-off, a custom responsive launch page and lead capture.',
  }),
  professional: Object.freeze({
    id: 'professional',
    name: 'Black Oak Professional website package',
    priceCents: 150000,
    description: 'A complete brand platform with up to five custom pages, CMS setup and technical SEO.',
  }),
  enterprise: Object.freeze({
    id: 'enterprise',
    name: 'Black Oak Enterprise website package',
    priceCents: ENTERPRISE_LIST_PRICE_CENTS,
    description: 'Tailored digital product, commerce and integrations, advanced motion, and priority support.',
  }),
});

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function runtimeEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name];
}

export function getStripe() {
  const secretKey = runtimeEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    const error = new Error('Stripe is not configured for this function deployment.');
    error.name = 'StripeConfigurationError';
    error.code = 'stripe_not_configured';
    throw error;
  }
  return new Stripe(secretKey);
}

export function referralsStore() {
  return getStore({ name: REFERRAL_STORE, consistency: 'strong' });
}

export function rewardsStore() {
  return getStore({ name: REWARD_STORE, consistency: 'strong' });
}

export function json(data, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...additionalHeaders,
    },
  });
}

export function normaliseCode(value = '') {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 13);
}

export function isValidCode(value) {
  return REFERRAL_CODE_PATTERN.test(String(value));
}

export function emailKey(email) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export function tokenKey(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateReferralCode() {
  return `BO-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export function generateOnboardingToken() {
  return randomBytes(32).toString('base64url');
}

export function generateEmailToken() {
  return randomBytes(32).toString('base64url');
}

export function getPackage(packageId) {
  return PACKAGE_CATALOG[String(packageId || '').toLowerCase()] || null;
}

export function expectedPaidAmount(packageId, hasReferral = false) {
  const packageItem = getPackage(packageId);
  if (!packageItem) return null;
  if (packageItem.id === 'enterprise' && hasReferral) {
    return Math.round(packageItem.priceCents * (1 - ENTERPRISE_REFERRAL_DISCOUNT_PERCENT / 100));
  }
  return packageItem.priceCents;
}

export function isReferralAccountEligible(account) {
  return Boolean(
    account
    && !account.deleted
    && account.details_submitted
    && account.payouts_enabled
    && account.capabilities?.transfers === 'active'
    && !account.requirements?.disabled_reason,
  );
}

export function sameEmail(first = '', second = '') {
  const left = String(first).trim().toLowerCase();
  const right = String(second).trim().toLowerCase();
  return Boolean(left && right && left === right);
}

export function getRewardHoldDays() {
  return Math.round(boundedNumber(process.env.REFERRAL_HOLD_DAYS, 14, 7, 60));
}

export function getVerificationTtlMinutes() {
  return Math.round(boundedNumber(process.env.REFERRAL_VERIFICATION_TTL_MINUTES, 30, 10, 60));
}

export function getSiteUrl(request) {
  const configuredUrl = process.env.SITE_URL?.replace(/\/$/, '');
  return configuredUrl || new URL(request.url).origin;
}

export function calculateReward(amountCents) {
  const paid = Math.max(0, Math.round(Number(amountCents) || 0));
  if (!paid) return 0;
  const base = Math.round(boundedNumber(process.env.REFERRAL_BASE_REWARD_CENTS, 10000, 0, 50000));
  const threshold = Math.round(boundedNumber(process.env.REFERRAL_BONUS_THRESHOLD_CENTS, 50100, 10000, 10000000));
  const bonusRate = boundedNumber(process.env.REFERRAL_BONUS_RATE, 0.10, 0, 0.25);
  const calculated = paid > threshold ? base + Math.round(paid * bonusRate) : base;
  return Math.min(calculated, paid, Math.floor(paid * 0.4), 50000);
}

export function calculateEnterpriseReferralReward() {
  return 39000;
}

export async function getEnterpriseCoupon(stripe, { create = false } = {}) {
  try {
    const coupon = await stripe.coupons.retrieve(ENTERPRISE_COUPON_ID);
    if (coupon.deleted) return null;
    return coupon;
  } catch (error) {
    if (error?.code === 'resource_missing' && !create) return null;
    if (error?.code !== 'resource_missing') throw error;
  }

  try {
    return await stripe.coupons.create({
      id: ENTERPRISE_COUPON_ID,
      name: 'Black Oak Enterprise referral — 60% off',
      duration: 'once',
      percent_off: ENTERPRISE_REFERRAL_DISCOUNT_PERCENT,
      max_redemptions: ENTERPRISE_REFERRAL_LIMIT,
      metadata: {
        program: 'black_oak_enterprise_referral',
        list_price_aud: '2900',
      },
    }, { idempotencyKey: 'black-oak-enterprise-referral-coupon-v1' });
  } catch (error) {
    if (error?.code === 'resource_already_exists') {
      return stripe.coupons.retrieve(ENTERPRISE_COUPON_ID);
    }
    throw error;
  }
}

export async function createOnboardingLink(stripe, referral, request) {
  const siteUrl = getSiteUrl(request);
  const refreshUrl = new URL('/partners.html?onboarding=refresh', siteUrl);
  const returnUrl = new URL('/partners.html?onboarding=returned', siteUrl);

  return stripe.accountLinks.create({
    account: referral.stripeAccountId,
    refresh_url: refreshUrl.toString(),
    return_url: returnUrl.toString(),
    type: 'account_onboarding',
  });
}
