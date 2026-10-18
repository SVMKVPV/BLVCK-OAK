import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const [partnerSource, partnerHtml, paySource, payHtml] = await Promise.all([
  readFile(new URL('../partners.js', import.meta.url), 'utf8'),
  readFile(new URL('../partners.html', import.meta.url), 'utf8'),
  readFile(new URL('../pay.js', import.meta.url), 'utf8'),
  readFile(new URL('../pay.html', import.meta.url), 'utf8'),
]);

class Element {
  listeners = new Map();
  children = [];
  selectors = new Map();
  attributes = new Map();
  firstChild = { textContent: '' };
  classList = { toggle() {} };
  textContent = '';
  innerHTML = '';
  value = '';
  hidden = false;
  disabled = false;
  elements = {};
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  focus() {}
  scrollIntoView() {}
  reset() {
    for (const field of Object.values(this.elements)) {
      field.value = field.defaultValue || '';
      field.checked = false;
    }
  }
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

function clientQuote({ paid = 0, status = paid ? 'deposit_paid' : 'approved' } = {}) {
  const schedule = Array.from({ length: 15 }, (_, index) => ({ number: index + 1, amountCents: index < 5 ? 3334 : 3333, paid: index < paid }));
  const paidCents = schedule.filter((part) => part.paid).reduce((sum, part) => sum + part.amountCents, 0);
  return {
    id: 'a'.repeat(32), revision: 2, customerName: 'Sample Client', customerEmail: 'client@example.test',
    service: 'Custom website', description: 'A complete custom website with the timing agreed in writing.',
    partnerName: 'Sample Partner', referralCode: 'BO-SAMPLE',
    totalCents: 50000, paidCents, depositCents: 0, status, refundedCents: 0,
    paymentPlan: { type: 'instalments_15', instalmentCount: 15, paidInstalments: paid, remainingInstalments: 15 - paid, balanceCents: 50000 - paidCents, schedule },
    nextPayment: paid < 15 ? { stage: `instalment_${paid + 1}`, amountCents: schedule[paid].amountCents, instalmentNumber: paid + 1, instalmentCount: 15 } : null,
    maintenance: { enabled: false }, progress: { stage: 'planning', percentage: 0 },
    payments: schedule.filter((part) => part.paid).map((part) => ({ stage: `instalment_${part.number}`, amountCents: part.amountCents, paidAt: '2026-10-18T00:00:00Z' })),
  };
}

async function partnerPage({ owner = false, quotes = [] } = {}) {
  const dom = pageDom(partnerHtml);
  const form = dom.get('[data-quote-form]');
  const fields = { total: '', deposit: '0', paymentPlan: 'standard', payAsYouSellMethod: 'percentage', payAsYouSellPercent: '10', payAsYouSellAmount: '50', payAsYouSellSalesCount: '1', maintenanceMonthly: '99', maintenanceEnabled: '', customerName: '', customerEmail: '', service: '', description: '', reviewNote: '' };
  for (const [name, value] of Object.entries(fields)) form.elements[name] = Object.assign(new Element(), { value, defaultValue: value });
  dom.get('[data-quote-filter]').value = 'all';
  const requests = [];
  runInNewContext(partnerSource, {
    document: dom.document, crypto: { randomUUID }, URLSearchParams, URL,
    location: { search: '', origin: 'https://blvckoak.example' },
    FormData: class {
      constructor(target) {
        this.entries = Object.entries(target.elements).filter(([name, field]) => !field.disabled && (name !== 'maintenanceEnabled' || field.checked)).map(([name, field]) => [name, name === 'maintenanceEnabled' ? 'on' : field.value]);
      }
      [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    },
    fetch: async (path, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ path, body });
      if (path === '/api/partners') return response({ account: { name: 'Sample Partner' }, isOwner: owner, referral: { code: 'BO-SAMPLE', payoutReady: false }, quotes, csrf: 'sample-csrf' });
      return response({});
    },
  }, { filename: 'partners.js' });
  await setImmediate();
  return { ...dom, form, requests };
}

function findButton(node, text) {
  if (node.textContent === text) return node;
  return node.children.map((child) => findButton(child, text)).find(Boolean);
}

test('partner selection clears and excludes a deposit, restores it on switching, and submits a zero-deposit plan', async () => {
  const page = await partnerPage();
  const { form, get } = page;
  form.elements.total.value = '500';
  form.elements.deposit.value = '80';
  form.elements.paymentPlan.value = 'instalments_15';
  form.listeners.get('change')();
  assert.equal(form.elements.deposit.value, '0');
  assert.equal(form.elements.deposit.disabled, true);
  assert.equal(form.elements.deposit.required, false);
  assert.equal(get('[data-deposit-field]').hidden, true);
  assert.equal(get('[data-pay-as-you-sell-fields]').hidden, true);
  assert.equal(get('[data-instalment-plan-fields]').hidden, false);
  assert.equal(get('[data-due-preview]').textContent, '$33.34');
  assert.equal(get('[data-balance-preview]').textContent, '$466.66');
  assert.match(get('[data-instalment-preview]').textContent, /5 payments of \$33\.34, then 10 payments of \$33\.33/);

  form.elements.paymentPlan.value = 'standard';
  form.listeners.get('change')();
  assert.equal(form.elements.deposit.value, '80');
  assert.equal(form.elements.deposit.disabled, false);
  assert.equal(form.elements.deposit.required, true);
  assert.equal(get('[data-deposit-field]').hidden, false);
  assert.equal(get('[data-due-preview]').textContent, '$80.00');
  assert.equal(get('[data-balance-preview]').textContent, '$420.00');

  form.elements.paymentPlan.value = 'instalments_15';
  form.listeners.get('change')();
  await form.listeners.get('submit')({ currentTarget: form, preventDefault() {} });
  const saved = page.requests.find(({ body }) => body?.action === 'create_quote').body;
  assert.equal(saved.paymentPlan, 'instalments_15');
  assert.equal(saved.deposit, '0');
  assert.equal(saved.total, '500');
  assert.equal(form.elements.paymentPlan.value, 'standard');
  assert.equal(form.elements.deposit.disabled, false);
  assert.equal(get('[data-instalment-plan-fields]').hidden, true);
});

test('owner approval preserves the partner’s 15-part selection and zero-deposit payload', async () => {
  const quote = clientQuote({ status: 'pending_approval' });
  const page = await partnerPage({ owner: true, quotes: [quote] });
  const review = findButton(page.get('[data-quote-list]'), 'Review & approve');
  assert.ok(review);
  review.listeners.get('click')();
  assert.equal(page.form.elements.paymentPlan.value, 'instalments_15');
  assert.equal(page.form.elements.deposit.disabled, true);
  assert.equal(page.get('[data-deposit-field]').hidden, true);
  page.form.elements.total.value = '1500';
  page.form.listeners.get('input')();
  assert.equal(page.get('[data-due-preview]').textContent, '$100.00');
  await page.form.listeners.get('submit')({ currentTarget: page.form, preventDefault() {} });
  const saved = page.requests.find(({ body }) => body?.action === 'approve_quote').body;
  assert.equal(saved.id, quote.id);
  assert.equal(saved.revision, quote.revision);
  assert.equal(saved.total, '1500');
  assert.equal(saved.paymentPlan, 'instalments_15');
  assert.equal(saved.deposit, '0');
});

async function paymentPage(quote) {
  const dom = pageDom(payHtml);
  const requests = [];
  const navigation = [];
  runInNewContext(paySource, {
    document: dom.document, URLSearchParams, URL, setInterval() {},
    location: { search: `?quote=${quote.id}`, hash: '#' + 'b'.repeat(43), assign: (url) => navigation.push(url) },
    fetch: async (path, options) => {
      const body = JSON.parse(options.body); requests.push({ path, body });
      return body.action === 'checkout' ? response({ url: 'https://checkout.stripe.com/c/pay/sample' }) : response({ quote });
    },
  }, { filename: 'pay.js' });
  await setImmediate();
  return { ...dom, requests, navigation };
}

test('customer schedule shows confirmed parts and takes the next amount and number from the server', async () => {
  const quote = clientQuote({ paid: 5 });
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-client-state]').textContent, 'Part paid');
  assert.equal(page.get('[data-client-balance]').textContent, '$333.30');
  assert.equal(page.get('[data-instalment-count]').textContent, '5 of 15 payments confirmed · 10 remaining');
  assert.equal(page.get('[data-instalment-progress]').value, 5);
  const schedule = page.get('[data-instalment-schedule]').children;
  assert.equal(schedule.length, 15);
  assert.equal(schedule.filter((item) => item.className === 'is-paid').length, 5);
  assert.equal(schedule[5].className, 'is-next');
  assert.equal(page.get('[data-pay-button]').firstChild.textContent, 'Pay instalment 6 of 15 — A$33.33 ');
  assert.match(page.get('[data-payment-history]').children[0].textContent, /Instalment 1 of 15/);
  assert.match(page.get('[data-payment-policy]').textContent, /no additional deposit, interest or payment-plan fee/i);
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.equal(page.navigation[0], 'https://checkout.stripe.com/c/pay/sample');
  const checkout = page.requests.find(({ body }) => body.action === 'checkout').body;
  assert.deepEqual(Object.keys(checkout).sort(), ['action', 'id', 'token']);

  const serverDue = { ...quote, nextPayment: { ...quote.nextPayment, amountCents: 1234 } };
  const refreshed = await paymentPage(serverDue);
  assert.equal(refreshed.get('[data-client-due]').textContent, '$12.34');
  assert.equal(refreshed.get('[data-pay-button]').firstChild.textContent, 'Pay instalment 6 of 15 — A$12.34 ');
});

test('all 15 confirmed payments hide checkout and retain the complete paid schedule', async () => {
  const quote = clientQuote({ paid: 15, status: 'paid' });
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-client-state]').textContent, 'Paid in full');
  assert.equal(page.get('[data-client-balance]').textContent, '$0.00');
  assert.equal(page.get('[data-pay-button]').hidden, true);
  assert.equal(page.get('[data-instalment-count]').textContent, '15 of 15 payments confirmed · 0 remaining');
  assert.ok(page.get('[data-instalment-schedule]').children.every((item) => item.className === 'is-paid'));
});
