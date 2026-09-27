import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('homepage connects the scroll-led BLVCK OAK origin sequence', async () => {
  const [html, css, client, build] = await Promise.all([
    read('index.html'),
    read('style.css'),
    read('cinematic-intro.js'),
    read('scripts/build.mjs'),
  ]);

  assert.match(html, /data-oak-origin/);
  assert.match(html, /data-oak-canvas/);
  assert.match(html, /data-oak-chapter="4"/);
  assert.match(html, /data-oak-skip/);
  assert.ok(html.indexOf('data-oak-origin') < html.indexOf('<main>'));
  assert.match(css, /\.oak-origin-stage\s*\{/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(client, /buildTree\(1313/);
  assert.match(client, /drawNaturalLeaf/);
  assert.doesNotMatch(client, /drawWebsiteLeaf|websiteNames|leaf\.website/);
  assert.match(client, /drawFlame/);
  assert.match(client, /drawGroundAsh/);
  assert.match(client, /enterOfficialSite/);
  assert.match(build, /cinematic-intro\.js/);
});
