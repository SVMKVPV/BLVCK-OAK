import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHECKOUT_VERSION,
  calculateEnterpriseReferralReward,
  calculateReward,
  expectedPaidAmount,
  generateEmailToken,
  generateReferralCode,
  getPackage,
  isReferralAccountEligible,
  isValidCode,
  normaliseCode,
  sameEmail,
} from '../netlify/lib/referrals.mjs';

test('generated referral codes always match the one strict public format', () => {
  const codes = new Set(Array.from({ length: 250 }, () => generateReferralCode()));
  assert.equal(codes.size, 250);
  for (const code of codes) assert.match(code, /^BO-[A-F0-9]{10}$/);
});

test('email verification tokens are high-entropy URL-safe one-time values', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateEmailToken()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('copied codes normalize safely while malformed and legacy strings are rejected', () => {
  assert.equal(normaliseCode(' bo–ab12 cd34ef '), 'BO-AB12CD34EF');
  assert.equal(isValidCode('BO-AB12CD34EF'), true);
  assert.equal(isValidCode('BO-AB12CD34'), false);
  assert.equal(isValidCode('BO-AB12CD34EF<script>'), false);
  assert.equal(isValidCode('AB12CD34EF'), false);
});

test('package pricing and rewards are fixed to the advertised AUD amounts', () => {
  assert.equal(CHECKOUT_VERSION, 'black_oak_v2');
  assert.equal(getPackage('essential').priceCents, 50000);
  assert.equal(getPackage('professional').priceCents, 150000);
  assert.equal(getPackage('enterprise').priceCents, 290000);
  assert.equal(expectedPaidAmount('enterprise', true), 116000);
  assert.equal(expectedPaidAmount('enterprise', false), 290000);
  assert.equal(calculateReward(50000), 10000);
  assert.equal(calculateReward(150000), 25000);
  assert.equal(calculateEnterpriseReferralReward(), 39000);
});

test('reward configuration is bounded against destructive environment mistakes', () => {
  const originalBase = process.env.REFERRAL_BASE_REWARD_CENTS;
  const originalRate = process.env.REFERRAL_BONUS_RATE;
  process.env.REFERRAL_BASE_REWARD_CENTS = '99999999';
  process.env.REFERRAL_BONUS_RATE = '9';
  assert.ok(calculateReward(150000) <= 50000);
  if (originalBase === undefined) delete process.env.REFERRAL_BASE_REWARD_CENTS;
  else process.env.REFERRAL_BASE_REWARD_CENTS = originalBase;
  if (originalRate === undefined) delete process.env.REFERRAL_BONUS_RATE;
  else process.env.REFERRAL_BONUS_RATE = originalRate;
});

test('only completely verified Stripe referral accounts are eligible', () => {
  assert.equal(isReferralAccountEligible({
    details_submitted: true,
    payouts_enabled: true,
    capabilities: { transfers: 'active' },
    requirements: { disabled_reason: null },
  }), true);
  assert.equal(isReferralAccountEligible({
    details_submitted: false,
    payouts_enabled: true,
    capabilities: { transfers: 'active' },
  }), false);
  assert.equal(sameEmail('Partner@Example.com', ' partner@example.com '), true);
});

test('the browser uses the same exact referral pattern and server checkout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(html, /pattern="BO-\[A-Fa-f0-9\]\{10\}"/);
  assert.match(client, /\^BO-\[A-F0-9\]\{10\}\$/);
  assert.match(client, /\/api\/checkout\/package/);
  assert.doesNotMatch(client, /buy\.stripe\.com/);
  assert.doesNotMatch(html, /buy\.stripe\.com/);
  assert.match(html, /data-package="enterprise"/);
  assert.match(html, /data-enterprise-referral/);
  assert.match(html, /data-enterprise-apply/);
});

test('legacy registration directs visitors to verified accounts before Stripe onboarding', async () => {
  const registration = await readFile(new URL('../netlify/functions/referral-register.mjs', import.meta.url), 'utf8');
  const authentication = await readFile(new URL('../netlify/functions/partner-auth.mjs', import.meta.url), 'utf8');
  const partner = await readFile(new URL('../netlify/functions/partner-api.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(registration, /stripe\.accounts\.create/);
  assert.match(registration, /partners\.html/);
  assert.match(authentication, /consumeChallenge/);
  assert.match(authentication, /createSession/);
  assert.match(partner, /requireAccount/);
  assert.match(partner, /assertCsrf/);
  assert.match(partner, /stripe\.accounts\.create/);
});
