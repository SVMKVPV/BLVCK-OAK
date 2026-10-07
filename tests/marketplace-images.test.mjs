import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../marketplace.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../marketplace.css', import.meta.url), 'utf8');
const renderStart = source.indexOf('\n  function render(){');
assert.ok(renderStart > 0, 'Marketplace rendering is available');
const { products, directory, card, bindPreviewImages, businessCard } = runInNewContext(
  source.slice(source.indexOf('{') + 1, renderStart) + '\n({products, directory, card, bindPreviewImages, businessCard(p){mode="businesses";try{return card(p)}finally{mode="websites"}}});',
  { document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null }, Intl, URLSearchParams }
);

test('every marketplace item has a local thumbnail without a live iframe', () => {
  assert.equal(products.length, 23);
  assert.equal(new Set(products.map(product => product.thumbnail)).size, products.length);
  for (const product of products) {
    assert.match(product.thumbnail, /^assets\/marketplace\/[a-z0-9-]+\.jpg$/);
    const rendered = card(product);
    assert.match(rendered, /<img\b[^>]*data-preview-image/);
    assert.ok(rendered.includes(`src="${product.thumbnail}"`));
    assert.ok(rendered.includes(`alt="${product.thumbnailAlt || product.name + ' website preview'}"`));
    assert.match(rendered, /width="1234" height="712" loading="lazy"/);
    assert.doesNotMatch(rendered, /<iframe\b/i);
    assert.ok(rendered.includes(`aria-label="${product.name} preview image unavailable" hidden`));
  }
});

test('marketplace image assets contain nonempty JPEG images', async () => {
  for (const product of products) {
    const image = await readFile(new URL(`../${product.thumbnail}`, import.meta.url));
    assert.ok(image.length > 1024, `${product.name} has image data`);
    assert.equal(image[0], 0xff, product.thumbnail);
    assert.equal(image[1], 0xd8, product.thumbnail);
    assert.equal(image[2], 0xff, product.thumbnail);
  }
});

test('the beauty photograph is labelled as a concept and keeps request-only links', () => {
  const beauty = products.find(product => product.id === 'velora-beauty');
  const rendered = card(beauty);
  assert.equal(beauty.preview, null);
  assert.equal(beauty.thumbnailKind, 'concept');
  assert.equal(beauty.thumbnailAlt, 'Beauty products concept photograph');
  assert.match(rendered, /class="site-preview-caption">Concept image<\/span>/);
  assert.match(rendered, /Preview by request/);
  assert.doesNotMatch(rendered, /Live preview|Netlify live|website screenshot/i);
  for (const match of rendered.matchAll(/href="([^"]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), 'https://blvckoak.com.au/');
    assert.equal(url.pathname, '/contact.html');
    assert.equal(url.searchParams.get('service'), 'website-packages');
    assert.ok(url.searchParams.get('brief').includes(beauty.name));
  }
});

test('directory cards reuse thumbnails while retaining demo labels and controls', () => {
  for (const business of directory) {
    const rendered = businessCard(business);
    assert.ok(rendered.includes(`src="${business.thumbnail}"`));
    assert.match(rendered, /DEMO DIRECTORY/);
    assert.match(rendered, /data-fav=/);
    assert.match(rendered, /List business/);
    assert.doesNotMatch(rendered, /<iframe\b|data-cart-add=/i);
  }
});

test('failed images are hidden in favour of the accessible monogram fallback', () => {
  const callbacks = new Map();
  const pending = { hidden: false, complete: false, naturalWidth: 0, nextElementSibling: { hidden: true }, addEventListener: (event, handler) => callbacks.set(event, handler) };
  const cachedFailure = { hidden: false, complete: true, naturalWidth: 0, nextElementSibling: { hidden: true }, addEventListener() {} };
  const loaded = { hidden: false, complete: true, naturalWidth: 1234, nextElementSibling: { hidden: true }, addEventListener() {} };
  bindPreviewImages({ querySelectorAll: () => [pending, cachedFailure, loaded] });
  assert.equal(pending.hidden, false);
  callbacks.get('error')();
  assert.equal(pending.hidden, true);
  assert.equal(pending.nextElementSibling.hidden, false);
  assert.equal(cachedFailure.hidden, true);
  assert.equal(cachedFailure.nextElementSibling.hidden, false);
  assert.equal(loaded.hidden, false);
  assert.equal(loaded.nextElementSibling.hidden, true);
  assert.match(css, /\.site-preview-fallback\[hidden\],\.site-preview-image\[hidden\]\{display:none\}/);
  assert.match(css, /\.site-preview-image\{[^}]*object-position:top/);
  assert.ok(source.includes('bindPreviewImages(grid)'));
});
