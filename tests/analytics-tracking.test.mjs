import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../analytics-tracking.js', import.meta.url), 'utf8');

function browser({ path = '/websites-near-me-sydney', privacy = false } = {}) {
  const calls = [];
  const listeners = new Map();
  const window = {};
  const context = {
    window, URL, URLSearchParams, Set, WeakSet,
    location: { protocol: 'https:', pathname: path, origin: 'https://blvckoak.com.au', search: '?utm_source=google&utm_campaign=Sam%40example.com&brief=confidential' },
    navigator: { globalPrivacyControl: privacy },
    document: { referrer: 'https://example.org/private?email=person@example.org', addEventListener: (type, handler) => listeners.set(type, handler) },
    fetch: async (url, options) => calls.push({ url, body: JSON.parse(options.body) }),
  };
  runInNewContext(source, context);
  return { calls, listeners, window, context };
}

test('measurement omits private pages, private query values and full referring URLs', () => {
  for (const path of ['/partners.html', '/partners%2ehtml', '/%70ay.html', '/anything/../analytics', '/analytics', '/pay.html', '/progress', '/oakpay-app.html', '/login/', '/api/partners']) {
    assert.equal(browser({ path }).calls.length, 0, path);
  }
  const { calls } = browser();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { event: 'page_view', path: '/websites-near-me-sydney', referrer: 'https://example.org', utm_source: 'google' });
  assert.equal(browser({ privacy: true }).calls.length, 0);
});

test('loading the collector twice does not double count page views', () => {
  const state = browser();
  runInNewContext(source, state.context);
  assert.equal(state.calls.length, 1);
});

test('form interaction is counted once without reading form fields or assuming success', () => {
  const { calls, listeners, window } = browser();
  const form = {};
  const event = { target: { closest: () => form } };
  listeners.get('focusin')(event);
  listeners.get('focusin')(event);
  assert.deepEqual(calls.map(row => row.body.event), ['page_view', 'form_start']);
  window.blvckOakAnalytics.track('form_success');
  window.blvckOakAnalytics.track('invented_event');
  assert.deepEqual(calls.map(row => row.body.event), ['page_view', 'form_start', 'form_success']);
});

test('local acquisition clicks are counted while external and cancelled links are ignored', () => {
  const { calls, listeners } = browser();
  const click = (href, defaultPrevented = false) => listeners.get('click')({ defaultPrevented, target: { closest: () => ({ href, hasAttribute: () => false }) } });
  click('/quote.html');
  click('https://another.example/contact');
  click('/book', true);
  assert.deepEqual(calls.map(row => row.body.event), ['page_view', 'quote_click']);
});
