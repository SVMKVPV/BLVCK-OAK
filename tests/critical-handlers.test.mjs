import assert from 'node:assert/strict';
import test from 'node:test';

import partnerAuth from '../netlify/functions/partner-auth.mjs';
import stripeWebhook from '../netlify/functions/stripe-webhook.mjs';
import identitySignup from '../netlify/functions/identity-signup.mjs';

async function body(response) {
  return response.json();
}

test('partner auth rejects wrong methods before touching account storage', async () => {
  const response = await partnerAuth(new Request('https://blackoak.example/api/partners/auth'));
  assert.equal(response.status, 405);
});

test('partner auth enforces same-origin and JSON content type', async () => {
  const oldSite = process.env.SITE_URL;
  process.env.SITE_URL = 'https://blackoak.example';
  try {
    const crossOrigin = await partnerAuth(new Request('https://blackoak.example/api/partners/auth', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(crossOrigin.status, 403);

    const wrongType = await partnerAuth(new Request('https://blackoak.example/api/partners/auth', {
      method: 'POST',
      headers: { origin: 'https://blackoak.example', 'content-type': 'text/plain' },
      body: '{}',
    }));
    assert.equal(wrongType.status, 415);
  } finally {
    if (oldSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = oldSite;
  }
});

test('Stripe webhook rejects unsupported methods and fails closed when secrets are absent', async () => {
  const oldAccount = process.env.STRIPE_WEBHOOK_SECRET;
  const oldConnect = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  try {
    assert.equal((await stripeWebhook(new Request('https://blackoak.example/api/stripe/webhook'))).status, 405);
    const response = await stripeWebhook(new Request('https://blackoak.example/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.status, 503);
    assert.match((await body(response)).error, /not configured/i);
  } finally {
    if (oldAccount === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = oldAccount;
    if (oldConnect === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = oldConnect;
  }
});

test('legacy Identity signup hook allows only the configured Google owner', async () => {
  const oldOwner = process.env.OWNER_AUTH_EMAIL;
  process.env.OWNER_AUTH_EMAIL = 'owner@example.test';
  try {
    const allowed = await identitySignup(new Request('https://blackoak.example/.netlify/functions/identity-signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { user: { email: 'owner@example.test', provider: 'google' } } }),
    }));
    assert.equal(allowed.status, 204);

    const passwordOwner = await identitySignup(new Request('https://blackoak.example/.netlify/functions/identity-signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { user: { email: 'owner@example.test', provider: 'email' } } }),
    }));
    assert.equal(passwordOwner.status, 403);
  } finally {
    if (oldOwner === undefined) delete process.env.OWNER_AUTH_EMAIL;
    else process.env.OWNER_AUTH_EMAIL = oldOwner;
  }
});
