import assert from 'node:assert/strict';
import test from 'node:test';

import { packageCheckoutParameters } from '../netlify/functions/package-checkout.mjs';
import { getPackage } from '../netlify/lib/referrals.mjs';

const metadata = {
  checkout_version: 'black_oak_v2',
  package_id: 'link-in-bio',
  package_list_price_cents: '1313',
  referral_program: 'none',
  referral_code: '',
  reward_policy: 'none',
};

test('Link in Bio opens a recurring A$13.13 monthly Stripe Checkout session', () => {
  const params = packageCheckoutParameters({
    packageItem: getPackage('link-in-bio'),
    metadata,
    successUrl: new URL('https://blackoak.example/?payment=success&package=link-in-bio'),
    cancelUrl: new URL('https://blackoak.example/?payment=cancelled&package=link-in-bio'),
  });

  assert.equal(params.mode, 'subscription');
  assert.equal(params.line_items[0].price_data.currency, 'aud');
  assert.equal(params.line_items[0].price_data.unit_amount, 1313);
  assert.deepEqual(params.line_items[0].price_data.recurring, { interval: 'month' });
  assert.deepEqual(params.subscription_data, { metadata });
  assert.equal(params.customer_creation, undefined);
  assert.equal(params.payment_intent_data, undefined);
});

test('website build packages remain one-time Stripe payments', () => {
  const params = packageCheckoutParameters({
    packageItem: getPackage('essential'),
    metadata: { ...metadata, package_id: 'essential', package_list_price_cents: '50000' },
    successUrl: new URL('https://blackoak.example/?payment=success&package=essential'),
    cancelUrl: new URL('https://blackoak.example/?payment=cancelled&package=essential'),
  });

  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.recurring, undefined);
  assert.equal(params.customer_creation, 'always');
  assert.deepEqual(params.payment_intent_data, { metadata: params.metadata });
  assert.equal(params.subscription_data, undefined);
});
