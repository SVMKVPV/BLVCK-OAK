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
  const schedule = Array.from({ length: 15 }, (_, index) => {
    const amountCents = index < 5 ? 3334 : 3333;
    return { number: index + 1, amountCents, paid: index < paid, paidCents: index < paid ? amountCents : 0, remainingCents: index < paid ? 0 : amountCents, partial: false };
  });
  const paidCents = schedule.filter((part) => part.paid).reduce((sum, part) => sum + part.amountCents, 0);
  return {
    id: 'a'.repeat(32), revision: 2, customerName: 'Sample Client', customerEmail: 'client@example.test',
    service: 'Custom website', description: 'A complete custom website with the timing agreed in writing.',
    partnerName: 'Sample Partner', referralCode: 'BO-SAMPLE',
    totalCents: 50000, paidCents, depositCents: 0, status, refundedCents: 0,
    paymentPlan: { type: 'instalments_15', instalmentCount: 15, paidInstalments: paid, remainingInstalments: 15 - paid, balanceCents: 50000 - paidCents, schedule },
    nextPayment: paid < 15 ? { stage: `instalment_${paid + 1}`, amountCents: schedule[paid].amountCents, instalmentNumber: paid + 1, instalmentCount: 15, maxExtraCents: 50000 - paidCents - schedule[paid].amountCents, minimumPaymentCents: 50 } : null,
    maintenance: { enabled: false }, progress: { stage: 'planning', percentage: 0 },
    payments: schedule.filter((part) => part.paid).map((part) => ({ stage: `instalment_${part.number}`, amountCents: part.amountCents, paidAt: '2026-10-18T00:00:00Z' })),
  };
}

function quoteWithExtraCredit(paidCents) {
  const quote = clientQuote();
  let credit = paidCents;
  quote.paymentPlan.schedule = quote.paymentPlan.schedule.map((part) => {
    const paid = Math.min(part.amountCents, credit); credit -= paid;
    return { ...part, paidCents: paid, remainingCents: part.amountCents - paid, partial: paid > 0 && paid < part.amountCents, paid: paid === part.amountCents };
  });
  quote.paidCents = paidCents;
  quote.status = paidCents === quote.totalCents ? 'paid' : 'deposit_paid';
  const parts = quote.paymentPlan.schedule;
  quote.paymentPlan.paidInstalments = parts.filter((part) => part.paid).length;
  quote.paymentPlan.remainingInstalments = 15 - quote.paymentPlan.paidInstalments;
  quote.paymentPlan.balanceCents = quote.totalCents - paidCents;
  const next = parts.find((part) => !part.paid);
  const lastCovered = parts.filter((part) => part.paidCents > 0).at(-1)?.number;
  quote.payments = [{ amountCents: paidCents, baseAmountCents: 3334, extraAmountCents: paidCents - 3334, stage: 'instalment_1', instalmentEndNumber: lastCovered, paidAt: '2026-10-18T00:00:00Z' }];
  quote.nextPayment = next ? { stage: `instalment_${next.number}`, amountCents: next.remainingCents, instalmentNumber: next.number, instalmentCount: 15, maxExtraCents: quote.paymentPlan.balanceCents - next.remainingCents, minimumPaymentCents: 50 } : null;
  return quote;
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
  assert.match(get('[data-instalment-preview]').textContent, /5 parts of \$33\.34, then 10 parts of \$33\.33/);

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

async function paymentPage(quote, { checkoutResult = { url: 'https://checkout.stripe.com/c/pay/sample' } } = {}) {
  const dom = pageDom(payHtml);
  const requests = [];
  const navigation = [];
  let currentQuote = quote;
  runInNewContext(paySource, {
    document: dom.document, URLSearchParams, URL, setInterval() {},
    location: { search: `?quote=${quote.id}`, hash: '#' + 'b'.repeat(43), assign: (url) => navigation.push(url) },
    fetch: async (path, options) => {
      const body = JSON.parse(options.body); requests.push({ path, body });
      return body.action === 'checkout' ? response(checkoutResult) : response({ quote: currentQuote });
    },
  }, { filename: 'pay.js' });
  await setImmediate();
  return { ...dom, requests, navigation, setQuote: (value) => { currentQuote = value; } };
}

test('customer schedule shows confirmed parts and takes the next amount and number from the server', async () => {
  const quote = clientQuote({ paid: 5 });
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-client-state]').textContent, 'Part paid');
  assert.equal(page.get('[data-client-balance]').textContent, '$333.30');
  assert.equal(page.get('[data-instalment-count]').textContent, '5 of 15 parts fully paid · 10 remaining');
  assert.equal(page.get('[data-instalment-progress]').value, 5);
  const schedule = page.get('[data-instalment-schedule]').children;
  assert.equal(schedule.length, 15);
  assert.equal(schedule.filter((item) => item.className === 'is-paid').length, 5);
  assert.equal(schedule[5].className, 'is-next');
  assert.equal(page.get('[data-pay-button]').firstChild.textContent, 'Pay instalment 6 of 15 — A$33.33 ');
  assert.match(page.get('[data-payment-history]').children[0].textContent, /Toward part 1 of 15/);
  assert.match(page.get('[data-payment-policy]').textContent, /no additional deposit, interest or payment-plan fee/i);
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.equal(page.navigation[0], 'https://checkout.stripe.com/c/pay/sample');
  const checkout = page.requests.find(({ body }) => body.action === 'checkout').body;
  assert.deepEqual(Object.keys(checkout).sort(), ['action', 'expectedPaidCents', 'extraAmount', 'id', 'token']);
  assert.equal(checkout.extraAmount, '0.00');
  assert.equal(checkout.expectedPaidCents, quote.paidCents);

  const serverDue = { ...quote, nextPayment: { ...quote.nextPayment, amountCents: 1234, maxExtraCents: quote.paymentPlan.balanceCents - 1234 } };
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
  assert.equal(page.get('[data-instalment-count]').textContent, '15 of 15 parts fully paid · 0 remaining');
  assert.ok(page.get('[data-instalment-schedule]').children.every((item) => item.className === 'is-paid'));
});

test('optional extra updates the exact total and sends the chosen amount with the known paid balance', async () => {
  const quote = clientQuote();
  const page = await paymentPage(quote);
  const extra = page.get('[data-extra-amount]');
  assert.equal(page.get('[data-extra-payment]').hidden, false);
  assert.equal(page.get('[data-selected-payment]').textContent, '$33.34');
  extra.value = '25.00';
  extra.listeners.get('input')();
  assert.equal(page.get('[data-selected-payment]').textContent, '$58.34');
  assert.equal(page.get('[data-after-payment-balance]').textContent, '$441.66');
  assert.equal(page.get('[data-pay-button]').firstChild.textContent, 'Pay instalment 1 of 15 + extra — A$58.34 ');
  await page.get('[data-pay-button]').listeners.get('click')();
  const checkout = page.requests.find(({ body }) => body.action === 'checkout').body;
  assert.equal(checkout.extraAmount, '25.00');
  assert.equal(checkout.expectedPaidCents, 0);
  assert.equal('amountCents' in checkout, false);
});

test('extra validation rejects malformed values, overpayment and tiny final balances without changing the input or sending checkout', async () => {
  const page = await paymentPage(clientQuote());
  const extra = page.get('[data-extra-amount]');
  for (const value of ['-1', '25.001', '1e2', '1,000', '467.00', '466.17', '466.56']) {
    extra.value = value; extra.listeners.get('input')();
    assert.equal(page.get('[data-pay-button]').disabled, true, value);
    assert.notEqual(page.get('[data-extra-error]').textContent, '', value);
    await page.get('[data-pay-button]').listeners.get('click')();
    assert.equal(extra.value, value);
  }
  assert.equal(page.requests.filter(({ body }) => body.action === 'checkout').length, 0);
  assert.match(page.get('[data-extra-error]').textContent, /leave only \$0.10.*at least \$0.50.*Pay remaining balance/);
  extra.value = '466.16'; extra.listeners.get('input')();
  assert.equal(page.get('[data-after-payment-balance]').textContent, '$0.50');
  assert.equal(page.get('[data-pay-button]').disabled, false);
  assert.equal(page.get('[data-extra-error]').textContent, '');
});

test('remaining-balance shortcut prepares one final payment and waits for the customer to open checkout', async () => {
  const page = await paymentPage(clientQuote());
  page.get('[data-pay-balance]').listeners.get('click')();
  assert.equal(page.get('[data-extra-amount]').value, '466.66');
  assert.equal(page.get('[data-selected-payment]').textContent, '$500.00');
  assert.equal(page.get('[data-after-payment-balance]').textContent, '$0.00');
  assert.equal(page.get('[data-pay-button]').firstChild.textContent, 'Pay remaining balance — A$500.00 ');
  assert.equal(page.requests.filter(({ body }) => body.action === 'checkout').length, 0);
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.equal(page.requests.find(({ body }) => body.action === 'checkout').body.extraAmount, '466.66');
});

test('partial extra credit shows original part amounts, remaining amounts and the actual transaction count', async () => {
  const quote = quoteWithExtraCredit(5000);
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-instalment-count]').textContent, '1 of 15 parts fully paid · 14 remaining');
  assert.match(page.get('[data-instalment-transactions]').textContent, /^1 payment confirmed/);
  const partial = page.get('[data-instalment-schedule]').children[1];
  assert.equal(partial.children[1].textContent, '$33.34');
  assert.equal(partial.children[2].textContent, 'Part paid');
  assert.equal(partial.children[3].textContent, '$16.66 paid · $16.68 remaining');
  assert.equal(page.get('[data-client-due]').textContent, '$16.68');
  assert.match(page.get('[data-payment-history]').children[0].textContent, /Toward parts 1–2 of 15.*Scheduled \$33.34 \+ extra \$16.66/);

  const owner = await partnerPage({ owner: true, quotes: [quote] });
  const card = owner.get('[data-quote-list]').children[0];
  assert.match(card.innerHTML, /1 of 15 parts fully paid/);
  const ownerSchedule = card.children[0].children[1];
  assert.equal(ownerSchedule.children[1].children[3].textContent, '$16.66 paid · $16.68 remaining');
});

test('a server payment spanning a tiny part remainder and the next part displays both parts and the returned amount', async () => {
  const quote = quoteWithExtraCredit(6648);
  quote.nextPayment.amountCents = 50;
  quote.nextPayment.instalmentEndNumber = 3;
  quote.nextPayment.maxExtraCents = quote.paymentPlan.balanceCents - 50;
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-client-due]').textContent, '$0.50');
  assert.equal(page.get('[data-pay-button]').firstChild.textContent, 'Pay toward parts 2–3 of 15 — A$0.50 ');
  assert.match(page.get('[data-payment-status]').textContent, /Your next payment is toward parts 2–3 of 15/);
  assert.equal(page.get('[data-instalment-schedule]').children[2].className, 'is-next');
});

test('changing extra cannot reopen a checkout awaiting Stripe confirmation; a new confirmed balance unlocks the next payment', async () => {
  const page = await paymentPage(clientQuote(), { checkoutResult: { awaitingConfirmation: true } });
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.equal(page.get('[data-pay-button]').disabled, true);
  assert.equal(page.get('[data-extra-amount]').disabled, true);
  assert.equal(page.get('[data-pay-balance]').disabled, true);
  page.get('[data-extra-amount]').value = '25';
  page.get('[data-extra-amount]').listeners.get('input')();
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.equal(page.get('[data-pay-button]').disabled, true);
  assert.equal(page.requests.filter(({ body }) => body.action === 'checkout').length, 1);
  page.setQuote(quoteWithExtraCredit(3334));
  await page.get('[data-reload-quote]').listeners.get('click')();
  assert.equal(page.get('[data-extra-amount]').value, '');
  assert.equal(page.get('[data-extra-amount]').disabled, false);
  assert.equal(page.get('[data-pay-button]').disabled, false);
});

test('paying the remaining balance early covers all parts with one confirmed transaction and stops payment controls', async () => {
  const page = await paymentPage(quoteWithExtraCredit(50000));
  assert.equal(page.get('[data-instalment-count]').textContent, '15 of 15 parts fully paid · 0 remaining');
  assert.match(page.get('[data-instalment-transactions]').textContent, /^1 payment confirmed/);
  assert.equal(page.get('[data-extra-payment]').hidden, true);
  assert.equal(page.get('[data-extra-amount]').disabled, true);
  assert.equal(page.get('[data-pay-balance]').disabled, true);
  assert.equal(page.get('[data-pay-button]').hidden, true);
});

test('standard quotes keep their original checkout request and do not expose extra-payment controls', async () => {
  const quote = { ...clientQuote(), paymentPlan: { type: 'standard' }, nextPayment: { stage: 'full', amountCents: 50000 } };
  const page = await paymentPage(quote);
  assert.equal(page.get('[data-extra-payment]').hidden, true);
  await page.get('[data-pay-button]').listeners.get('click')();
  assert.deepEqual(Object.keys(page.requests.find(({ body }) => body.action === 'checkout').body).sort(), ['action', 'id', 'token']);
});
