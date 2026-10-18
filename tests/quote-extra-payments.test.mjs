import assert from 'node:assert/strict';
import test from 'node:test';
import { PortalError } from '../netlify/lib/portal-auth.mjs';
import { readInstalmentProgress } from '../netlify/lib/instalments.mjs';
import { applyPaidSession, createQuote, CUSTOM_CHECKOUT_VERSION, grossPaid, nextPayment, publicQuote, settleQuotePayment } from '../netlify/lib/quotes.mjs';
import { checkoutParameters, openQuoteCheckout } from '../netlify/lib/quote-checkout.mjs';

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

function fakeStripe() {
  const sessions = new Map();
  const keys = new Map();
  const operations = [];
  let creations = 0;
  const stripe = {
    sessions, keys, operations, onExpire: null,
    get creations() { return creations; },
    checkout: { sessions: {
      async create(params, options) {
        operations.push({ action: 'create', amountCents: params.line_items[0].price_data.unit_amount, key: options.idempotencyKey });
        if (keys.has(options.idempotencyKey)) return structuredClone(sessions.get(keys.get(options.idempotencyKey)));
        const id = `cs_extra_${++creations}`;
        const session = {
          id, status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/c/pay/${id}`,
          amount_total: params.line_items[0].price_data.unit_amount, currency: 'aud',
          metadata: structuredClone(params.metadata), payment_intent: `pi_${id}`,
        };
        keys.set(options.idempotencyKey, id); sessions.set(id, session);
        return structuredClone(session);
      },
      async retrieve(id) {
        operations.push({ action: 'retrieve', id });
        const session = sessions.get(id);
        if (!session) throw new Error('Unknown Stripe checkout session.');
        return structuredClone(session);
      },
      async expire(id) {
        operations.push({ action: 'expire', id });
        const session = sessions.get(id);
        if (stripe.onExpire) await stripe.onExpire(session);
        if (!session || session.status !== 'open' || session.payment_status !== 'unpaid') throw new Error('Session cannot expire.');
        session.status = 'expired';
        return structuredClone(session);
      },
    } },
  };
  return stripe;
}

const quoteKey = (quote) => `quote/${quote.id}`;
function makeQuote(total = '1500.00') {
  return createQuote({
    service: 'Custom website', description: 'A responsive custom website with bookings and online payment features.',
    customerName: 'Sample Client', customerEmail: 'client@example.test', total, deposit: '0', paymentPlan: 'instalments_15',
  }, { id: 'owner-test', name: 'Sample Owner', email: 'owner@example.test' }, 'BO-AB12CD34EF', true);
}
async function setup(total) {
  const quote = makeQuote(total); const store = new MemoryStore(); const stripe = fakeStripe();
  await store.setJSON(quoteKey(quote), quote);
  return { quote, store, stripe };
}
async function pay(state, options) {
  const result = await openQuoteCheckout(state.quote.id, state.stripe, state.store, options);
  const opened = await state.store.get(quoteKey(state.quote));
  const session = state.stripe.sessions.get(opened.checkout.sessionId);
  assert.equal(result.url, session.url);
  session.status = 'complete'; session.payment_status = 'paid';
  return { quote: await settleQuotePayment(session, state.store), session: structuredClone(session), attempt: structuredClone(opened.checkout) };
}
const allocation = (quote) => publicQuote(quote).paymentPlan.schedule.map(({ number, amountCents, paidCents, remainingCents, paid, partial }) => ({ number, amountCents, paidCents, remainingCents, paid, partial }));
const openSessions = (stripe) => [...stripe.sessions.values()].filter((session) => session.status === 'open');

test('extra payments cover the earliest parts first and expose a partial next instalment', async () => {
  const state = await setup();
  const initial = nextPayment(state.quote);
  assert.equal(initial.amountCents, 10000);
  assert.equal(initial.maxExtraCents, 140000);
  assert.equal(initial.minimumPaymentCents, 50);
  const result = await pay(state, { extraAmount: '150.00', expectedPaidCents: 0 });
  assert.equal(result.session.amount_total, 25000);
  assert.equal(result.attempt.baseAmountCents, 10000);
  assert.equal(result.attempt.extraAmountCents, 15000);
  assert.equal(result.quote.payments[0].baseAmountCents, 10000);
  assert.equal(result.quote.payments[0].extraAmountCents, 15000);
  assert.equal(result.quote.payments.length, 1);
  assert.equal(result.quote.status, 'deposit_paid');
  assert.equal(grossPaid(result.quote), 25000);
  assert.deepEqual(allocation(result.quote).slice(0, 4), [
    { number: 1, amountCents: 10000, paidCents: 10000, remainingCents: 0, paid: true, partial: false },
    { number: 2, amountCents: 10000, paidCents: 10000, remainingCents: 0, paid: true, partial: false },
    { number: 3, amountCents: 10000, paidCents: 5000, remainingCents: 5000, paid: false, partial: true },
    { number: 4, amountCents: 10000, paidCents: 0, remainingCents: 10000, paid: false, partial: false },
  ]);
  const plan = readInstalmentProgress(result.quote);
  assert.equal(plan.paidInstalments, 2);
  assert.equal(plan.remainingInstalments, 13);
  assert.equal(plan.balanceCents, 125000);
  assert.equal(nextPayment(result.quote).stage, 'instalment_3');
  assert.equal(nextPayment(result.quote).amountCents, 5000);
  assert.equal(nextPayment(result.quote).maxExtraCents, 120000);
});

test('paying the remaining balance early completes all 15 parts in fewer than 15 transactions', async () => {
  const state = await setup();
  await pay(state, { extraAmount: '150.00', expectedPaidCents: 0 });
  const final = await pay(state, { extraAmount: '1200.00', expectedPaidCents: 25000 });
  assert.equal(final.session.amount_total, 125000);
  assert.equal(final.quote.payments.length, 2);
  assert.equal(final.quote.payments[1].stage, 'instalment_3');
  assert.equal(grossPaid(final.quote), 150000);
  assert.equal(final.quote.status, 'paid');
  assert.equal(nextPayment(final.quote), null);
  const plan = publicQuote(final.quote).paymentPlan;
  assert.equal(plan.paidInstalments, 15);
  assert.equal(plan.remainingInstalments, 0);
  assert.equal(plan.balanceCents, 0);
  assert.ok(plan.schedule.every((part) => part.paid && part.remainingCents === 0 && part.paidCents === part.amountCents));
  await assert.rejects(openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '0' }), PortalError);
  assert.equal(state.stripe.creations, 2);
});

test('the maximum extra can pay the complete agreed total in the first transaction', async () => {
  const state = await setup();
  const result = await pay(state, { extraAmount: '1400.00', expectedPaidCents: 0 });
  assert.equal(result.session.amount_total, 150000);
  assert.equal(result.quote.payments.length, 1);
  assert.equal(result.quote.status, 'paid');
  assert.equal(readInstalmentProgress(result.quote).paidInstalments, 15);
  assert.equal(nextPayment(result.quote), null);
});

test('a tiny part remainder is combined with the next part to meet the 50-cent checkout minimum', async () => {
  const state = await setup('100.00');
  const first = await pay(state, { extraAmount: '6.60', expectedPaidCents: 0 });
  assert.equal(first.session.amount_total, 1327);
  assert.equal(allocation(first.quote)[1].remainingCents, 7);
  const due = nextPayment(first.quote);
  assert.equal(due.stage, 'instalment_2');
  assert.equal(due.amountCents, 50);
  assert.equal(due.instalmentEndNumber, 3);
  assert.equal(due.minimumPaymentCents, 50);
  const second = await pay(state, { extraAmount: '0', expectedPaidCents: 1327 });
  assert.equal(second.session.amount_total, 50);
  assert.equal(second.quote.payments[1].baseAmountCents, 50);
  assert.equal(second.quote.payments[1].extraAmountCents, 0);
  assert.deepEqual(allocation(second.quote).slice(1, 3), [
    { number: 2, amountCents: 667, paidCents: 667, remainingCents: 0, paid: true, partial: false },
    { number: 3, amountCents: 667, paidCents: 43, remainingCents: 624, paid: false, partial: true },
  ]);
  assert.equal(nextPayment(second.quote).amountCents, 624);
});

test('extra validation rejects invalid money, overpayment and unchargeable residual balances before contacting Stripe', async () => {
  for (const extraAmount of ['-1', '1.001', '1e2', 'Infinity', 'NaN', 'invalid', {}, [], true, '1400.01', '1399.99', '1399.51']) {
    const state = await setup();
    await assert.rejects(openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount, expectedPaidCents: 0 }), PortalError, JSON.stringify(extraAmount));
    assert.equal(state.stripe.creations, 0);
    assert.equal((await state.store.get(quoteKey(state.quote))).checkout, null);
  }
  const state = await setup();
  const first = await pay(state, { extraAmount: '1399.50', expectedPaidCents: 0 });
  assert.equal(readInstalmentProgress(first.quote).balanceCents, 50);
  assert.equal(nextPayment(first.quote).amountCents, 50);
  const final = await pay(state, { extraAmount: '0', expectedPaidCents: 149950 });
  assert.equal(final.quote.status, 'paid');
  assert.equal(grossPaid(final.quote), 150000);
});

test('a stale displayed paid balance cannot silently charge a newly calculated instalment', async () => {
  const state = await setup();
  await pay(state, { extraAmount: '0', expectedPaidCents: 0 });
  await assert.rejects(openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '100.00', expectedPaidCents: 0 }), PortalError);
  assert.equal(state.stripe.creations, 1);
  assert.equal((await state.store.get(quoteKey(state.quote))).checkout, null);
  const next = await pay(state, { extraAmount: '100.00', expectedPaidCents: 10000 });
  assert.equal(next.session.amount_total, 20000);
});

test('concurrent identical extra requests reuse one Stripe checkout and settle once', async () => {
  const state = await setup();
  const options = { extraAmount: '50.00', expectedPaidCents: 0 };
  const results = await Promise.all(Array.from({ length: 3 }, () => openQuoteCheckout(state.quote.id, state.stripe, state.store, options)));
  assert.equal(new Set(results.map((result) => result.url)).size, 1);
  assert.equal(state.stripe.creations, 1);
  const session = openSessions(state.stripe)[0];
  assert.equal(session.amount_total, 15000);
  session.status = 'complete'; session.payment_status = 'paid';
  await Promise.all(Array.from({ length: 3 }, () => settleQuotePayment(session, state.store)));
  const quote = await state.store.get(quoteKey(state.quote));
  assert.equal(quote.payments.length, 1);
  assert.equal(grossPaid(quote), 15000);
  assert.equal(readInstalmentProgress(quote).paidInstalments, 1);
  assert.equal(allocation(quote)[1].paidCents, 5000);
});

test('concurrent different extra requests leave at most one payable Stripe checkout', async () => {
  const state = await setup();
  const results = await Promise.allSettled(['50.00', '150.00'].map((extraAmount) => openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount, expectedPaidCents: 0 })));
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.ok(result.reason instanceof PortalError);
  const current = await state.store.get(quoteKey(state.quote));
  const open = openSessions(state.stripe);
  assert.equal(open.length, 1);
  assert.equal(current.checkout.sessionId, open[0].id);
  assert.ok([15000, 25000].includes(open[0].amount_total));
  assert.ok([...state.stripe.sessions.values()].every((session) => session.id === open[0].id || session.status === 'expired'));
  assert.equal(current.payments.length, 0);
});

test('changing the extra expires the old unpaid checkout before creating a replacement', async () => {
  const state = await setup();
  const first = await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 });
  const firstQuote = await state.store.get(quoteKey(state.quote));
  const repeated = await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 });
  assert.equal(repeated.url, first.url);
  assert.equal(state.stripe.creations, 1);
  const changed = await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '0.00', expectedPaidCents: 0 });
  const current = await state.store.get(quoteKey(state.quote));
  assert.notEqual(changed.url, first.url);
  assert.notEqual(current.checkout.id, firstQuote.checkout.id);
  assert.equal(state.stripe.sessions.get(firstQuote.checkout.sessionId).status, 'expired');
  assert.equal(current.checkout.amountCents, 10000);
  const expiration = state.stripe.operations.findIndex((operation) => operation.action === 'expire');
  const replacement = state.stripe.operations.findIndex((operation, index) => index > expiration && operation.action === 'create');
  assert.ok(expiration >= 0 && replacement > expiration);
  assert.equal(openSessions(state.stripe).length, 1);
});

test('a payment that wins the expire-versus-pay race blocks replacement until confirmation', async () => {
  const state = await setup();
  await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 });
  const old = await state.store.get(quoteKey(state.quote));
  state.stripe.onExpire = async (session) => {
    session.status = 'complete'; session.payment_status = 'paid';
    throw new Error('The customer completed payment before expiry.');
  };
  assert.deepEqual(await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '150.00', expectedPaidCents: 0 }), { awaitingConfirmation: true });
  assert.equal(state.stripe.creations, 1);
  assert.equal((await state.store.get(quoteKey(state.quote))).checkout.sessionId, old.checkout.sessionId);
  const quote = await settleQuotePayment(state.stripe.sessions.get(old.checkout.sessionId), state.store);
  assert.equal(quote.payments.length, 1);
  assert.equal(grossPaid(quote), 15000);
  assert.equal(nextPayment(quote).amountCents, 5000);
});

test('failed expiry is rechecked and an uncertain open session never permits a second checkout', async () => {
  const state = await setup();
  await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '0', expectedPaidCents: 0 });
  const old = await state.store.get(quoteKey(state.quote));
  state.stripe.operations.length = 0;
  state.stripe.onExpire = async () => { throw new Error('Stripe response was lost.'); };
  await assert.rejects(openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 }), PortalError);
  const expiration = state.stripe.operations.findIndex((operation) => operation.action === 'expire');
  assert.ok(expiration >= 0);
  assert.ok(state.stripe.operations.slice(expiration + 1).some((operation) => operation.action === 'retrieve'));
  assert.equal(state.stripe.creations, 1);
  assert.equal((await state.store.get(quoteKey(state.quote))).checkout.id, old.checkout.id);
  assert.equal(openSessions(state.stripe).length, 1);
});

test('an expiry response lost after successful cancellation can be safely recovered by retrieval', async () => {
  const state = await setup();
  await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '0', expectedPaidCents: 0 });
  state.stripe.onExpire = async (session) => { session.status = 'expired'; throw new Error('Response lost after expiry.'); };
  const result = await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 });
  assert.equal(state.stripe.creations, 2);
  assert.equal(openSessions(state.stripe).length, 1);
  assert.equal(openSessions(state.stripe)[0].amount_total, 15000);
  assert.equal(result.url, openSessions(state.stripe)[0].url);
});

test('completed but unpaid processing sessions cannot be replaced by changing the amount', async () => {
  const state = await setup();
  await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '0', expectedPaidCents: 0 });
  const current = await state.store.get(quoteKey(state.quote));
  state.stripe.sessions.get(current.checkout.sessionId).status = 'complete';
  await assert.rejects(openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 }), PortalError);
  assert.equal(state.stripe.creations, 1);
  assert.equal(state.stripe.operations.some((operation) => operation.action === 'expire'), false);
});

test('an uncertain original attempt is recovered with its original idempotency key and amount before replacement', async () => {
  const state = await setup();
  const attempt = { ...nextPayment(state.quote), id: 'uncertain-original', baseAmountCents: 10000, extraAmountCents: 0, amountCents: 10000, createdAt: Date.now() };
  const quote = { ...state.quote, checkout: attempt };
  await state.store.setJSON(quoteKey(quote), quote);
  const original = await state.stripe.checkout.sessions.create(checkoutParameters(quote, attempt), { idempotencyKey: `bo-custom-${quote.id}-${attempt.id}` });
  const result = await openQuoteCheckout(quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 0 });
  const creates = state.stripe.operations.filter((operation) => operation.action === 'create');
  assert.equal(creates[0].key, creates[1].key);
  assert.equal(creates[0].amountCents, 10000);
  assert.equal(creates[1].amountCents, 10000);
  assert.equal(state.stripe.sessions.get(original.id).status, 'expired');
  assert.equal(state.stripe.creations, 2);
  assert.equal(result.url, openSessions(state.stripe)[0].url);
  assert.equal(openSessions(state.stripe)[0].amount_total, 15000);
});

test('an earlier extra-payment webhook cannot overwrite the next active checkout or allocate money twice', async () => {
  const state = await setup();
  const first = await pay(state, { extraAmount: '150.00', expectedPaidCents: 0 });
  await openQuoteCheckout(state.quote.id, state.stripe, state.store, { extraAmount: '50.00', expectedPaidCents: 25000 });
  const before = await state.store.get(quoteKey(state.quote));
  await Promise.all([settleQuotePayment(first.session, state.store), settleQuotePayment(first.session, state.store)]);
  const after = await state.store.get(quoteKey(state.quote));
  assert.deepEqual(after.checkout, before.checkout);
  assert.equal(after.payments.length, 1);
  assert.equal(grossPaid(after), 25000);
  assert.equal(readInstalmentProgress(after).paidInstalments, 2);
});

test('legacy exact instalment records and attempts remain valid alongside new extra-payment records', async () => {
  const state = await setup();
  const legacyPayments = [1, 2].map((number) => ({
    stage: `instalment_${number}`, amountCents: 10000, sessionId: `cs_legacy_${number}`,
    paymentIntentId: `pi_legacy_${number}`, paidAt: '2026-10-18T00:00:00Z',
  }));
  const quote = { ...state.quote, status: 'deposit_paid', payments: legacyPayments };
  assert.equal(readInstalmentProgress(quote).paidInstalments, 2);
  await state.store.setJSON(quoteKey(quote), quote);
  const result = await pay(state, { extraAmount: '50.00', expectedPaidCents: 20000 });
  assert.equal(result.quote.payments.length, 3);
  assert.equal(grossPaid(result.quote), 35000);
  assert.equal(readInstalmentProgress(result.quote).paidInstalments, 3);
  assert.equal(nextPayment(result.quote).amountCents, 5000);
  const legacyAttempt = { id: 'legacy-attempt', sessionId: 'cs_legacy_attempt', stage: 'instalment_4', amountCents: 5000, createdAt: Date.now() };
  const pending = { ...result.quote, checkout: legacyAttempt };
  const session = {
    id: legacyAttempt.sessionId, payment_intent: 'pi_legacy_attempt', amount_total: 5000, currency: 'aud', payment_status: 'paid',
    metadata: { checkout_version: CUSTOM_CHECKOUT_VERSION, quote_id: quote.id, quote_revision: String(quote.revision), attempt_id: legacyAttempt.id, payment_stage: legacyAttempt.stage },
  };
  const settled = applyPaidSession(pending, session);
  assert.equal(grossPaid(settled), 40000);
  assert.equal(readInstalmentProgress(settled).paidInstalments, 4);
  assert.equal(nextPayment(settled).stage, 'instalment_5');
});

test('extra-payment history rejects changed totals, invented base amounts and malformed contribution fields', async () => {
  const state = await setup();
  const result = await pay(state, { extraAmount: '150.00', expectedPaidCents: 0 });
  for (const corrupt of [
    (payment) => { payment.amountCents += 1; },
    (payment) => { payment.baseAmountCents += 1; payment.extraAmountCents -= 1; },
    (payment) => { payment.extraAmountCents = -1; },
    (payment) => { payment.extraAmountCents = 15000.5; },
    (payment) => { delete payment.baseAmountCents; },
    (payment) => { delete payment.extraAmountCents; },
    (payment) => { delete payment.extraAmountCents; delete payment.baseAmountCents; },
    (payment) => { payment.stage = 'instalment_2'; },
  ]) {
    const quote = structuredClone(result.quote); corrupt(quote.payments[0]);
    assert.throws(() => readInstalmentProgress(quote), PortalError, corrupt.toString());
    assert.throws(() => nextPayment(quote), PortalError, corrupt.toString());
  }
});
