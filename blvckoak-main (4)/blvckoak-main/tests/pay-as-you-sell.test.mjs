import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuote, nextPayment, publicQuote } from '../netlify/lib/quotes.mjs';
import { adjustConnectedSale, createSalesConnectionUrl, maintenanceCheckoutParameters, publicPaymentArrangement, recordConnectedSale, salesContributionCents, settleMaintenanceCheckout, stopCompletedSalesTracking, validatePaymentArrangement } from '../netlify/lib/pay-as-you-sell.mjs';

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

const account = { id: 'owner-1', name: 'Black Oak Owner', email: 'owner@example.test' };
const base = { service: 'Online store', description: 'A complete ecommerce website connected to the client Stripe account.', customerName: 'Demo Client', customerEmail: 'client@example.test', total: '2400', deposit: '600' };
const payQuote = (changes = {}) => createQuote({ ...base, paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'percentage', payAsYouSellPercent: '10', ...changes }, account, 'BO-AB12CD34EF', true);

test('all three Pay as You Sell calculation methods are available and bounded', () => {
  const percentage = validatePaymentArrangement({ paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'percentage', payAsYouSellPercent: '12.5' });
  assert.equal(percentage.paymentPlan.rateBps, 1250);
  const fixed = validatePaymentArrangement({ paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'fixed_per_sale', payAsYouSellAmount: '50' });
  assert.equal(fixed.paymentPlan.amountCents, 5000);
  const milestone = validatePaymentArrangement({ paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'sales_milestone', payAsYouSellAmount: '200', payAsYouSellSalesCount: '5' });
  assert.equal(milestone.paymentPlan.salesPerPayment, 5);
  for (const invalid of [
    { paymentPlan: 'unknown' },
    { paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: '__proto__', payAsYouSellPercent: '10' },
    { paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'percentage', payAsYouSellPercent: '0' },
    { paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'fixed_per_sale', payAsYouSellAmount: '1' },
    { paymentPlan: 'pay_as_you_sell', payAsYouSellMethod: 'sales_milestone', payAsYouSellAmount: '50', payAsYouSellSalesCount: '0' },
  ]) assert.throws(() => validatePaymentArrangement(invalid));
});

test('a deposit is due first, then only the amount accrued from recorded sales', async () => {
  const store = new MemoryStore();
  const quote = payQuote();
  quote.paymentPlan = { ...quote.paymentPlan, connectionStatus: 'connected', connectedStripeAccountId: 'acct_demo123' };
  await store.setJSON(`quote/${quote.id}`, quote);
  await store.set(`pay-as-you-sell-account/acct_demo123`, quote.id);
  assert.deepEqual(nextPayment(quote), { stage: 'deposit', amountCents: 60000 });
  const recorded = await recordConnectedSale({ id: 'pi_sale123', status: 'succeeded', currency: 'aud', amount_received: 100000, created: 1788336000 }, 'acct_demo123', store);
  assert.equal(salesContributionCents(recorded), 10000);
  const afterDeposit = { ...recorded, status: 'deposit_paid', payments: [{ amountCents: 60000, refundedCents: 0 }] };
  assert.deepEqual(nextPayment(afterDeposit), { stage: 'sales_contribution', amountCents: 10000 });
  assert.equal((await recordConnectedSale({ id: 'pi_sale123', status: 'succeeded', currency: 'aud', amount_received: 100000 }, 'acct_demo123', store)).paymentPlan.sales.length, 1);
});

test('fixed and milestone contributions stop at the unpaid website price', () => {
  const fixed = payQuote({ deposit: '0', payAsYouSellMethod: 'fixed_per_sale', payAsYouSellAmount: '500' });
  fixed.paymentPlan.sales = [1, 2, 3, 4, 5].map((index) => ({ paymentIntentId: `pi_${index}`, netCents: 100000 }));
  assert.equal(salesContributionCents(fixed), fixed.totalCents);
  const milestone = payQuote({ deposit: '0', payAsYouSellMethod: 'sales_milestone', payAsYouSellAmount: '200', payAsYouSellSalesCount: '3' });
  milestone.paymentPlan.sales = [1, 2, 3, 4, 5, 6, 7].map((index) => ({ paymentIntentId: `pi_m${index}`, netCents: 1000 }));
  assert.equal(salesContributionCents(milestone), 40000);
});

test('Stripe refunds and disputes reduce an unpaid sales-linked contribution', async () => {
  const store = new MemoryStore();
  const quote = payQuote({ deposit: '0' });
  quote.paymentPlan = { ...quote.paymentPlan, connectionStatus: 'connected', connectedStripeAccountId: 'acct_refunds123', sales: [{ paymentIntentId: 'pi_refund123', grossCents: 100000, netCents: 100000, disputed: false }] };
  await store.setJSON(`quote/${quote.id}`, quote); await store.set('pay-as-you-sell-account/acct_refunds123', quote.id);
  const refunded = await adjustConnectedSale({ payment_intent: 'pi_refund123', amount: 100000, amount_refunded: 40000 }, 'acct_refunds123', store);
  assert.equal(salesContributionCents(refunded), 6000);
  const disputed = await adjustConnectedSale({ payment_intent: 'pi_refund123', amount: 100000, amount_refunded: 40000 }, 'acct_refunds123', store, true);
  assert.equal(salesContributionCents(disputed), 0);
});

test('client data shows aggregates but never Stripe account or payment intent identifiers', () => {
  const quote = payQuote();
  quote.paymentPlan = { ...quote.paymentPlan, connectionStatus: 'connected', connectedStripeAccountId: 'acct_private123', sales: [{ paymentIntentId: 'pi_private123', grossCents: 100000, netCents: 100000, disputed: false }] };
  const safe = publicQuote(quote);
  assert.equal(safe.paymentPlan.connected, true);
  assert.equal(safe.paymentPlan.grossSalesCents, 100000);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('acct_private123'), false);
  assert.equal(serialized.includes('pi_private123'), false);
});

test('Stripe sales connection uses read-only OAuth and a one-time state', async () => {
  const previous = { site: process.env.SITE_URL, client: process.env.STRIPE_CONNECT_CLIENT_ID };
  try {
    process.env.SITE_URL = 'https://blackoak.example'; process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_testclient123';
    const store = new MemoryStore(); const url = new URL(await createSalesConnectionUrl(payQuote(), store));
    assert.equal(url.origin, 'https://connect.stripe.com');
    assert.equal(url.searchParams.get('scope'), 'read_only');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://blackoak.example/api/stripe/connect/callback');
    assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
    assert.equal([...store.map.keys()].some((key) => key.startsWith('pay-as-you-sell-oauth/')), true);
  } finally {
    if (previous.site === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous.site;
    if (previous.client === undefined) delete process.env.STRIPE_CONNECT_CLIENT_ID; else process.env.STRIPE_CONNECT_CLIENT_ID = previous.client;
  }
});

test('sales tracking disconnects automatically when the website total is paid', async () => {
  const previous = process.env.STRIPE_CONNECT_CLIENT_ID;
  try {
    process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_testclient123';
    const store = new MemoryStore(); const quote = payQuote();
    quote.status = 'paid'; quote.payments = [{ amountCents: quote.totalCents, refundedCents: 0 }];
    quote.paymentPlan = { ...quote.paymentPlan, connectionStatus: 'connected', connectedStripeAccountId: 'acct_complete123' };
    await store.setJSON(`quote/${quote.id}`, quote); await store.set('pay-as-you-sell-account/acct_complete123', quote.id);
    let deauthorized = null;
    const updated = await stopCompletedSalesTracking(quote, { oauth: { deauthorize: async (values) => { deauthorized = values; } } }, store);
    assert.equal(updated.paymentPlan.connectionStatus, 'completed');
    assert.equal(await store.get('pay-as-you-sell-account/acct_complete123'), null);
    assert.deepEqual(deauthorized, { client_id: 'ca_testclient123', stripe_user_id: 'acct_complete123' });
    assert.equal(publicPaymentArrangement(updated, updated.totalCents).paymentPlan.trackingComplete, true);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_CONNECT_CLIENT_ID; else process.env.STRIPE_CONNECT_CLIENT_ID = previous;
  }
});

test('maintenance is a separately accepted monthly Stripe subscription', async () => {
  const previous = process.env.SITE_URL;
  try {
    process.env.SITE_URL = 'https://blackoak.example';
    const quote = payQuote({ maintenanceEnabled: 'on', maintenanceMonthly: '99' });
    quote.status = 'paid'; quote.payments = [{ amountCents: quote.totalCents, refundedCents: 0 }];
    quote.maintenance = { ...quote.maintenance, status: 'checkout_pending', checkout: { id: 'maintenance-attempt', createdAt: Date.now(), sessionId: 'cs_maintenance' } };
    const params = maintenanceCheckoutParameters(quote, quote.maintenance.checkout);
    assert.equal(params.mode, 'subscription');
    assert.equal(params.line_items[0].price_data.recurring.interval, 'month');
    assert.equal(params.line_items[0].price_data.unit_amount, 9900);
    const store = new MemoryStore(); await store.setJSON(`quote/${quote.id}`, quote);
    const settled = await settleMaintenanceCheckout({ mode: 'subscription', status: 'complete', subscription: 'sub_demo123', metadata: { checkout_version: 'black_oak_maintenance_v1', quote_id: quote.id, attempt_id: 'maintenance-attempt' } }, store);
    assert.equal(settled.maintenance.status, 'active');
    assert.equal(await store.get('maintenance-subscription/sub_demo123'), quote.id);
    const repeated = await settleMaintenanceCheckout({ mode: 'subscription', status: 'complete', subscription: 'sub_demo123', metadata: { checkout_version: 'black_oak_maintenance_v1', quote_id: quote.id, attempt_id: 'maintenance-attempt' } }, store);
    assert.equal(repeated.maintenance.status, 'active');
    const safe = publicPaymentArrangement(settled, settled.totalCents);
    assert.equal(safe.maintenance.status, 'active');
    assert.equal(JSON.stringify(safe).includes('sub_demo123'), false);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous;
  }
});
