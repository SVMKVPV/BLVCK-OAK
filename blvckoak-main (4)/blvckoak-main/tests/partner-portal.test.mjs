import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCsrf, assertSameOrigin, consumeChallenge, createSession, hash, requireAccount, secretToken, SESSION_COOKIE } from '../netlify/lib/portal-auth.mjs';
import { runtimeEnv } from '../netlify/lib/referrals.mjs';
import { applyPaidSession, audToCents, createQuote, CUSTOM_CHECKOUT_VERSION, markQuotePaymentReview, nextPayment, publicQuote, settleQuotePayment, validateQuoteInput } from '../netlify/lib/quotes.mjs';
import { checkoutParameters, openQuoteCheckout, reconcileQuoteCheckout } from '../netlify/lib/quote-checkout.mjs';

class MemoryStore {
  map = new Map();
  revision = 0;
  async get(key) { return structuredClone(this.map.get(key)?.data ?? null); }
  async getWithMetadata(key) {
    const item = this.map.get(key);
    return item ? { data: structuredClone(item.data), etag: item.etag } : null;
  }
  async set(key, data, options = {}) {
    const current = this.map.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
    this.map.set(key, { data: structuredClone(data), etag: String(++this.revision) });
    return { modified: true };
  }
  async setJSON(key, data, options) { return this.set(key, data, options); }
  async delete(key) { this.map.delete(key); }
}
const account = { id: 'partner-1', name: 'Example Partner', email: 'partner@example.test' };
const input = { service: 'Website redesign', description: 'Five pages with a booking form and mobile responsive design.', customerName: 'Demo Client', customerEmail: 'client@example.test', total: '2400', deposit: '600' };
function approvedQuote() { return createQuote(input, account, 'BO-AB12CD34EF', true); }
function attemptedQuote() {
  return { ...approvedQuote(), checkout: { id: 'attempt-1', stage: 'deposit', amountCents: 60000, createdAt: Date.now(), sessionId: 'cs_deposit' } };
}
function paidSession(quote, overrides = {}) {
  return { id: quote.checkout.sessionId || 'cs_deposit', payment_intent: 'pi_deposit', currency: 'aud', payment_status: 'paid', amount_total: quote.checkout.amountCents, metadata: { checkout_version: CUSTOM_CHECKOUT_VERSION, quote_id: quote.id, quote_revision: String(quote.revision), attempt_id: quote.checkout.id, payment_stage: quote.checkout.stage }, ...overrides };
}
function fakeStripe() {
  const sessions = new Map();
  const keys = new Map();
  let creations = 0;
  return {
    sessions, keys, get creations() { return creations; },
    checkout: { sessions: {
      async create(params, options) {
        if (keys.has(options.idempotencyKey)) return structuredClone(sessions.get(keys.get(options.idempotencyKey)));
        const id = 'cs_fake_' + (++creations);
        const value = { id, status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/' + id, amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata, currency: 'aud', payment_intent: 'pi_' + id };
        keys.set(options.idempotencyKey, id); sessions.set(id, value); return structuredClone(value);
      },
      async retrieve(id) { return structuredClone(sessions.get(id)); },
    } },
  };
}

test('money parsing is exact and rejects negatives, exponent notation, non-finite amounts and extra decimals', () => {
  assert.equal(audToCents('29.01'), 2901);
  for (const value of ['-1', '1e3', 'NaN', 'Infinity', '29.001', '', '12,000']) assert.throws(() => audToCents(value));
});
test('quote bounds prevent invalid deposits and tiny outstanding balances', () => {
  for (const changes of [{ total: '99' }, { total: '100001' }, { deposit: '2401' }, { deposit: '49' }, { deposit: '2399' }]) assert.throws(() => validateQuoteInput({ ...input, ...changes }));
  assert.equal(validateQuoteInput({ ...input, deposit: '0' }).depositCents, 0);
});
test('partner-created quotes require approval and cannot claim standard referral commissions', () => {
  const quote = createQuote(input, account, 'BO-AB12CD34EF');
  assert.equal(quote.status, 'pending_approval');
  assert.equal(nextPayment(quote), null);
  assert.equal(quote.commissionPolicy, 'owner_review_required');
});
test('deposit then balance are calculated from approved server values', () => {
  const quote = attemptedQuote();
  assert.deepEqual(nextPayment(quote), { stage: 'deposit', amountCents: 60000 });
  const deposited = applyPaidSession(quote, paidSession(quote));
  assert.equal(deposited.status, 'deposit_paid');
  assert.deepEqual(nextPayment(deposited), { stage: 'balance', amountCents: 180000 });
  const balance = { ...deposited, checkout: { id: 'attempt-2', amountCents: 180000, stage: 'balance', sessionId: 'cs_balance' } };
  const paid = applyPaidSession(balance, paidSession(balance, { payment_intent: 'pi_balance' }));
  assert.equal(paid.status, 'paid'); assert.equal(nextPayment(paid), null);
});
test('a signed payment is applied once and rejects modified amounts or identities', () => {
  const quote = attemptedQuote(); const session = paidSession(quote);
  const updated = applyPaidSession(quote, session);
  assert.equal(applyPaidSession(updated, session).payments.length, 1);
  for (const changes of [{ amount_total: 1 }, { currency: 'usd' }, { id: 'cs_wrong' }, { payment_intent: null }, { metadata: { ...session.metadata, quote_revision: '99' } }]) assert.throws(() => applyPaidSession(quote, { ...session, ...changes }));
});
test('unpaid checkout and expired proposals never count as payment', () => {
  const quote = attemptedQuote();
  assert.equal(applyPaidSession(quote, paidSession(quote, { payment_status: 'unpaid' })).payments.length, 0);
  assert.equal(nextPayment({ ...quote, expiresAt: '2000-01-01T00:00:00Z' }), null);
});
test('public quote data excludes private tokens, client emails and account identifiers', () => {
  const safe = publicQuote(approvedQuote());
  for (const key of ['publicToken', 'customerEmail', 'partnerEmail', 'partnerId', 'checkout']) assert.equal(key in safe, false);
});
test('checkout parameters never enable coupons, arbitrary discounts or automatic future charges', () => {
  process.env.SITE_URL = 'https://blackoak.example';
  const quote = attemptedQuote(); const params = checkoutParameters(quote, quote.checkout);
  assert.equal(params.line_items[0].price_data.unit_amount, 60000);
  assert.equal(params.customer_email, input.customerEmail);
  assert.equal(params.discounts, undefined); assert.equal(params.allow_promotion_codes, undefined);
  assert.equal(params.payment_intent_data.setup_future_usage, undefined);
});
test('runtime environment prefers Netlify function values and falls back locally', () => {
  const originalNetlify = globalThis.Netlify;
  const originalValue = process.env.RUNTIME_ENV_TEST;
  try {
    process.env.RUNTIME_ENV_TEST = 'process-value';
    globalThis.Netlify = { env: { get: (name) => name === 'RUNTIME_ENV_TEST' ? 'netlify-value' : undefined } };
    assert.equal(runtimeEnv('RUNTIME_ENV_TEST'), 'netlify-value');
    delete globalThis.Netlify;
    assert.equal(runtimeEnv('RUNTIME_ENV_TEST'), 'process-value');
  } finally {
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
    if (originalValue === undefined) delete process.env.RUNTIME_ENV_TEST;
    else process.env.RUNTIME_ENV_TEST = originalValue;
  }
});
test('concurrent payment clicks reuse a single Stripe checkout attempt', async () => {
  process.env.SITE_URL = 'https://blackoak.example';
  const store = new MemoryStore(); const quote = approvedQuote(); const stripe = fakeStripe();
  await store.setJSON('quote/' + quote.id, quote);
  const results = await Promise.all([openQuoteCheckout(quote.id, stripe, store), openQuoteCheckout(quote.id, stripe, store)]);
  assert.equal(results[0].url, results[1].url); assert.equal(stripe.creations, 1);
});
test('an already-paid Stripe session waits for the signed webhook without reopening checkout', async () => {
  const store = new MemoryStore(); const quote = approvedQuote(); const stripe = fakeStripe();
  await store.setJSON('quote/' + quote.id, quote); await openQuoteCheckout(quote.id, stripe, store);
  const id = [...stripe.sessions.keys()][0]; stripe.sessions.get(id).payment_status = 'paid';
  assert.deepEqual(await openQuoteCheckout(quote.id, stripe, store), { awaitingConfirmation: true });
  assert.equal(stripe.creations, 1); assert.equal((await store.get('quote/' + quote.id)).payments.length, 0);
});
test('the return page confirms a paid Stripe session when webhooks are unavailable', async () => {
  const store = new MemoryStore(); const quote = attemptedQuote(); const stripe = fakeStripe();
  const session = paidSession(quote); stripe.sessions.set(session.id, session);
  await store.setJSON('quote/' + quote.id, quote);
  let notifications = 0;
  const updated = await reconcileQuoteCheckout(quote, stripe, store, async () => { notifications += 1; });
  assert.equal(updated.status, 'deposit_paid');
  assert.equal(updated.checkout, null);
  assert.equal(updated.payments.length, 1);
  assert.equal(notifications, 1);
});
test('uncertain old attempts fail closed rather than risking a second charge', async () => {
  const store = new MemoryStore(); const quote = attemptedQuote();
  quote.checkout.sessionId = null; quote.checkout.createdAt = Date.now() - 24 * 60 * 60_000;
  await store.setJSON('quote/' + quote.id, quote);
  await assert.rejects(openQuoteCheckout(quote.id, fakeStripe(), store), /reconciliation/);
});
test('concurrent duplicate webhooks settle the same payment once', async () => {
  const store = new MemoryStore(); const quote = attemptedQuote(); const session = paidSession(quote);
  await store.setJSON('quote/' + quote.id, quote);
  await Promise.all([settleQuotePayment(session, store), settleQuotePayment(session, store)]);
  assert.equal((await store.get('quote/' + quote.id)).payments.length, 1);
  assert.equal(await store.get('quote-payment/pi_deposit'), quote.id);
});
test('a refund before the checkout webhook preserves its review hold and refunded amount', async () => {
  const store = new MemoryStore(); const quote = attemptedQuote();
  await store.setJSON('quote/' + quote.id, quote);
  await markQuotePaymentReview({ payment_intent: 'pi_deposit', amount_refunded: 60000 }, 'refund', store, quote.id);
  const updated = await settleQuotePayment(paidSession(quote), store);
  assert.equal(updated.status, 'payment_review'); assert.equal(updated.payments[0].refundedCents, 60000); assert.equal(nextPayment(updated), null);
});
test('email codes expire, stop after five failures and cannot be reused', async () => {
  const store = new MemoryStore(); const token = secretToken(); const key = 'challenge/' + hash(token);
  const challenge = { email: account.email, codeHash: hash(token + ':123456'), attempts: 0, used: false, expiresAt: Date.now() + 600000 };
  await store.setJSON(key, challenge);
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(consumeChallenge(token, '999999', store));
  await assert.rejects(consumeChallenge(token, '123456', store));
  await store.setJSON(key, challenge); await consumeChallenge(token, '123456', store);
  await assert.rejects(consumeChallenge(token, '123456', store));
  await store.setJSON(key, { ...challenge, expiresAt: Date.now() - 1 });
  await assert.rejects(consumeChallenge(token, '123456', store));
});
test('only one concurrent verification can consume an email code', async () => {
  const store = new MemoryStore(); const token = secretToken();
  await store.setJSON('challenge/' + hash(token), { codeHash: hash(token + ':123456'), attempts: 0, used: false, expiresAt: Date.now() + 600000 });
  const results = await Promise.allSettled([consumeChallenge(token, '123456', store), consumeChallenge(token, '123456', store)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});
test('session cookies are secure and owner authority is resolved only from verified server identity', async () => {
  const store = new MemoryStore(); process.env.OWNER_EMAIL = 'owner@example.test';
  await store.setJSON('account/' + account.id, { ...account, role: 'owner' });
  const session = await createSession(account, store);
  assert.match(session.cookie, /HttpOnly; Secure; SameSite=Strict/);
  const request = new Request('https://blackoak.example/api/partners', { headers: { cookie: session.cookie.split(';')[0] } });
  const auth = await requireAccount(request, store);
  assert.equal(auth.isOwner, false);
  await assert.rejects(requireAccount(new Request('https://blackoak.example'), store));
  const token = session.cookie.split(';')[0].slice(SESSION_COOKIE.length + 1);
  await store.setJSON('session/' + hash(token), { ...session.session, expiresAt: Date.now() - 1 });
  await assert.rejects(requireAccount(request, store));
});
test('mutating actions require both same-origin requests and a session-specific CSRF value', () => {
  process.env.SITE_URL = 'https://blackoak.example';
  assert.throws(() => assertSameOrigin(new Request('https://blackoak.example', { headers: { origin: 'https://attacker.example' } })));
  assert.throws(() => assertCsrf(new Request('https://blackoak.example', { headers: { origin: 'https://blackoak.example', 'x-csrf-token': 'wrong' } }), { session: { csrf: 'correct' } }));
  assert.doesNotThrow(() => assertCsrf(new Request('https://blackoak.example', { headers: { origin: 'https://blackoak.example', 'x-csrf-token': 'correct' } }), { session: { csrf: 'correct' } }));
});
