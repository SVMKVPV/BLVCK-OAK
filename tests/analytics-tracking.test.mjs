import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../analytics-tracking.js', import.meta.url), 'utf8');

function browser({ path = '/websites-near-me-sydney', privacy = false, dnt = false, origin = 'https://blvckoak.com.au', prerendering = false } = {}) {
  const calls = [];
  const scripts = [];
  const listeners = new Map();
  const window = {};
  const context = {
    window, URL, URLSearchParams, Set, WeakSet,
    location: { protocol: 'https:', pathname: path, origin, search: '?utm_source=google&utm_campaign=Sam%40example.com&brief=confidential' },
    navigator: { globalPrivacyControl: privacy, doNotTrack: dnt ? '1' : '0' },
    document: { prerendering, referrer: 'https://example.org/private?email=person@example.org', addEventListener: (type, handler) => listeners.set(type, handler), createElement: () => ({}), head: { appendChild: script => scripts.push(script) } },
    fetch: async (url, options) => calls.push({ url, body: JSON.parse(options.body) }),
  };
  runInNewContext(source, context);
  return { calls, scripts, listeners, window, context };
}

test('measurement omits private pages, private query values and full referring URLs', () => {
  for (const path of ['/partners.html', '/partners%2ehtml', '/%70ay.html', '/anything/../analytics', '/analytics', '/pay.html', '/progress', '/oakpay-app.html', '/operations', '/business-tools.html', '/login/', '/api/partners']) {
    const state = browser({ path });
    assert.equal(state.calls.length, 0, path);
    assert.equal(state.scripts.length, 0, path);
    assert.equal(state.window.dataLayer, undefined, path);
  }
  const { calls } = browser();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { event: 'page_view', path: '/websites-near-me-sydney', referrer: 'https://example.org', utm_source: 'google' });
  assert.equal(browser({ privacy: true }).calls.length, 0);
  assert.equal(browser({ privacy: true }).scripts.length, 0);
  assert.equal(browser({ dnt: true }).scripts.length, 0);
});

test('loading the collector twice does not double count page views', () => {
  const state = browser();
  runInNewContext(source, state.context);
  assert.equal(state.calls.length, 1);
  assert.equal(state.scripts.length, 1);
  assert.equal(state.window.dataLayer.filter(command => command[0] === 'config').length, 1);
});

test('GA4 loads the supplied production tag with clean attribution and no advertising signals', () => {
  const { scripts, window } = browser();
  assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TFPKJ0JBG9');
  assert.equal(scripts[0].async, true);
  const config = window.dataLayer.find(command => command[0] === 'config');
  assert.equal(config[1], 'G-TFPKJ0JBG9');
  assert.equal(config[2].page_location, 'https://blvckoak.com.au/websites-near-me-sydney');
  assert.equal(config[2].page_referrer, 'https://example.org');
  assert.equal(config[2].campaign_source, 'google');
  assert.equal(config[2].campaign_name, undefined);
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.doesNotMatch(JSON.stringify(window.dataLayer), /confidential|person@|Sam@/);
  assert.equal(window.dataLayer.filter(command => command[0] === 'event' && command[1] === 'page_view').length, 0);
  assert.equal(browser({ origin: 'https://www.blvckoak.com.au' }).scripts.length, 1);
  for (const origin of ['https://deploy-preview-1--blvckoak.netlify.app', 'https://localhost', 'https://another.example']) {
    assert.equal(browser({ origin }).scripts.length, 0, origin);
  }
});

test('GA4 waits until a prerendered document becomes an actual visit', () => {
  const state = browser({ prerendering: true });
  assert.equal(state.scripts.length, 0);
  state.context.document.prerendering = false;
  state.listeners.get('prerenderingchange')();
  assert.equal(state.scripts.length, 1);
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
