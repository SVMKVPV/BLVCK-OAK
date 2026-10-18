import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile(new URL('../portfolio-repositories.json', import.meta.url), 'utf8'));
const portfolio = await readFile(new URL('../portfolio.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const releaseSmoke = await readFile(new URL('../scripts/release-smoke.mjs', import.meta.url), 'utf8');
const preview = 'https://aurelis-spatial-studio.samkapa3.chatgpt.site/';

test('AURELIS is catalogued as a protected external concept', () => {
  const entry = registry.sites.find(site => site.id === 'aurelis-spatial-studio');

  assert.ok(entry, 'AURELIS has a repository registry entry');
  assert.equal(entry.name, 'AURELIS — Spatial Design Studio');
  assert.equal(entry.currentPreview, preview);
  assert.equal(entry.previewStatus, 'protected');
  assert.equal(entry.targetRepo, 'SVMKVPV/blvckoak-portfolio-aurelis-spatial-studio');
  assert.equal(entry.repoStatus, 'needs_creation');
  assert.equal(registry.sites.filter(site => site.id === entry.id).length, 1);
});

test('AURELIS appears once in the interactive concepts gallery with honest access copy', () => {
  const gallery = portfolio.match(/<section class="concept-gallery"[\s\S]*?<\/section>/)?.[0];
  assert.ok(gallery, 'Interactive concept gallery is available');

  const cards = [...gallery.matchAll(/<a\b[^>]*class="concept-card\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  const card = cards.find(item => item.includes(`href="${preview}"`));

  assert.ok(card, 'AURELIS links to its published Site');
  assert.match(card, /<h3>AURELIS<\/h3>/);
  assert.match(card, /protected preview/i);
  const photo = card.match(/<img\b[^>]*class="concept-photo-cover"[^>]*>/)?.[0];
  assert.ok(photo, 'AURELIS has a local photo thumbnail');
  assert.match(photo, /src="assets\/portfolio\/aurelis\.webp"/);
  assert.match(photo, /srcset="assets\/portfolio\/aurelis-small\.webp 600w, assets\/portfolio\/aurelis\.webp 1200w"/);
  assert.match(photo, /alt="[^"]+"/);
  assert.match(photo, /width="1200" height="750"/);
  assert.doesNotMatch(card, /<iframe\b|concept-aurelis-art/);
  assert.equal(cards.filter(item => item.includes(`href="${preview}"`)).length, 1);
  assert.match(styles, /\.portfolio-page \.concept-browser-shot > \.concept-photo-cover\s*\{[^}]*object-fit:\s*cover/);
});

test('release verification recognizes declared protected previews', () => {
  assert.match(releaseSmoke, /site\.previewStatus === 'protected'/);
  assert.match(releaseSmoke, /protectedPreviews\.has\(key\)/);
  assert.match(releaseSmoke, /\[401,403\][\s\S]*!protectedPreview/);
});
