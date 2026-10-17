import assert from 'node:assert/strict';
import test from 'node:test';

import analyticsVisit from '../netlify/functions/analytics-visit.mjs';
import bookingSubmit, { validSydneyBookingTime } from '../netlify/functions/booking-submit.mjs';
import contactSubmit from '../netlify/functions/contact-submit.mjs';
import packageCheckout from '../netlify/functions/package-checkout.mjs';
import websiteAudit from '../netlify/functions/website-audit.mjs';

const site = 'https://blackoak.example';

function post(path, body, { contentType = 'application/json', origin = site } = {}) {
  const headers = { origin };
  if (contentType) headers['content-type'] = contentType;
  return new Request(`${site}${path}`, { method: 'POST', headers, body });
}

test('public analytics rejects cross-origin writes before accepting a visit', async () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = site;
  try {
    const response = await analyticsVisit(post('/.netlify/functions/analytics-visit', '{}', {
      origin: 'https://attacker.example',
    }));
    assert.equal(response.status, 403);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});

test('public analytics checks origin before parsing an invalid body', async () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = site;
  try {
    const response = await analyticsVisit(post('/.netlify/functions/analytics-visit', '{', {
      origin: 'https://attacker.example',
    }));
    assert.equal(response.status, 403);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});

test('public JSON handlers require application/json before doing work', async () => {
  const handlers = [
    ['analytics', analyticsVisit, '/.netlify/functions/analytics-visit'],
    ['booking', bookingSubmit, '/.netlify/functions/booking-submit'],
    ['contact', contactSubmit, '/.netlify/functions/contact-submit'],
    ['checkout', packageCheckout, '/.netlify/functions/package-checkout'],
    ['audit', websiteAudit, '/.netlify/functions/website-audit'],
  ];

  for (const [name, handler, path] of handlers) {
    const response = await handler(post(path, '{}', { contentType: 'text/plain' }));
    assert.equal(response.status, 415, `${name} should reject non-JSON input`);

    const misleading = await handler(post(path, '{}', { contentType: 'text/application/json-attack' }));
    assert.equal(misleading.status, 415, `${name} should require an exact JSON media type`);

    const charset = await handler(post(path, '{}', { contentType: 'application/json; charset=utf-8' }));
    assert.notEqual(charset.status, 415, `${name} should accept JSON with a charset parameter`);
  }
});

test('public JSON handlers enforce actual UTF-8 body limits without a Content-Length header', async () => {
  const handlers = [
    ['analytics', analyticsVisit, '/.netlify/functions/analytics-visit', 2048],
    ['booking', bookingSubmit, '/.netlify/functions/booking-submit', 8192],
    ['contact', contactSubmit, '/.netlify/functions/contact-submit', 16_384],
    ['checkout', packageCheckout, '/.netlify/functions/package-checkout', 4096],
    ['audit', websiteAudit, '/.netlify/functions/website-audit', 8192],
  ];

  for (const [name, handler, path, limit] of handlers) {
    const request = post(path, JSON.stringify({ padding: 'é'.repeat(limit) }));
    assert.equal(request.headers.get('content-length'), null, `${name} test must not rely on Content-Length`);
    const response = await handler(request);
    assert.equal(response.status, 413, `${name} should reject an oversized UTF-8 body`);
  }
});

test('public JSON handlers report invalid JSON as a client error', async () => {
  const handlers = [
    ['analytics', analyticsVisit, '/.netlify/functions/analytics-visit'],
    ['booking', bookingSubmit, '/.netlify/functions/booking-submit'],
    ['contact', contactSubmit, '/.netlify/functions/contact-submit'],
    ['checkout', packageCheckout, '/.netlify/functions/package-checkout'],
    ['audit', websiteAudit, '/.netlify/functions/website-audit'],
  ];

  for (const [name, handler, path] of handlers) {
    const response = await handler(post(path, '{'));
    assert.equal(response.status, 400, `${name} should reject malformed JSON`);
  }
});

test('booking validation follows the Australia/Sydney clock across daylight saving', () => {
  const springNow = Date.parse('2026-10-17T00:00:00Z'); // 11:00 in Sydney (AEDT)
  assert.equal(validSydneyBookingTime('2026-10-17', '10:59', springNow), false);
  assert.equal(validSydneyBookingTime('2026-10-17', '11:01', springNow), true);

  const winterNow = Date.parse('2026-06-17T00:00:00Z'); // 10:00 in Sydney (AEST)
  assert.equal(validSydneyBookingTime('2026-06-17', '09:59', winterNow), false);
  assert.equal(validSydneyBookingTime('2026-06-17', '10:01', winterNow), true);
  assert.equal(validSydneyBookingTime('2026-02-30', '10:00', winterNow), false);
  assert.equal(validSydneyBookingTime('2026-06-18', '21:00', winterNow), false);
});
