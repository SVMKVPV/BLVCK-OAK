import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../partners.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../partners.html', import.meta.url), 'utf8');

class Element {
  listeners = new Map();
  children = new Map();
  classes = new Set();
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  firstChild = { textContent: '' };
  elements = {
    total: { value: '' }, deposit: { value: '' },
    paymentPlan: { value: 'standard' }, payAsYouSellMethod: { value: 'percentage' },
    payAsYouSellPercent: { value: '10' }, payAsYouSellAmount: { value: '50' },
    payAsYouSellSalesCount: { value: '1' }, maintenanceEnabled: { checked: false },
    maintenanceMonthly: { value: '99' },
  };
  values = {};
  hidden = false;
  disabled = false;
  textContent = '';
  value = '';
  resetCalls = 0;
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  reset() { this.resetCalls += 1; this.values = {}; }
  focus() {}
  replaceChildren() {}
  append() {}
  setAttribute() {}
}

async function createPage({ owner = false, signedIn = false } = {}) {
  const nodes = new Map();
  const get = (selector) => {
    const attribute = selector.match(/^\[(data-[a-z-]+)\]/)?.[1];
    assert.ok(attribute && html.includes(attribute), `Selector must exist in partners.html: ${selector}`);
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  get('[data-auth-verify]').hidden = true;
  get('[data-dashboard]').hidden = true;
  get('[data-quote-filter]').value = 'all';
  const requests = [];
  let authenticated = signedIn;
  let rejectCode = false;
  const response = (data, code = 200) => ({ ok: code < 400, status: code, headers: { get: () => 'application/json' }, json: async () => data });
  runInNewContext(source, {
    document: { querySelector: get, querySelectorAll: () => [], createElement: () => new Element() },
    crypto: { randomUUID }, URLSearchParams, location: { search: '' },
    navigator: { geolocation: { getCurrentPosition: (resolve) => resolve({ coords: { latitude: -33.8688, longitude: 151.2093 } }) }, clipboard: { writeText: async () => {} } },
    FormData: class {
      constructor(form) { assert.ok(form instanceof Element); this.form = form; }
      get(name) { return this.form.values[name] ?? null; }
    },
    fetch: async (path, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ path, body });
      if (path === '/api/partners/auth' && body?.action === 'start') return response({ challenge: 'test-challenge', message: 'Check your email for a six-digit sign-in code.' });
      if (path === '/api/partners/auth' && body?.action === 'verify') {
        if (rejectCode) return response({ error: 'Incorrect code. Please try again.' }, 401);
        assert.equal(body.challenge, 'test-challenge');
        assert.equal(body.code, '123456');
        authenticated = true;
        return response({ signedIn: true });
      }
      if (path === '/api/businesses/nearby') return authenticated
        ? response({ leads: [], remainingSearches: 24 })
        : response({ error: 'Sign in to your partner account.' }, 401);
      assert.equal(path, '/api/partners');
      return authenticated
        ? response({ account: { name: 'Demo Partner' }, isOwner: owner, referral: { code: 'BO-AB12CD34EF', payoutReady: false }, quotes: [], csrf: 'test-csrf' })
        : response({ error: 'Sign in to your partner account.' }, 401);
    },
  }, { filename: 'partners.js' });
  await setImmediate();
  async function submit(selector, values) {
    const form = get(selector);
    form.values = values;
    const event = { currentTarget: form, preventDefault() {} };
    const pending = form.listeners.get('submit')(event);
    // Browsers clear currentTarget once synchronous event dispatch finishes.
    event.currentTarget = null;
    await pending;
  }
  return { get, submit, requests, rejectCode: (value) => { rejectCode = value; } };
}

for (const owner of [false, true]) {
  test(`${owner ? 'owner' : 'partner'} verification opens the dashboard after the event target is cleared`, async () => {
    const page = await createPage({ owner });
    await page.submit('[data-auth-start]', { name: 'Demo Partner', email: 'partner@example.test', terms: 'on' });
    assert.equal(page.get('[data-auth-start]').hidden, true);
    assert.equal(page.get('[data-auth-verify]').hidden, false);
    await page.submit('[data-auth-verify]', { code: '123456' });
    assert.equal(page.get('[data-auth-verify]').resetCalls, 1);
    assert.equal(page.get('[data-auth-panel]').hidden, true);
    assert.equal(page.get('[data-dashboard]').hidden, false);
    assert.equal(page.get('[data-role-tag]').textContent, owner ? 'Owner workspace' : 'Partner workspace');
    assert.equal(page.get('[data-partner-code]').textContent, 'BO-AB12CD34EF');
    assert.equal(page.get('[data-auth-status]').classes.has('error'), false);
    assert.equal(page.get('[data-auth-verify]').querySelector('[type="submit"]').disabled, false);
  });
}

test('an incorrect code keeps the form and challenge available for a successful retry', async () => {
  const page = await createPage();
  await page.submit('[data-auth-start]', { email: 'partner@example.test' });
  page.rejectCode(true);
  await page.submit('[data-auth-verify]', { code: '000000' });
  assert.equal(page.get('[data-auth-verify]').resetCalls, 0);
  assert.equal(page.get('[data-auth-verify]').hidden, false);
  assert.equal(page.get('[data-dashboard]').hidden, true);
  assert.equal(page.get('[data-auth-status]').textContent, 'Incorrect code. Please try again.');
  assert.equal(page.get('[data-auth-verify]').querySelector('[type="submit"]').disabled, false);
  page.rejectCode(false);
  await page.submit('[data-auth-verify]', { code: '123456' });
  assert.equal(page.get('[data-dashboard]').hidden, false);
  assert.equal(page.get('[data-auth-status]').classes.has('error'), false);
});

test('refreshing with an existing session opens the dashboard without verifying the code again', async () => {
  const page = await createPage({ signedIn: true });
  assert.equal(page.get('[data-dashboard]').hidden, false);
  assert.equal(page.get('[data-auth-panel]').hidden, true);
  assert.equal(page.requests.some(({ path }) => path === '/api/partners/auth'), false);
});

test('signed-in lead search sends browser coordinates only to the protected server route', async () => {
  const page = await createPage({ signedIn: true });
  await page.submit('[data-lead-search]', { category: 'trades', radius: '5000' });
  const request = page.requests.find(({ path }) => path === '/api/businesses/nearby');
  assert.deepEqual(request.body, { latitude: -33.8688, longitude: 151.2093, radius: 5000, category: 'trades' });
  assert.equal(page.get('[data-lead-status]').textContent, '0 potential leads found. 24 searches remaining today.');
});

test('quote editor exposes every Pay as You Sell configuration only when selected', async () => {
  const page = await createPage({ signedIn: true });
  const form = page.get('[data-quote-form]');
  form.elements.paymentPlan.value = 'pay_as_you_sell';
  form.elements.payAsYouSellMethod.value = 'sales_milestone';
  form.elements.maintenanceEnabled.checked = true;
  form.listeners.get('input')({ currentTarget: form });
  assert.equal(page.get('[data-pay-as-you-sell-fields]').hidden, false);
  assert.equal(page.get('[data-sales-percent]').hidden, true);
  assert.equal(page.get('[data-sales-amount]').hidden, false);
  assert.equal(page.get('[data-sales-count]').hidden, false);
  assert.equal(page.get('[data-maintenance-amount]').hidden, false);
});
