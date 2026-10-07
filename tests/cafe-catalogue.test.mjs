import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const registry = JSON.parse(await readFile(new URL('../portfolio-repositories.json', import.meta.url), 'utf8'));
const marketplace = await readFile(new URL('../marketplace.js', import.meta.url), 'utf8');
const portfolio = await readFile(new URL('../portfolio.html', import.meta.url), 'utf8');
const declaration = marketplace.match(/const products=\[[\s\S]*?\n  \];/);
assert.ok(declaration, 'Marketplace product catalogue is available');
const products = runInNewContext(`${declaration[0]}\nproducts;`);

const cafes = [
  { id: 'tablepulse', name: 'TablePulse', preview: 'previews/qr-menu-ordering.html', deployment: 'https://tablepulse-blackoak.netlify.app', repo: 'SVMKVPV/blvckoak-portfolio-tablepulse' },
  { id: 'aurora-cafe', name: 'Aurora Cafe', preview: 'previews/aurora-cafe.html', deployment: 'https://aurora-cafe-blackoak.netlify.app', repo: 'SVMKVPV/blvckoak-portfolio-aurora-cafe' }
];

test('cafe registry records independent private sources and stable preview routes', () => {
  for (const cafe of cafes) {
    const entry = registry.sites.find(site => site.id === cafe.id);
    assert.ok(entry, `${cafe.name} has a registry entry`);
    assert.equal(entry.currentPreview, cafe.preview);
    assert.equal(entry.deploymentUrl, cafe.deployment);
    assert.equal(entry.currentSource, cafe.repo);
    assert.equal(entry.targetRepo, cafe.repo);
    assert.equal(entry.repoVisibility, 'private');
    assert.equal(entry.repoStatus, 'active');
    assert.equal(registry.sites.filter(site => site.id === cafe.id).length, 1);
  }
  assert.match(registry.policy.futureEdits, /dedicated repository/);
});

test('cafe marketplace entries keep gated previews and honest demo features', () => {
  for (const cafe of cafes) {
    const product = products.find(item => item.id === cafe.id);
    assert.ok(product, `${cafe.name} can be discovered in the marketplace`);
    assert.equal(product.preview, cafe.preview);
    assert.equal(product.category, 'Hospitality');
  }
  assert.ok(products.find(item => item.id === 'tablepulse').features.includes('Demo checkout'));
  assert.ok(products.find(item => item.id === 'aurora-cafe').features.includes('Reservation preview'));
  assert.equal(products.find(item => item.id === 'aurora-cafe').price, null);
  assert.equal(new Set(products.map(item => item.id)).size, products.length);
  assert.equal(new Set(products.map(item => item.rank)).size, products.length);
});

test('portfolio presents both cafe previews and the correct concept count', () => {
  const gallery = portfolio.match(/<section class="concept-gallery"[\s\S]*?<\/section>/)?.[0];
  assert.ok(gallery, 'Interactive concept gallery is available');
  const declaredCount = Number(gallery.match(/<strong>(\d+)<\/strong>/)?.[1]);
  assert.equal((gallery.match(/class="concept-card\b/g) || []).length, declaredCount);
  for (const cafe of cafes) {
    assert.ok(gallery.includes(`href="${cafe.preview}"`));
    assert.ok(gallery.includes(`src="${cafe.preview}"`));
    assert.ok(gallery.includes(`<h3>${cafe.name}</h3>`));
  }
});
