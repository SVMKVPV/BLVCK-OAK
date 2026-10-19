import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../studio.css', import.meta.url), 'utf8');

test('every homepage Build an estimate link uses the BLVCK OAK border trace', () => {
  const links = [...home.matchAll(/<a\b[^>]*href="quote\.html"[^>]*>[\s\S]*?<\/a>/g)]
    .map((match) => match[0])
    .filter((link) => /Build an estimate/.test(link));

  assert.equal(links.length, 5);
  for (const link of links) {
    assert.match(link, /class="[^"]*\bcta-trace\b/);
    assert.match(link, /<span class="cta-trace__label">Build an estimate<\/span>/);
  }
  assert.match(styles, /\.cta-trace::before[\s\S]*animation:\s*cta-border-trace/);
  assert.match(styles, /@keyframes cta-border-trace/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none\s*!important/);
});
