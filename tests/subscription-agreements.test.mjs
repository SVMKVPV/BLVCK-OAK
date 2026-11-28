import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { createQuote, nextPayment, publicQuote, validateQuoteInput } from '../netlify/lib/quotes.mjs';
import { openQuoteCheckout } from '../netlify/lib/quote-checkout.mjs';
import {
  SUBSCRIPTION_VERSION, agreementHash, openSubscriptionCheckout, reconcileSubscriptionCheckout, recordSubscriptionInvoice,
  releaseFailedSubscriptionCheckout, settleSubscriptionCheckout, subscriptionAgreementText, updateSubscriptionAgreement, validateSubscriptionPlan,
} from '../netlify/lib/subscriptions.mjs';

// The agreement links to the site's terms pages; each test file runs in its own process.
process.env.SITE_URL ||= 'https://blvckoak.example';

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

function fakeStripe() {
  const sessions = new Map();
  const keys = new Map();
  const created = [];
  return {
    sessions, created,
    checkout: { sessions: {
      async create(params, options) {
        if (keys.has(options.idempotencyKey)) return structuredClone(sessions.get(keys.get(options.idempotencyKey)));
        const id = 'cs_sub_' + (created.length + 1);
        const value = { id, mode: 'subscription', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/' + id, metadata: params.metadata };
        created.push(params); keys.set(options.idempotencyKey, id); sessions.set(id, value);
        return structuredClone(value);
      },
      async retrieve(id) { return structuredClone(sessions.get(id)); },
      async expire(id) { sessions.get(id).status = 'expired'; return structuredClone(sessions.get(id)); },
    } },
  };
}

const owner = { id: 'owner-1', name: 'Black Oak Owner', email: 'owner@example.test' };
const input = {
  service: 'AI agent assistant', description: 'Monthly AI agent assistant: lead follow-up, inbox triage and weekly reporting.',
  customerName: 'Demo Client', customerEmail: 'client@example.test', paymentPlan: 'subscription',
  subscriptionAmount: '299', subscriptionInterval: 'month', subscriptionSetupFee: '500', subscriptionMinimumTerm: '6', subscriptionNoticeDays: '30',
  subscriptionTerms: 'Includes up to 5 hours of support per month.',
  // A browser could still send one-off fields; they must be ignored.
  total: '5', deposit: '999', maintenanceEnabled: 'on', maintenanceMonthly: '99',
};
const approved = (changes = {}) => createQuote({ ...input, ...changes }, owner, 'BO-AB12CD34EF', true);
const accept = (quote, changes = {}) => ({ accepted: true, acceptedName: 'Demo Client', agreementHash: agreementHash(quote), ...changes });

async function stored(quote) {
  const store = new MemoryStore();
  await store.setJSON(`quote/${quote.id}`, quote);
  return store;
}
function completed(store, quote, stripe, overrides = {}) {
  const plan = quote.paymentPlan;
  return { id: plan.checkout.sessionId, mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_123', metadata: stripe.created[0].metadata, ...overrides };
}

test('a subscription quote has no one-off total, deposit or maintenance and validates its billing terms', () => {
  const quote = approved();
  assert.equal(quote.totalCents, 0);
  assert.equal(quote.depositCents, 0);
  assert.equal(quote.maintenance.enabled, false);
  assert.deepEqual({ ...quote.paymentPlan }, { type: 'subscription', version: SUBSCRIPTION_VERSION, interval: 'month', amountCents: 29900, setupFeeCents: 50000, minimumTermCycles: 6, noticeDays: 30, terms: 'Includes up to 5 hours of support per month.', status: 'offered', checkout: null });
  assert.equal(validateSubscriptionPlan({ ...input, subscriptionSetupFee: '' }).setupFeeCents, 0);
  for (const changes of [{ subscriptionAmount: '9.99' }, { subscriptionAmount: '50000.01' }, { subscriptionAmount: '1e3' }, { subscriptionInterval: 'daily' }, { subscriptionInterval: '__proto__' }, { subscriptionSetupFee: '20' }, { subscriptionMinimumTerm: '61' }, { subscriptionMinimumTerm: '1.5' }, { subscriptionNoticeDays: '91' }, { subscriptionTerms: 'x'.repeat(4001) }]) {
    assert.throws(() => validateQuoteInput({ ...input, ...changes }), undefined, JSON.stringify(changes));
  }
  assert.equal(createQuote(input, owner, 'BO-AB12CD34EF').status, 'pending_approval');
});

test('the client page receives the full agreement and a hash of exactly that text, but no one-off payment', async () => {
  const quote = approved();
  const view = publicQuote(quote);
  assert.equal(view.nextPayment, null);
  assert.equal(view.paymentPlan.firstChargeCents, 79900);
  assert.match(view.paymentPlan.agreementText, /A\$299\.00 \(AUD, including any applicable GST\) is charged monthly/);
  assert.match(view.paymentPlan.agreementText, /setup fee of A\$500\.00/);
  assert.match(view.paymentPlan.agreementText, /minimum term of 6 months/);
  assert.match(view.paymentPlan.agreementText, /30 days written notice/);
  assert.match(view.paymentPlan.agreementText, /Additional agreed terms:\nIncludes up to 5 hours/);
  assert.match(view.paymentPlan.agreementText, /Australian Consumer Law/);
  assert.equal(view.paymentPlan.agreementHash, agreementHash(quote));
  assert.equal(nextPayment(quote), null);
  await assert.rejects(openQuoteCheckout(quote.id, fakeStripe(), await stored(quote)), /paid, expired or needs an owner review/);
  const noTerm = approved({ subscriptionMinimumTerm: '0', subscriptionNoticeDays: '0', subscriptionSetupFee: '0', subscriptionTerms: '' });
  assert.match(subscriptionAgreementText(noTerm), /no minimum term/);
  assert.doesNotMatch(subscriptionAgreementText(noTerm), /setup fee|Additional agreed terms/);
});

test('Stripe checkout opens only after a signed acceptance of the current agreement', async () => {
  const quote = approved();
  const store = await stored(quote);
  const stripe = fakeStripe();
  await assert.rejects(openSubscriptionCheckout(quote.id, accept(quote, { accepted: false }), stripe, store), /Tick the box/);
  await assert.rejects(openSubscriptionCheckout(quote.id, accept(quote, { acceptedName: ' ' }), stripe, store), /full name/);
  await assert.rejects(openSubscriptionCheckout(quote.id, accept(quote, { agreementHash: 'stale' }), stripe, store), /changed since you opened it/);
  const pending = createQuote(input, owner, 'BO-AB12CD34EF');
  await assert.rejects(openSubscriptionCheckout(pending.id, accept(pending), stripe, await stored(pending)), /not open for acceptance/);
  const expired = { ...quote, expiresAt: new Date(Date.now() - 1000).toISOString() };
  await assert.rejects(openSubscriptionCheckout(quote.id, accept(expired), stripe, await stored(expired)), /expired/);
  assert.equal(stripe.created.length, 0);

  const result = await openSubscriptionCheckout(quote.id, accept(quote, { acceptedName: '  Demo   Client ' }), stripe, store);
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_sub_1');
  const params = stripe.created[0];
  assert.equal(params.mode, 'subscription');
  assert.equal(params.customer_email, 'client@example.test');
  assert.deepEqual(params.line_items[0].price_data.recurring, { interval: 'month', interval_count: 1 });
  assert.equal(params.line_items[0].price_data.unit_amount, 29900);
  assert.equal(params.line_items[1].price_data.unit_amount, 50000);
  assert.equal(params.line_items[1].price_data.recurring, undefined);
  assert.equal(params.metadata.agreement_hash, agreementHash(quote));
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  const saved = await store.get(`quote/${quote.id}`);
  assert.equal(saved.paymentPlan.status, 'checkout_pending');
  assert.equal(saved.paymentPlan.acceptance.name, 'Demo Client');
  assert.equal(saved.paymentPlan.acceptance.agreementText, subscriptionAgreementText(quote));
  // Returning to the page reuses the same Stripe session instead of creating another.
  assert.equal((await openSubscriptionCheckout(quote.id, {}, stripe, store)).url, result.url);
  assert.equal(stripe.created.length, 1);
});

test('quarterly and fortnightly billing map to the right Stripe intervals', async () => {
  for (const [interval, expected] of [['quarter', { interval: 'month', interval_count: 3 }], ['fortnight', { interval: 'week', interval_count: 2 }], ['year', { interval: 'year', interval_count: 1 }]]) {
    const quote = approved({ subscriptionInterval: interval, subscriptionSetupFee: '0' });
    const stripe = fakeStripe();
    await openSubscriptionCheckout(quote.id, accept(quote), stripe, await stored(quote));
    assert.deepEqual(stripe.created[0].line_items[0].price_data.recurring, expected);
    assert.equal(stripe.created[0].line_items.length, 1);
  }
});

test('a completed checkout activates the agreement once and rejects mismatched sessions', async () => {
  const quote = approved();
  const store = await stored(quote);
  const stripe = fakeStripe();
  await openSubscriptionCheckout(quote.id, accept(quote), stripe, store);
  const pending = await store.get(`quote/${quote.id}`);
  const session = completed(store, pending, stripe);
  await assert.rejects(settleSubscriptionCheckout({ ...session, metadata: { ...session.metadata, attempt_id: 'other' } }, store), /did not match/);
  await assert.rejects(settleSubscriptionCheckout({ ...session, metadata: { ...session.metadata, agreement_hash: 'other' } }, store), /did not match/);
  await assert.rejects(settleSubscriptionCheckout({ ...session, id: 'cs_other' }, store), /did not match/);
  assert.equal(await settleSubscriptionCheckout({ ...session, status: 'open' }, store), null);
  const active = await settleSubscriptionCheckout(session, store);
  assert.equal(active.status, 'subscribed');
  assert.equal(active.paymentPlan.status, 'active');
  assert.equal(active.paymentPlan.subscriptionId, 'sub_123');
  assert.equal(active.paymentPlan.checkout, null);
  assert.equal(await store.get('subscription-agreement/sub_123'), quote.id);
  assert.equal((await settleSubscriptionCheckout(session, store)).paymentPlan.activatedAt, active.paymentPlan.activatedAt);
  await assert.rejects(openSubscriptionCheckout(quote.id, accept(quote), stripe, store), /already been accepted/);
  assert.equal(publicQuote(active).paymentPlan.acceptedBy, 'Demo Client');
});

test('the return page reconciles a completed checkout, and an expired one asks the client to sign again', async () => {
  const quote = approved();
  const store = await stored(quote);
  const stripe = fakeStripe();
  await openSubscriptionCheckout(quote.id, accept(quote), stripe, store);
  stripe.sessions.get('cs_sub_1').status = 'expired';
  const reset = await reconcileSubscriptionCheckout(await store.get(`quote/${quote.id}`), stripe, store);
  assert.equal(reset.paymentPlan.status, 'offered');
  assert.equal(reset.paymentPlan.acceptance, undefined);

  await openSubscriptionCheckout(quote.id, accept(quote), stripe, store);
  const pending = await store.get(`quote/${quote.id}`);
  Object.assign(stripe.sessions.get('cs_sub_2'), { status: 'complete', subscription: 'sub_456' });
  assert.equal((await reconcileSubscriptionCheckout(pending, stripe, store)).paymentPlan.status, 'active');
});

test('an unpaid async failure releases the attempt without touching other sessions', async () => {
  const quote = approved();
  const store = await stored(quote);
  const stripe = fakeStripe();
  await openSubscriptionCheckout(quote.id, accept(quote), stripe, store);
  const metadata = stripe.created[0].metadata;
  await releaseFailedSubscriptionCheckout({ id: 'cs_unrelated', payment_status: 'unpaid', metadata }, store);
  assert.equal((await store.get(`quote/${quote.id}`)).paymentPlan.status, 'checkout_pending');
  await releaseFailedSubscriptionCheckout({ id: 'cs_sub_1', payment_status: 'unpaid', metadata }, store);
  assert.equal((await store.get(`quote/${quote.id}`)).paymentPlan.status, 'offered');
});

test('Stripe subscription changes and paid invoices update the agreement record once', async () => {
  const quote = approved();
  const store = await stored(quote);
  const stripe = fakeStripe();
  await openSubscriptionCheckout(quote.id, accept(quote), stripe, store);
  await settleSubscriptionCheckout(completed(store, await store.get(`quote/${quote.id}`), stripe), store);
  assert.equal(await updateSubscriptionAgreement({ id: 'sub_unknown', status: 'canceled' }, store), null);
  assert.equal((await updateSubscriptionAgreement({ id: 'sub_123', status: 'past_due' }, store)).paymentPlan.status, 'past_due');
  const invoice = { id: 'in_1', currency: 'aud', amount_paid: 79900, status_transitions: { paid_at: 1790000000 }, parent: { subscription_details: { subscription: 'sub_123' } } };
  const paid = await recordSubscriptionInvoice(invoice, store);
  assert.equal(paid.paymentPlan.status, 'active');
  await recordSubscriptionInvoice(invoice, store);
  await recordSubscriptionInvoice({ ...invoice, id: 'in_2', amount_paid: 29900, parent: undefined, subscription: 'sub_123' }, store);
  const view = publicQuote(await store.get(`quote/${quote.id}`));
  assert.equal(view.paymentPlan.invoicesPaid, 2);
  assert.equal(view.paymentPlan.collectedCents, 109800);
  const ended = await updateSubscriptionAgreement({ id: 'sub_123', status: 'canceled' }, store);
  assert.equal(ended.paymentPlan.status, 'cancelled');
  assert.ok(ended.paymentPlan.cancelledAt);
});

// ---- Browser pages ----
const [partnerSource, partnerHtml, paySource, payHtml] = await Promise.all([
  readFile(new URL('../partners.js', import.meta.url), 'utf8'),
  readFile(new URL('../partners.html', import.meta.url), 'utf8'),
  readFile(new URL('../pay.js', import.meta.url), 'utf8'),
  readFile(new URL('../pay.html', import.meta.url), 'utf8'),
]);

class Element {
  listeners = new Map(); children = []; selectors = new Map(); attributes = new Map();
  firstChild = { textContent: '' }; classList = { toggle() {} };
  textContent = ''; innerHTML = ''; value = ''; hidden = false; disabled = false; elements = {};
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  querySelector(selector) { if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector); }
  focus() {} scrollIntoView() {}
  reset() { for (const field of Object.values(this.elements)) { field.value = field.defaultValue || ''; field.checked = false; } }
}
function pageDom(html) {
  const nodes = new Map();
  const get = (selector) => {
    const attribute = selector.match(/^\[(data-[a-z-]+)\]/)?.[1];
    assert.ok(attribute && html.includes(attribute), `HTML contains ${selector}`);
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  return { get, document: { querySelector: get, querySelectorAll: () => [], createElement: () => new Element(), hidden: false } };
}
const response = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data });

test('partner form switches to subscription fields, hides one-off pricing and submits the agreement terms', async () => {
  const dom = pageDom(partnerHtml);
  const form = dom.get('[data-quote-form]');
  const fields = { total: '', deposit: '0', paymentPlan: 'standard', payAsYouSellMethod: 'percentage', payAsYouSellPercent: '10', payAsYouSellAmount: '50', payAsYouSellSalesCount: '1', maintenanceMonthly: '99', maintenanceEnabled: '', customerName: '', customerEmail: '', service: '', description: '', reviewNote: '', subscriptionAmount: '', subscriptionInterval: 'month', subscriptionSetupFee: '0', subscriptionMinimumTerm: '0', subscriptionNoticeDays: '30', subscriptionTerms: '' };
  for (const [name, value] of Object.entries(fields)) form.elements[name] = Object.assign(new Element(), { value, defaultValue: value });
  for (const name of Object.keys(fields)) assert.ok(name === 'paymentPlan' || partnerHtml.includes(`name="${name}"`), `partners.html has field ${name}`);
  dom.get('[data-quote-filter]').value = 'all';
  const requests = [];
  runInNewContext(partnerSource, {
    document: dom.document, crypto: { randomUUID }, URLSearchParams, URL, location: { search: '', origin: 'https://blvckoak.example' },
    FormData: class {
      constructor(target) { this.entries = Object.entries(target.elements).filter(([name, field]) => !field.disabled && (name !== 'maintenanceEnabled' || field.checked)).map(([name, field]) => [name, field.value]); }
      [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    },
    fetch: async (path, options) => {
      const body = options.body ? JSON.parse(options.body) : null; requests.push({ path, body });
      return response(path === '/api/partners' ? { account: { name: 'Sample Partner' }, isOwner: false, referral: { code: 'BO-SAMPLE', payoutReady: false }, quotes: [], csrf: 'csrf' } : {});
    },
  }, { filename: 'partners.js' });
  await setImmediate();
  form.elements.paymentPlan.value = 'subscription';
  form.elements.maintenanceEnabled.checked = true;
  form.elements.subscriptionAmount.value = '299';
  form.elements.subscriptionSetupFee.value = '500';
  form.elements.subscriptionMinimumTerm.value = '6';
  form.listeners.get('change')();
  assert.equal(dom.get('[data-subscription-fields]').hidden, false);
  assert.equal(dom.get('[data-total-field]').hidden, true);
  assert.equal(form.elements.total.disabled, true);
  assert.equal(form.elements.deposit.disabled, true);
  assert.equal(dom.get('[data-maintenance-choice]').hidden, true);
  assert.equal(form.elements.maintenanceEnabled.checked, false);
  assert.equal(form.elements.subscriptionAmount.required, true);
  assert.equal(dom.get('[data-due-preview-label]').textContent, 'First charge');
  assert.equal(dom.get('[data-due-preview]').textContent, '$799.00');
  assert.equal(dom.get('[data-balance-preview-label]').textContent, 'Then every month');
  assert.match(dom.get('[data-subscription-preview]').textContent, /Minimum term 6 months \(\$1,794\.00 committed\)/);
  await form.listeners.get('submit')({ currentTarget: form, preventDefault() {} });
  const saved = requests.find(({ body }) => body?.action === 'create_quote').body;
  assert.equal(saved.paymentPlan, 'subscription');
  assert.equal(saved.subscriptionAmount, '299');
  assert.equal(saved.total, undefined);
  assert.equal(saved.deposit, undefined);
  assert.equal(saved.maintenanceEnabled, undefined);
  assert.doesNotThrow(() => validateQuoteInput({ ...saved, customerName: 'Demo Client', customerEmail: 'client@example.test', service: 'AI agent assistant', description: input.description }));
  // Switching back restores the one-off fields.
  form.elements.paymentPlan.value = 'standard';
  form.listeners.get('change')();
  assert.equal(dom.get('[data-total-field]').hidden, false);
  assert.equal(form.elements.total.disabled, false);
  assert.equal(dom.get('[data-subscription-fields]').hidden, true);
});

test('client page shows the agreement, then signs with the server hash before opening Stripe', async () => {
  const quote = { ...publicQuote(approved()), id: 'a'.repeat(32) };
  const dom = pageDom(payHtml);
  const agreementForm = dom.get('[data-agreement-form]');
  agreementForm.elements = { acceptedName: { value: 'Demo Client' }, accepted: { checked: false } };
  const requests = []; const navigation = [];
  runInNewContext(paySource, {
    document: dom.document, URLSearchParams, URL, setInterval() {},
    location: { search: `?quote=${quote.id}`, hash: '#' + 'b'.repeat(43), assign: (url) => navigation.push(url) },
    fetch: async (path, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return body.action === 'subscription_checkout' ? response({ url: 'https://checkout.stripe.com/c/pay/cs_sub_1' }) : response({ quote });
    },
  }, { filename: 'pay.js' });
  await setImmediate();
  assert.equal(dom.get('[data-subscription-agreement]').hidden, false);
  assert.equal(dom.get('[data-project-totals]').hidden, true);
  assert.equal(dom.get('[data-pay-button]').hidden, true);
  assert.equal(dom.get('[data-agreement-text]').textContent, quote.paymentPlan.agreementText);
  assert.equal(dom.get('[data-subscription-price]').textContent, '$299.00');
  assert.equal(dom.get('[data-client-state]').textContent, 'Ready to sign');
  assert.match(dom.get('[data-payment-policy]').textContent, /recurring subscription/);
  assert.doesNotMatch(dom.get('[data-payment-policy]').textContent, /no recurring/i);
  const submit = agreementForm.listeners.get('submit');
  await submit({ currentTarget: agreementForm, preventDefault() {} });
  assert.equal(requests.filter((body) => body.action === 'subscription_checkout').length, 0);
  assert.match(dom.get('[data-payment-status]').textContent, /Tick the box/);
  agreementForm.elements.accepted.checked = true;
  await submit({ currentTarget: agreementForm, preventDefault() {} });
  const signed = requests.find((body) => body.action === 'subscription_checkout');
  assert.deepEqual({ accepted: signed.accepted, acceptedName: signed.acceptedName, agreementHash: signed.agreementHash }, { accepted: true, acceptedName: 'Demo Client', agreementHash: quote.paymentPlan.agreementHash });
  assert.deepEqual(navigation, ['https://checkout.stripe.com/c/pay/cs_sub_1']);
});
