import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import contactHandler from '../netlify/functions/contact-submit.mjs';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const contact = await readFile(new URL('../contact.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const services = new Map([
  ['seo-search', 'SEO & Search Strategy'],
  ['digital-marketing', 'Digital Marketing'],
  ['workflow-ai', 'Workflow & AI Automation'],
  ['digital-branding', 'Digital Branding & Asset Kits'],
  ['consulting-coaching', 'High-Ticket Consulting / Coaching'],
  ['website-upgrades', 'Website Upgrades'],
]);
const options = [...contact.matchAll(/<option value="([^"]*)"[^>]*>([^<]+)<\/option>/g)]
  .map((match) => ({ value: match[1], label: match[2].replaceAll('&amp;', '&') }));

test('all six service cards have enquiry links and no prices or checkout controls', () => {
  const section = index.match(/<section class="services"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.equal([...section.matchAll(/<article /g)].length, 6);
  assert.doesNotMatch(section, /\$|\bAUD\b|data-package=|buy\.stripe\.com/);
  assert.match(index, /href="#services">Services/);
  for (const [id, label] of services) {
    assert.ok(section.includes(`id="${id}"`));
    assert.ok(section.includes(`href="contact.html?service=${id}#contact-title"`));
    assert.equal(options.find((option) => option.value === id)?.label, label);
  }
  // Existing purchases still use the original three package controls.
  assert.deepEqual([...index.matchAll(/data-package="([^"]+)"/g)].map((match) => match[1]), ['essential', 'professional', 'enterprise']);
});

function createPage(query = '', reject = false) {
  const listeners = new Map();
  const service = { options, value: '' };
  const button = { disabled: false };
  const classes = new Set();
  const status = { textContent: '', classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const message = { value: 'Please help improve our website and workflow.' };
  const form = {
    resetCalls: 0,
    values: { name: 'Test Client', email: 'client@example.test', company: 'Example', message: message.value, privacy: 'on' },
    addEventListener: (name, handler) => listeners.set(name, handler),
    querySelector: () => button,
    reset() { this.resetCalls += 1; this.values = {}; service.value = ''; message.value = ''; },
  };
  const nodes = new Map([['[data-contact-form]', form], ['[data-contact-service]', service], ['[data-contact-message]', message], ['[data-contact-status]', status]]);
  const requests = [];
  runInNewContext(client, {
    URL, URLSearchParams, crypto: { randomUUID }, HTMLCanvasElement: class {}, HTMLElement: class {},
    window: {
      location: { search: query, origin: 'https://example.test' }, scrollY: 0,
      matchMedia: (rule) => ({ matches: rule.includes('reduced-motion') }),
      addEventListener() {}, setTimeout() {},
    },
    document: {
      querySelector: (selector) => nodes.get(selector) || null,
      querySelectorAll: () => [], addEventListener() {},
      documentElement: { classList: { add() {} } }, body: { classList: { toggle() {} } },
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    FormData: class {
      constructor(element) { assert.equal(element, form); }
      get(key) { return key === 'service' ? service.value : key === 'message' ? message.value : form.values[key] ?? ''; }
    },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: !reject, json: async () => reject ? { error: 'Please try again.' } : { message: 'Enquiry sent.' } };
    },
  }, { filename: 'script.js' });
  return { service, message, form, button, status, classes, requests, submit: () => listeners.get('submit')({ preventDefault() {} }) };
}

test('each service link preselects its option and sends that choice to the contact endpoint', async () => {
  for (const [id] of services) {
    const page = createPage(`?service=${id}`);
    assert.equal(page.service.value, id);
    await page.submit();
    assert.equal(page.requests[0].url, '/api/contact');
    assert.equal(page.requests[0].body.service, id);
    assert.equal(page.requests[0].body.acceptedPrivacy, true);
    assert.equal(page.form.resetCalls, 1);
    assert.equal(page.service.value, id);
    assert.equal(page.status.textContent, 'Enquiry sent.');
    assert.equal(page.button.disabled, false);
  }
});

test('an unknown URL service is ignored; the visitor can choose or change the service', async () => {
  for (const query of ['', '?service=unknown', '?service=__proto__', '?service=%3Cscript%3E']) {
    const page = createPage(query);
    assert.equal(page.service.value, '');
    page.service.value = 'digital-branding';
    await page.submit();
    assert.equal(page.requests[0].body.service, 'digital-branding');
  }
  const page = createPage('?service=seo-search');
  page.service.value = 'website-upgrades';
  await page.submit();
  assert.equal(page.requests[0].body.service, 'website-upgrades');
});

test('the self-quote brief safely prefills the contact message for customer review', async () => {
  const brief = 'BLACK OAK SELF-QUOTE — INDICATIVE ESTIMATE ONLY\nEstimated one-off project: A$1,500–A$2,400 AUD';
  const page = createPage(`?service=general&brief=${encodeURIComponent(brief)}`);
  assert.equal(page.service.value, 'general');
  assert.equal(page.message.value, brief);
  await page.submit();
  assert.equal(page.requests[0].body.message, brief);
});

test('failed enquiries keep the visitor’s message and service choice for retry', async () => {
  const page = createPage('?service=workflow-ai', true);
  await page.submit();
  assert.equal(page.form.resetCalls, 0);
  assert.equal(page.service.value, 'workflow-ai');
  assert.ok(page.form.values.message);
  assert.equal(page.status.textContent, 'Please try again.');
  assert.ok(page.classes.has('error'));
  assert.equal(page.button.disabled, false);
});

const validBody = {
  name: 'Test Client', email: 'client@example.test', company: 'Example & Co',
  message: 'Please review our current website and digital strategy.', acceptedPrivacy: true,
  requestId: '12345678-1234-1234-1234-123456789012',
};
const request = (body) => new Request('https://example.test/api/contact', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('server sends the validated service label to the owner and customer using the existing mail integration', async (t) => {
  const values = { OWNER_EMAIL: 'owner@example.test', RESEND_API_KEY: 'test-placeholder', EMAIL_FROM: 'studio@example.test' };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const deliveries = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    deliveries.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mock-email' }), { status: 200 });
  });
  for (const option of options.filter((item) => item.value)) {
    deliveries.length = 0;
    const response = await contactHandler(request({ ...validBody, service: option.value }));
    assert.equal(response.status, 201);
    assert.equal(deliveries.length, 2);
    assert.deepEqual(deliveries[0].to, ['owner@example.test']);
    assert.ok(deliveries[0].text.includes(`Service: ${option.label}`));
    assert.ok(deliveries[0].subject.includes(option.label));
    assert.ok(deliveries[1].text.includes(option.label));
    assert.ok(deliveries[0].html.includes('Example &amp; Co'));
    assert.ok(deliveries[0].html.includes(option.label.replaceAll('&', '&amp;')));
  }
  deliveries.length = 0;
  assert.equal((await contactHandler(request(validBody))).status, 201);
  assert.ok(deliveries[0].text.includes('Not sure yet / Multiple services'));
});

test('server rejects forged service choices without sending email', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => assert.fail('Invalid service must not send email'));
  for (const service of ['unknown', '__proto__', 'constructor', '<script>alert(1)</script>', ['seo-search'], { value: 'seo-search' }, 123]) {
    const response = await contactHandler(request({ ...validBody, service }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Choose a service from the list.');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
