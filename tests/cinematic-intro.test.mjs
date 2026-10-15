import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('homepage opens on the offer with a decorative cinematic oak inside the hero', async () => {
  const [html, css, client, build, packageJson, cinematicVideo, desktopPoster, mobilePoster] = await Promise.all([
    read('index.html'),
    read('style.css'),
    read('cinematic-intro.js'),
    read('scripts/build.mjs'),
    read('package.json'),
    readFile(new URL('../assets/oak-firefall-hero-v1.mp4', import.meta.url)),
    readFile(new URL('../assets/oak-firefall-hero-v1-poster.webp', import.meta.url)),
    readFile(new URL('../assets/oak-firefall-hero-mobile-v1-poster.webp', import.meta.url)),
  ]);

  assert.match(html, /<main>/);
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<section class="hero" id="top"/);
  assert.match(html, /data-cinematic-oak/);
  assert.match(html, /data-cinematic-particles/);
  assert.match(html, /data-cinematic-fallback/);
  assert.match(html, /data-cinematic-video/);
  assert.match(html, /data-cinematic-poster/);
  assert.match(html, /assets\/oak-firefall-hero-v1-poster\.webp/);
  assert.match(html, /assets\/oak-firefall-hero-mobile-v1-poster\.webp/);
  assert.match(html, /data-cinematic-src="assets\/oak-firefall-hero-v1\.mp4"/);
  assert.match(html, /data-cinematic-video[^>]*preload="none"/);
  assert.doesNotMatch(html, /data-cinematic-video[^>]*autoplay/);
  assert.ok(html.indexOf('<main>') < html.indexOf('data-cinematic-oak'));
  assert.ok(html.indexOf('<header class="site-header">') < html.indexOf('<section class="hero" id="top"'));

  assert.match(html, /href="quote\.html">Build your estimate/);
  assert.match(html, /href="audit\.html">Get a free website score/);
  assert.doesNotMatch(html, /data-oak-origin|data-oak-skip|data-oak-chapter/);
  assert.doesNotMatch(html, /Scroll to enter|Scroll to transform|scroll-controlled three-dimensional/);

  assert.match(css, /\.cinematic-oak\s*\{/);
  assert.match(css, /\.cinematic-oak-poster\s*\{/);
  assert.match(css, /\.hero\s*\{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100svh;/);
  assert.match(css, /\.button-ghost\s*\{/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /height:\s*580vh/);
  assert.doesNotMatch(css, /position:\s*sticky/);

  assert.match(client, /prefers-reduced-motion:\s*reduce/);
  assert.match(client, /new IntersectionObserver/);
  assert.match(client, /requestAnimationFrame/);
  assert.match(client, /data-cinematic-src/);
  assert.match(client, /navigator\.connection\?\.saveData/);
  assert.match(client, /min-width: 901px/);
  assert.match(client, /video\.play\(\)/);
  assert.match(client, /video\?\.pause\(\)/);
  assert.match(client, /if \(visible\) startAnimation\(\);\s*else stopAnimation\(\);/);
  assert.match(client, /visibilitychange/);
  assert.doesNotMatch(client, /window\.addEventListener\(['"]scroll/);
  assert.doesNotMatch(client, /window\.scrollTo|video\.currentTime/);

  assert.match(build, /cinematic-intro\.js/);
  assert.match(build, /three\.module\.min\.js/);
  assert.match(packageJson, /"three":\s*"0\.160\.0"/);
  assert.ok(cinematicVideo.byteLength > 4_000_000);
  assert.ok(desktopPoster.byteLength > 250_000);
  assert.ok(mobilePoster.byteLength > 150_000);
});
