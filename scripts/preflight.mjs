import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const requiredFiles = [
  'partners.html',
  'partners.js',
  'portal.css',
  'pay.html',
  'pay.js',
  'progress.html',
  'progress.js',
  'portfolio.html',
  'portfolio.js',
  'quote.html',
  'quote-builder.js',
  'netlify/functions/partner-auth.mjs',
  'netlify/functions/partner-api.mjs',
  'netlify/functions/nearby-businesses.mjs',
  'netlify/lib/nearby-businesses.mjs',
  'netlify/functions/quote-payment.mjs',
  'netlify/functions/project-progress.mjs',
  'netlify/lib/project-progress.mjs',
  'netlify/functions/portfolio.mjs',
  'netlify/lib/portfolio.mjs',
  'netlify/functions/stripe-connect-callback.mjs',
  'netlify/lib/pay-as-you-sell.mjs',
  'index.html',
  'referrals.html',
  'contact.html',
  'privacy.html',
  'terms.html',
  'refunds.html',
  'netlify.toml',
  'netlify/functions/package-checkout.mjs',
  'netlify/functions/referral-register.mjs',
  'netlify/functions/referral-verify.mjs',
  'netlify/functions/referral-access.mjs',
  'netlify/functions/stripe-webhook.mjs',
  'netlify/functions/weekly-referral-payouts.mjs',
];

for (const file of requiredFiles) {
  try { await access(resolve(root, file)); }
  catch { failures.push(`Missing required file: ${file}`); }
}

const index = await readFile(resolve(root, 'index.html'), 'utf8');
const client = await readFile(resolve(root, 'script.js'), 'utf8');
const redirects = await readFile(resolve(root, 'netlify.toml'), 'utf8');

if (/buy\.stripe\.com\/test_/i.test(index) || /buy\.stripe\.com\/test_/i.test(client)) {
  failures.push('A Stripe test Payment Link is still exposed in public client code.');
}
if (!/data-package="enterprise"/.test(index)) failures.push('Enterprise is not routed through server checkout.');
for (const route of ['/api/partners/auth', '/api/partners', '/api/businesses/nearby', '/api/quote-payment', '/api/project-progress', '/api/portfolio', '/api/stripe/connect/callback', '/api/contact', '/api/stripe/webhook']) {
  if (!redirects.includes(route)) failures.push(`Missing Netlify route: ${route}`);
}

if (process.argv.includes('--live')) {
  const expected = [
    ['SITE_URL', (value) => /^https:\/\/[^\s]+$/i.test(value)],
    ['STRIPE_SECRET_KEY', (value) => /^sk_live_/.test(value)],
    ['STRIPE_WEBHOOK_SECRET', (value) => /^whsec_/.test(value)],
    ['STRIPE_CONNECT_CLIENT_ID', (value) => /^ca_[A-Za-z0-9]+$/.test(value)],
    ['STRIPE_CONNECT_WEBHOOK_SECRET', (value) => /^whsec_/.test(value)],
    ['RESEND_API_KEY', (value) => /^re_/.test(value)],
    ['EMAIL_FROM', (value) => /@/.test(value) && !/example/i.test(value)],
    ['OWNER_EMAIL', (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/example/i.test(value)],
    ['SUPPORT_EMAIL', (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/example/i.test(value)],
    ['GOOGLE_MAPS_API_KEY', (value) => /^AIza[0-9A-Za-z_-]{30,}$/.test(value)],
  ];
  for (const [name, validate] of expected) {
    const value = String(process.env[name] || '').trim();
    if (!validate(value)) failures.push(`${name} is missing or is not a production value.`);
  }
}

if (failures.length) {
  console.error(`Preflight failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(process.argv.includes('--live')
    ? 'Live preflight passed.'
    : 'Structural preflight passed. Run pnpm run preflight:live with production environment variables before launch.');
}
