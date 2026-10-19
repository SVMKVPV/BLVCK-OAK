import assert from 'node:assert/strict';
import test from 'node:test';
import { PortalError } from '../netlify/lib/portal-auth.mjs';
import { INSTALMENT_COUNT, INSTALMENT_PLAN_TYPE, INSTALMENT_VERSION, instalmentAmounts, readInstalmentProgress } from '../netlify/lib/instalments.mjs';
import { publicPaymentArrangement } from '../netlify/lib/pay-as-you-sell.mjs';
import { applyPaidSession, createQuote, CUSTOM_CHECKOUT_VERSION, grossPaid, markQuotePaymentReview, nextPayment, publicQuote, settleQuotePayment } from '../netlify/lib/quotes.mjs';
import { checkoutParameters, openQuoteCheckout, reconcileQuoteCheckout, releaseFailedQuoteCheckout } from '../netlify/lib/quote-checkout.mjs';

const originalSiteUrl = process.env.SITE_URL;
test.before(() => { process.env.SITE_URL = 'https://blackoak.example'; });
test.after(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

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
}

const account = { id: 'partner-instalments', name: 'Example Partner', email: 'partner@example.test' };
const input = {
  service: 'Custom website', description: 'A custom website with booking, online payments and responsive pages.',
  customerName: 'Example Client', customerEmail: 'client@example.test', total: '2900.00', deposit: '0',
  paymentPlan: 'instalments_15',
};
const expectedAmounts = [...Array(5).fill(19334), ...Array(10).fill(19333)];
const quoteKey = (quote) => `quote/${quote.id}`;
const instalmentQuote = (changes = {}, approved = true) => createQuote({ ...input, ...changes }, account, 'BO-AB12CD34EF', approved);

function attemptedQuote(quote = instalmentQuote(), suffix = 'first') {
  return { ...quote, checkout: { ...nextPayment(quote), id: `attempt-${suffix}`, sessionId: `cs_instalment_${suffix}`, createdAt: Date.now() } };
}

function paidSession(quote, changes = {}) {
  return {
    id: quote.checkout.sessionId, payment_intent: `pi_${quote.checkout.id}`, currency: 'aud',
    payment_status: 'paid', amount_total: quote.checkout.amountCents,
    metadata: {
      checkout_version: CUSTOM_CHECKOUT_VERSION, quote_id: quote.id, quote_revision: String(quote.revision),
      attempt_id: quote.checkout.id, payment_stage: quote.checkout.stage,
    },
    ...changes,
  };
}

function fakeStripe() {
  const sessions = new Map();
  const keys = new Map();
  const requests = [];
  return {
    sessions, keys, requests,
    get creations() { return requests.length; },
    checkout: { sessions: {
      async create(params, options) {
        if (keys.has(options.idempotencyKey)) return structuredClone(sessions.get(keys.get(options.idempotencyKey)));
        const id = `cs_instalments_${requests.length + 1}`;
        const session = {
          id, status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/c/pay/${id}`,
          amount_total: params.line_items[0].price_data.unit_amount, currency: 'aud',
          metadata: structuredClone(params.metadata), payment_intent: `pi_${id}`,
        };
        requests.push(structuredClone(params));
        keys.set(options.idempotencyKey, id);
        sessions.set(id, session);
        return structuredClone(session);
      },
      async retrieve(id) { return structuredClone(sessions.get(id)); },
      async expire(id) {
        const session = sessions.get(id);
        if (!session || session.status !== 'open' || session.payment_status !== 'unpaid') throw new Error('Session cannot expire.');
        session.status = 'expired';
        return structuredClone(session);
      },
    } },
  };
}

function publicPlan(paidInstalments) {
  return {
    type: 'instalments_15', instalmentCount: 15, paidInstalments, remainingInstalments: 15 - paidInstalments,
    balanceCents: 290000 - expectedAmounts.slice(0, paidInstalments).reduce((sum, amount) => sum + amount, 0),
    schedule: expectedAmounts.map((amountCents, index) => ({
      number: index + 1, amountCents, paid: index < paidInstalments,
      paidCents: index < paidInstalments ? amountCents : 0,
      remainingCents: index < paidInstalments ? 0 : amountCents, partial: false,
    })),
  };
}

function assertNextPayment(quote, expected) {
  const actual = nextPayment(quote);
  if (expected === null) return assert.equal(actual, null);
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `next payment ${key}`);
}

test('15-part schedules round in cents and preserve the exact quote total at both price bounds', () => {
  assert.equal(INSTALMENT_COUNT, 15);
  assert.equal(INSTALMENT_PLAN_TYPE, 'instalments_15');
  assert.equal(INSTALMENT_VERSION, 'black_oak_instalments_v1');
  for (const [total, expected] of [
    [10000, [...Array(10).fill(667), ...Array(5).fill(666)]],
    [10001, [...Array(11).fill(667), ...Array(4).fill(666)]],
    [10005, Array(15).fill(667)],
    [290000, expectedAmounts],
    [290001, [...Array(6).fill(19334), ...Array(9).fill(19333)]],
    [9999999, [...Array(9).fill(666667), ...Array(6).fill(666666)]],
    [10000000, [...Array(10).fill(666667), ...Array(5).fill(666666)]],
  ]) {
    const amounts = instalmentAmounts(total);
    assert.deepEqual(amounts, expected, `schedule for ${total} cents`);
    assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), total);
    assert.ok(amounts.every((amount) => Number.isSafeInteger(amount) && amount > 0));
  }
  for (const total of [0, -100, 10000.5, '10000', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => instalmentAmounts(total), PortalError);
  }
  assert.equal(nextPayment(instalmentQuote({ total: '100' })).amountCents, 667);
  assert.equal(nextPayment(instalmentQuote({ total: '100000' })).amountCents, 666667);
});

test('quote creation fixes the plan at 15 parts and rejects a separate deposit or caller-supplied plan object', () => {
  const quote = instalmentQuote({ instalmentVersion: 'forged', schedule: [1], payments: [{ amountCents: 290000 }] });
  assert.deepEqual(quote.paymentPlan, { type: 'instalments_15', version: 'black_oak_instalments_v1', instalmentCount: 15 });
  assert.equal(quote.depositCents, 0);
  assert.deepEqual(quote.payments, []);
  assertNextPayment(quote, { stage: 'instalment_1', amountCents: 19334, instalmentNumber: 1, instalmentCount: 15 });
  for (const deposit of ['0.01', '50', '600', '2900']) assert.throws(() => instalmentQuote({ deposit }), PortalError);
  assert.throws(() => instalmentQuote({ instalmentCount: 3 }), PortalError);
  assert.throws(() => instalmentQuote({ paymentPlan: { type: 'instalments_15', instalmentCount: 1 } }), PortalError);
});

test('stored instalment configuration and payment history fail closed instead of becoming full-payment quotes', () => {
  const original = attemptedQuote();
  const second = attemptedQuote(applyPaidSession(original, paidSession(original)), 'second-history');
  const paid = applyPaidSession(second, paidSession(second));
  const corruptions = [
    (quote) => { quote.paymentPlan.instalmentCount = 14; },
    (quote) => { quote.paymentPlan.instalmentCount = '15'; },
    (quote) => { quote.paymentPlan.version = 'unknown'; },
    (quote) => { delete quote.paymentPlan.version; },
    (quote) => { quote.totalCents = 0; },
    (quote) => { quote.totalCents += 0.5; },
    (quote) => { quote.depositCents = 5000; },
    (quote) => { quote.payments = null; },
    (quote) => { quote.payments[0].amountCents -= 1; },
    (quote) => { quote.payments[0].stage = 'full'; },
    (quote) => { quote.payments[0].stage = 'instalment_2'; },
    (quote) => { delete quote.payments[0].sessionId; },
    (quote) => { delete quote.payments[0].paymentIntentId; },
    (quote) => { quote.payments[1].sessionId = quote.payments[0].sessionId; },
    (quote) => { quote.payments[1].paymentIntentId = quote.payments[0].paymentIntentId; },
    (quote) => { quote.payments.push(structuredClone(quote.payments[0])); },
  ];
  for (const corrupt of corruptions) {
    const quote = structuredClone(paid);
    corrupt(quote);
    assert.throws(() => readInstalmentProgress(quote), PortalError, corrupt.toString());
    assert.throws(() => nextPayment(quote), PortalError, corrupt.toString());
    assert.throws(() => publicPaymentArrangement(quote, 0), PortalError, corrupt.toString());
  }
});

test('all 15 checkout settlements advance exactly once and stop at the agreed total', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  let quote = instalmentQuote();
  await store.setJSON(quoteKey(quote), quote);
  assert.deepEqual(publicPaymentArrangement(quote, 0).paymentPlan, publicPlan(0));
  for (let index = 0; index < 15; index += 1) {
    const result = await openQuoteCheckout(quote.id, stripe, store);
    quote = await store.get(quoteKey(quote));
    const session = stripe.sessions.get(quote.checkout.sessionId);
    assert.equal(result.url, session.url);
    assert.equal(session.amount_total, expectedAmounts[index]);
    assert.equal(session.metadata.payment_stage, `instalment_${index + 1}`);
    session.payment_status = 'paid';
    session.status = 'complete';
    quote = await settleQuotePayment(session, store);
    assert.equal(quote.payments.length, index + 1);
    assert.equal(grossPaid(quote), expectedAmounts.slice(0, index + 1).reduce((sum, amount) => sum + amount, 0));
    assert.equal(quote.status, index === 14 ? 'paid' : 'deposit_paid');
    assert.equal(quote.checkout, null);
    assert.deepEqual(publicQuote(quote).paymentPlan, publicPlan(index + 1));
    assert.deepEqual(publicPaymentArrangement(quote, grossPaid(quote)).paymentPlan, publicPlan(index + 1));
    assertNextPayment(quote, index === 14 ? null : {
      stage: `instalment_${index + 2}`, amountCents: expectedAmounts[index + 1], instalmentNumber: index + 2, instalmentCount: 15,
    });
  }
  assert.equal(stripe.creations, 15);
  assert.equal(grossPaid(quote), 290000);
  await assert.rejects(openQuoteCheckout(quote.id, stripe, store), PortalError);
  assert.equal(stripe.creations, 15);
});

test('simultaneous clicks and duplicate webhooks create one checkout and one instalment record', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  const quote = instalmentQuote();
  await store.setJSON(quoteKey(quote), quote);
  const results = await Promise.all(Array.from({ length: 3 }, () => openQuoteCheckout(quote.id, stripe, store)));
  assert.equal(new Set(results.map((result) => result.url)).size, 1);
  assert.equal(stripe.creations, 1);
  const opened = await store.get(quoteKey(quote));
  const session = stripe.sessions.get(opened.checkout.sessionId);
  session.payment_status = 'paid';
  await Promise.all(Array.from({ length: 3 }, () => settleQuotePayment(session, store)));
  const paid = await store.get(quoteKey(quote));
  assert.equal(paid.payments.length, 1);
  assert.equal(nextPayment(paid).stage, 'instalment_2');
  assert.equal(await store.get(`quote-payment/${session.payment_intent}`), quote.id);
});

test('replaying an earlier paid event while the next checkout is open cannot clear or advance that checkout', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  const quote = instalmentQuote();
  await store.setJSON(quoteKey(quote), quote);
  await openQuoteCheckout(quote.id, stripe, store);
  let current = await store.get(quoteKey(quote));
  const previousSession = stripe.sessions.get(current.checkout.sessionId);
  previousSession.payment_status = 'paid';
  await settleQuotePayment(previousSession, store);
  await openQuoteCheckout(quote.id, stripe, store);
  current = await store.get(quoteKey(quote));
  const nextAttempt = structuredClone(current.checkout);
  await Promise.all([settleQuotePayment(previousSession, store), openQuoteCheckout(quote.id, stripe, store)]);
  current = await store.get(quoteKey(quote));
  assert.equal(current.payments.length, 1);
  assert.deepEqual(current.checkout, nextAttempt);
  assert.equal(current.checkout.stage, 'instalment_2');
  assert.equal(stripe.creations, 2);
});

test('instalment settlement validates the approved amount, currency, stage and checkout identity', () => {
  const quote = attemptedQuote();
  const session = paidSession(quote);
  for (const changes of [
    { amount_total: 290000 }, { amount_total: 19333 }, { currency: 'usd' }, { id: 'cs_other' }, { payment_intent: null },
    { metadata: { ...session.metadata, checkout_version: 'wrong' } },
    { metadata: { ...session.metadata, quote_id: 'a'.repeat(32) } },
    { metadata: { ...session.metadata, quote_revision: '2' } },
    { metadata: { ...session.metadata, attempt_id: 'another-attempt' } },
    { metadata: { ...session.metadata, payment_stage: 'instalment_2' } },
  ]) assert.throws(() => applyPaidSession(quote, { ...session, ...changes }), PortalError);
  assert.equal(quote.payments.length, 0);
});

test('a corrupted existing attempt cannot bypass the fixed instalment schedule, even when its Stripe session agrees', async () => {
  for (const change of [
    { stage: 'full', amountCents: 290000 },
    { stage: 'instalment_2', instalmentNumber: 2 },
    { amountCents: 290000 },
    { instalmentCount: 14 },
  ]) {
    const quote = attemptedQuote();
    Object.assign(quote.checkout, change);
    const session = paidSession(quote);
    assert.throws(() => applyPaidSession(quote, session), PortalError);
    const store = new MemoryStore();
    const stripe = fakeStripe();
    stripe.sessions.set(session.id, { ...session, payment_status: 'unpaid', status: 'open', url: `https://checkout.stripe.com/c/pay/${session.id}` });
    await store.setJSON(quoteKey(quote), quote);
    await assert.rejects(openQuoteCheckout(quote.id, stripe, store), PortalError);
    assert.equal(stripe.creations, 0);
    assert.equal((await store.get(quoteKey(quote))).payments.length, 0);
  }
});

test('a previously recorded payment intent cannot fund a second instalment', () => {
  const first = attemptedQuote();
  const firstSession = paidSession(first);
  const second = attemptedQuote(applyPaidSession(first, firstSession), 'second');
  assert.throws(() => applyPaidSession(second, paidSession(second, { payment_intent: firstSession.payment_intent })), PortalError);
  assert.equal(second.payments.length, 1);
});

test('unpaid sessions do not advance the plan and a paid return is reconciled exactly once', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  const quote = attemptedQuote();
  const session = paidSession(quote, { payment_status: 'unpaid', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_instalment_first' });
  stripe.sessions.set(session.id, session);
  await store.setJSON(quoteKey(quote), quote);
  assert.equal(applyPaidSession(quote, session), quote);
  assert.equal((await settleQuotePayment(session, store)).payments.length, 0);
  assert.equal(await store.get(`quote-payment/${session.payment_intent}`), null);
  session.payment_status = 'paid';
  assert.deepEqual(await openQuoteCheckout(quote.id, stripe, store), { awaitingConfirmation: true });
  assert.equal((await store.get(quoteKey(quote))).payments.length, 0);
  let notifications = 0;
  const settled = await reconcileQuoteCheckout(quote, stripe, store, async () => { notifications += 1; });
  assert.equal(settled.payments.length, 1);
  assert.equal(nextPayment(settled).stage, 'instalment_2');
  assert.equal(notifications, 1);
  await settleQuotePayment(session, store);
  assert.equal((await store.get(quoteKey(quote))).payments.length, 1);
});

test('approval and quote expiry protect the first instalment while an active paid plan can continue', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  for (const quote of [instalmentQuote({}, false), { ...instalmentQuote(), expiresAt: '2000-01-01T00:00:00Z' }]) {
    assert.equal(nextPayment(quote), null);
    await store.setJSON(quoteKey(quote), quote);
    await assert.rejects(openQuoteCheckout(quote.id, stripe, store), PortalError);
  }
  assert.equal(stripe.creations, 0);
  const first = attemptedQuote();
  const active = { ...applyPaidSession(first, paidSession(first)), expiresAt: '2000-01-01T00:00:00Z' };
  assertNextPayment(active, { stage: 'instalment_2', amountCents: 19334, instalmentNumber: 2, instalmentCount: 15 });
});

test('refund and dispute events retain their review hold when an instalment payment settles afterwards', async () => {
  for (const [reason, charge] of [
    ['refund', { amount_refunded: 19334 }],
    ['dispute', { disputed: true }],
  ]) {
    const store = new MemoryStore();
    const stripe = fakeStripe();
    const quote = attemptedQuote();
    const session = paidSession(quote);
    await store.setJSON(quoteKey(quote), quote);
    await markQuotePaymentReview({ payment_intent: session.payment_intent, ...charge }, reason, store, quote.id);
    const reviewed = await settleQuotePayment(session, store);
    assert.equal(reviewed.status, 'payment_review');
    assert.equal(reviewed.payments.length, 1);
    assert.equal(reviewed.payments[0].refundedCents, charge.amount_refunded || 0);
    assert.equal(reviewed.payments[0].disputed, Boolean(charge.disputed));
    assert.equal(nextPayment(reviewed), null);
    assert.equal(publicQuote(reviewed).paymentPlan.paidInstalments, 1);
    await assert.rejects(openQuoteCheckout(quote.id, stripe, store), PortalError);
    assert.equal(stripe.creations, 0);
  }
});

test('public instalment progress exposes amounts and ordinals without client secrets or Stripe payment identifiers', () => {
  const first = attemptedQuote();
  const quote = attemptedQuote(applyPaidSession(first, paidSession(first)), 'second');
  const safe = publicQuote(quote);
  assert.deepEqual(safe.paymentPlan, publicPlan(1));
  assert.equal(safe.paidCents, 19334);
  for (const key of ['publicToken', 'customerEmail', 'partnerEmail', 'partnerId', 'approvedBy', 'checkout']) assert.equal(key in safe, false);
  for (const key of ['sessionId', 'paymentIntentId']) assert.equal(key in safe.payments[0], false);
  const serialized = JSON.stringify(safe);
  for (const secret of [quote.publicToken, quote.customerEmail, quote.partnerEmail, quote.partnerId, quote.checkout.id, quote.checkout.sessionId, quote.payments[0].paymentIntentId]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('Stripe checkout labels each part clearly and uses one-time on-session payments', () => {
  let quote = instalmentQuote();
  for (let index = 1; index <= 15; index += 1) {
    quote = attemptedQuote(quote, `label-${index}`);
    const params = checkoutParameters(quote, quote.checkout);
    const price = params.line_items[0].price_data;
    assert.match(price.product_data.name, new RegExp(`(?:instalment|payment|part) ${index} of 15`, 'i'));
    assert.equal(price.unit_amount, expectedAmounts[index - 1]);
    assert.equal(price.currency, 'aud');
    assert.equal(params.mode, 'payment');
    assert.equal(params.payment_method_types, undefined);
    assert.equal(params.customer_email, input.customerEmail);
    assert.equal(params.line_items[0].quantity, 1);
    assert.equal(price.recurring, undefined);
    assert.equal(params.subscription_data, undefined);
    assert.equal(params.payment_intent_data.setup_future_usage, undefined);
    assert.equal(params.payment_intent_data.off_session, undefined);
    assert.equal(params.allow_promotion_codes, undefined);
    assert.equal(params.discounts, undefined);
    quote = applyPaidSession(quote, paidSession(quote));
  }
});

test('a failed asynchronous quote payment releases the matching checkout only once', async () => {
  const store = new MemoryStore();
  const stripe = fakeStripe();
  const original = instalmentQuote();
  await store.setJSON(quoteKey(original), original);
  await openQuoteCheckout(original.id, stripe, store);
  const quote = await store.get(quoteKey(original));
  const session = stripe.sessions.get(quote.checkout.sessionId);
  const released = await releaseFailedQuoteCheckout(session, store);
  assert.equal(released.checkout, null);
  const repeated = await releaseFailedQuoteCheckout(session, store);
  assert.equal(repeated.checkout, null);
});
