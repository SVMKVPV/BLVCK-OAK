import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../marketplace.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../marketplace.html', import.meta.url), 'utf8');
const portfolio = await readFile(new URL('../portfolio.html', import.meta.url), 'utf8');
const registry = JSON.parse(await readFile(new URL('../portfolio-repositories.json', import.meta.url), 'utf8'));
const renderStart = source.indexOf('\n  function render(){');
assert.ok(renderStart > 0, 'Marketplace card rendering is available');
const { products, card } = runInNewContext(
  source.slice(source.indexOf('{') + 1, renderStart) + '\n({products, card});',
  { document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null }, Intl, URLSearchParams }
);
const origin = 'https://blvckoak.com.au/';
const repaired = [
  { id: 'wedding-invitation', preview: 'https://the-20-december-wedding.samkapa3.chatgpt.site/', thumbnail: 'assets/marketplace/wedding-preview.jpg', external: true },
  { id: 'bambis-bakery', preview: 'previews/bambis-bakery.html', thumbnail: 'assets/marketplace/bakery-preview.jpg' }
];
const portfolioCards = [...portfolio.matchAll(/<a\b[^>]*class="concept-card\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);

test('Wedding opens its public invitation while Bambi stays on the marketplace host', () => {
  for (const repairedPreview of repaired) {
    const product = products.find(item => item.id === repairedPreview.id);
    assert.ok(product);
    assert.equal(product.preview, repairedPreview.preview);
    if (repairedPreview.external) assert.notEqual(new URL(product.preview, origin).origin, new URL(origin).origin);
    else assert.equal(new URL(product.preview, origin).origin, new URL(origin).origin);
    assert.equal(registry.sites.find(site => site.id === product.id).currentPreview, product.preview);
    const rendered = card(product);
    assert.ok(rendered.includes(`href="${product.preview}"`));
    const portfolioCard = portfolioCards.find(item => item.includes(`href="${product.preview}"`));
    assert.ok(portfolioCard, `${product.name} retains its working portfolio preview`);
    assert.doesNotMatch(rendered + portfolioCard, /\b3d\b/i);
  }
});

test('Wedding and Bambi cards render local thumbnail images instead of gated iframes', () => {
  for (const repairedPreview of repaired) {
    const product = products.find(item => item.id === repairedPreview.id);
    assert.equal(product.thumbnail, repairedPreview.thumbnail);
    const rendered = card(product);
    assert.match(rendered, /<img\b[^>]*class="site-preview-image"/);
    assert.ok(rendered.includes(`src="${product.thumbnail}"`));
    assert.doesNotMatch(rendered, /<iframe\b/i);
    assert.ok(rendered.includes(`alt="${product.name} website preview"`));
  }
});

test('marketplace screenshot assets exist and contain nonempty JPEG images', async () => {
  for (const repairedPreview of repaired) {
    const image = await readFile(new URL(`../${repairedPreview.thumbnail}`, import.meta.url));
    assert.ok(image.length > 1024, `${repairedPreview.id} thumbnail contains image data`);
    assert.equal(image[0], 0xff);
    assert.equal(image[1], 0xd8);
    assert.equal(image[2], 0xff);
  }
});

test('unpublished beauty concept renders request navigation without a broken live preview', () => {
  const beauty = products.find(item => item.id === 'velora-beauty');
  assert.equal(beauty.preview, null);
  assert.equal(beauty.badge, 'Preview by request');
  const rendered = card(beauty);
  assert.match(rendered, /Preview by request/);
  assert.match(rendered, /Request website preview/);
  assert.doesNotMatch(rendered, /<iframe\b|Live preview|Live Netlify|Netlify live/i);
  const links = [...rendered.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), origin));
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.pathname, '/contact.html');
    assert.equal(link.searchParams.get('service'), 'website-packages');
    assert.ok(link.searchParams.get('brief').includes(beauty.name));
    assert.match(link.searchParams.get('brief'), /request a preview/);
  }
  const entry = registry.sites.find(site => site.id === beauty.id);
  assert.equal(entry.previewStatus, 'request_only');
  const listing = new URL(entry.currentPreview, origin);
  assert.equal(listing.pathname, '/marketplace.html');
  assert.equal(listing.searchParams.get('search'), 'Velora Beauty');
  assert.equal(listing.hash, '#shop');
  assert.doesNotMatch(source + portfolio + JSON.stringify(registry), /velora-beauty-uiu2\.netlify\.app/);
});

test('beauty portfolio listings lead to the request listing rather than Coming soon', () => {
  const beautyCards = portfolioCards.filter(item => item.includes('<h3>Velora Beauty</h3>'));
  assert.equal(beautyCards.length, 2);
  for (const beautyCard of beautyCards) {
    assert.ok(beautyCard.includes('href="marketplace.html?search=Velora%20Beauty#shop"'));
    assert.match(beautyCard, /Request preview/);
    assert.doesNotMatch(beautyCard, /coming-soon\.html|Coming soon|Netlify · Live|Open live site/);
  }
  assert.match(page, /<script\b[^>]*src="marketplace\.js\?v=\d+"[^>]*defer/);
  assert.match(page, /data-product-grid/);
});
