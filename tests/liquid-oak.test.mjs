import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('liquid oak stays decorative, scroll-linked and motion-safe', async () => {
  const [html, client, cinematic, css, build, packageJson] = await Promise.all([
    read('index.html'),
    read('liquid-oak.js'),
    read('cinematic-intro.js'),
    read('studio-intro.css'),
    read('scripts/build.mjs'),
    read('package.json'),
  ]);

  assert.match(html, /<canvas[^>]*class="oak-origin-liquid"[^>]*data-oak-liquid[^>]*aria-hidden="true"/);
  assert.match(html, /<script[^>]*src="liquid-oak\.js\?v=\d+"[^>]*defer/);
  assert.match(client, /getContext\('2d'/);
  assert.match(client, /samplePoster/);
  assert.match(client, /prefers-reduced-motion/);
  assert.match(client, /blvckoak:origin-progress/);
  assert.match(client, /blvckoak:motion-change/);
  assert.match(client, /document\.body\.dataset\.motionPaused/);
  assert.match(client, /IntersectionObserver/);
  assert.match(client, /ResizeObserver/);
  assert.match(client, /document\.hidden/);
  assert.match(client, /cancelAnimationFrame/);
  assert.match(client, /pagehide/);
  assert.match(client, /width < 700 \? 760/);
  assert.match(client, /Math\.min\(window\.devicePixelRatio \|\| 1, width < 700 \? 1\.15 : 1\.5\)/);
  assert.match(cinematic, /new CustomEvent\('blvckoak:origin-progress'/);
  assert.match(css, /\.oak-origin-liquid\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.oak-origin-stage\s*\{[^}]*touch-action:\s*pan-y/);
  assert.match(css, /\.oak-origin\.is-motion-paused \.oak-origin-liquid/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(build, /'liquid-oak\.js'/);
  assert.match(packageJson, /node --check liquid-oak\.js/);
  assert.doesNotMatch(client, /cdn\.21st\.dev/);
});
