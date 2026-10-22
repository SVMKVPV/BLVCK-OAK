import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('studio homepage preserves production SEO, routes and commercial journeys', async () => {
  const [html, build] = await Promise.all([read('index.html'), read('scripts/build.mjs')]);

  assert.match(html, /<link rel="canonical" href="https:\/\/blvckoak\.com\.au\/"/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(html, /"@type": "LocalBusiness"/);
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
  assert.match(html, /data-oak-origin/);
  assert.match(html, /data-oak-video/);
  assert.match(html, /<source[^>]*src="assets\/obsidian-oak-scroll-ccw\.mp4"[^>]*type="video\/mp4"/);
  assert.doesNotMatch(html, /data-future-scene|data-future-canvas/);
  assert.doesNotMatch(html, /<script[^>]*src="future-scene\.js/);
  assert.doesNotMatch(html, /href="https:\/\/blvckoak\.com\.au\/(?:quote|book|portfolio)\.html"/);

  for (const asset of ['studio.css', 'studio.js', 'studio-intro.css', 'cinematic-intro.js', 'liquid-oak.js', 'future-ui.css', 'future-ui.js']) {
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

test('restored tree has a real content shortcut and a CSP-compatible still fallback without JavaScript', async () => {
  const [html, noScriptCss, introCss, build, poster] = await Promise.all([
    read('index.html'), read('studio-noscript.css'), read('studio-intro.css'), read('scripts/build.mjs'),
    readFile(new URL('../assets/obsidian-oak-scroll-poster.webp', import.meta.url)),
  ]);
  assert.match(html, /<noscript>\s*<link rel="stylesheet" href="studio-noscript\.css(?:\?v=\d+)?"\s*\/>\s*<\/noscript>/);
  assert.doesNotMatch(html, /<noscript>[\s\S]*?<style>/);
  assert.match(html, /href="#main-content"[^>]*>Skip to content/);
  assert.match(html, /<a[^>]*href="#main-content"[^>]*data-oak-skip/);
  assert.match(html, /<main[^>]*id="main-content"[^>]*tabindex="-1"/);
  assert.ok(html.indexOf('data-oak-origin') < html.indexOf('id="main-content"'), 'the original scroll sequence opens before the studio content');
  assert.match(html, /<img[^>]*class="oak-origin-poster"[^>]*src="assets\/obsidian-oak-scroll-poster\.webp"[^>]*alt=""[^>]*aria-hidden="true"/);
  assert.match(html, /<video[^>]*data-oak-video[^>]*muted[^>]*playsinline[^>]*poster="assets\/obsidian-oak-scroll-poster\.webp"[^>]*aria-hidden="true"/);
  assert.equal(poster.toString('ascii', 0, 4), 'RIFF');
  assert.equal(poster.toString('ascii', 8, 12), 'WEBP');
  assert.ok(poster.byteLength > 1_000, 'the still fallback is a real image asset');
  assert.match(introCss, /\.oak-origin-poster\s*\{/);
  assert.match(html, /<button[^>]*data-motion-toggle/);
  assert.match(noScriptCss, /\.motion-toggle[^{}]*\{\s*display:\s*none\s*!important/);
  assert.match(noScriptCss, /\.oak-origin\s*\{[^}]*height:\s*100svh/);
  assert.match(noScriptCss, /\.oak-origin-stage\s*\{[^}]*position:\s*relative/);
  assert.match(noScriptCss, /\.oak-origin-video,[\s\S]*?display:\s*none\s*!important/);
  assert.ok(build.includes("'studio-noscript.css'"));
});
