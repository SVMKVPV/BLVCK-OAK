import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('studio homepage preserves production SEO, routes and commercial journeys', async () => {
  const [html, build] = await Promise.all([read('index.html'), read('scripts/build.mjs')]);

  assert.match(html, /<link rel="canonical" href="https:\/\/blvckoak\.com\.au\/"/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(html, /"@type": "Organization"/);
  assert.match(html, /"@type": "WebSite"/);
  assert.match(html, /"@type": "WebPage"/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);

  for (const route of [
    'audit.html', 'book.html', 'quote.html', 'portfolio.html', 'marketplace.html',
    'community.html', 'referrals.html', 'contact.html', 'partners.html',
    'privacy.html', 'terms.html', 'refunds.html',
  ]) {
    assert.ok(html.includes(`href="${route}"`), `${route} remains reachable from the homepage`);
  }

  for (const id of [
    'approach', 'seo-search', 'workflow-ai', 'digital-marketing', 'digital-branding',
    'consulting-coaching', 'website-upgrades', 'essential-demo', 'professional-demo',
    'enterprise-demo', 'brand-film', 'referrals', 'referral-signup', 'faq-title',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `legacy fragment #${id} remains valid`);
  }

  for (const packageId of ['link-in-bio', 'essential', 'professional', 'enterprise']) {
    assert.ok(html.includes(`data-package="${packageId}"`), `${packageId} remains connected to checkout`);
  }
  assert.match(html, /data-payment-notice/);
  assert.match(html, /data-modal-backdrop/);
  assert.match(html, /data-checkout-action/);
  assert.match(html, /data-enterprise-referral/);
  assert.match(html, /data-enterprise-apply/);
  assert.match(html, /<section[^>]*id="top"[^>]*>/);
  assert.match(html, /data-future-scene/);
  assert.match(html, /data-future-canvas/);
  assert.doesNotMatch(html, /data-oak-origin|data-oak-video/);
  assert.doesNotMatch(html, /<script[^>]*src="cinematic-intro\.js/);
  assert.doesNotMatch(html, /<link[^>]*href="studio-intro\.css/);
  assert.doesNotMatch(html, /href="https:\/\/blvckoak\.com\.au\/(?:quote|book|portfolio)\.html"/);

  for (const asset of ['studio.css', 'studio.js', 'future-ui.css', 'future-ui.js', 'future-scene.js']) {
    assert.ok(build.includes(`'${asset}'`), `${asset} is copied into the release`);
    assert.ok(html.includes(asset), `${asset} is loaded by the homepage`);
  }
});

test('studio interactions are isolated and the mobile menu contains keyboard focus', async () => {
  const [client, checkoutClient, html, css] = await Promise.all([
    read('studio.js'), read('script.js'), read('index.html'), read('studio.css'),
  ]);
  assert.match(client, /^\(\(\) => \{/);
  assert.match(client, /element\.inert = opening/);
  assert.match(client, /event\.key !== "Tab"/);
  assert.match(client, /result\.dataset\.publicAction/);
  assert.match(client, /!detailDialog\.open && !checkoutOpen/);
  assert.match(client, /\}\)\(\);\s*$/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /\.mobile-menu\s*\{[\s\S]*?min-height:\s*calc\(100svh - var\(--header-h\)\)/);
  assert.match(html, /class="checkout-modal"[^>]+aria-hidden="true"/);
  assert.match(checkoutClient, /checkoutModal\?\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(checkoutClient, /checkoutModal\?\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(checkoutClient, /Stripe is confirming your payment/);
  assert.doesNotMatch(checkoutClient, /Payment received\./);
  assert.doesNotMatch(html, /src="sales(?:-config)?\.js/);
});

test('homepage provides immediate content and a CSP-compatible static scene fallback without JavaScript', async () => {
  const [html, noScriptCss, build] = await Promise.all([
    read('index.html'), read('studio-noscript.css'), read('scripts/build.mjs'),
  ]);
  assert.match(html, /<noscript>\s*<link rel="stylesheet" href="studio-noscript\.css(?:\?v=\d+)?"\s*\/>\s*<\/noscript>/);
  assert.doesNotMatch(html, /<noscript>[\s\S]*?<style>/);
  assert.match(html, /href="#main-content"[^>]*>Skip to content/);
  assert.match(html, /class="[^"]*\bfuture-scene__fallback\b/);
  assert.match(html, /<div[^>]*data-future-scene[^>]*aria-hidden="true"/);
  assert.ok(html.indexOf('id="main-content"') < html.indexOf('data-future-scene'), 'the scene decorates the main content instead of gating access to it');
  assert.match(html, /<button[^>]*data-motion-toggle/);
  assert.match(noScriptCss, /\.motion-toggle[^{}]*\{\s*display:\s*none\s*!important/);
  assert.match(noScriptCss, /\.future-scene__fallback[^{}]*\{\s*opacity:\s*1\s*!important/);
  assert.ok(build.includes("'studio-noscript.css'"));
});
