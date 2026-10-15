import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('homepage connects the scroll-led BLVCK OAK origin sequence', async () => {
  const [html, css, client, build, packageJson, cinematicVideo] = await Promise.all([
    read('index.html'),
    read('style.css'),
    read('cinematic-intro.js'),
    read('scripts/build.mjs'),
    read('package.json'),
    readFile(new URL('../assets/obsidian-oak-scroll-ccw.mp4', import.meta.url)),
  ]);

  assert.match(html, /data-oak-origin/);
  assert.match(html, /data-oak-canvas/);
  assert.match(html, /data-oak-video/);
  assert.match(html, /data-orientation="portrait-ccw"/);
  assert.match(html, /assets\/obsidian-oak-scroll-ccw\.mp4/);
  assert.doesNotMatch(html, /data-oak-video[^>]*autoplay/);
  assert.match(html, /data-oak-chapter="4"/);
  assert.match(html, /data-oak-skip/);
  assert.ok(html.indexOf('data-oak-origin') < html.indexOf('<main>'));
  assert.match(css, /\.oak-origin-stage\s*\{/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /\.oak-origin-video\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(client, /THREE\.REVISION !== '160'/);
  assert.match(client, /VIDEO_END_SECONDS = 9\.4/);
  assert.match(client, /video\.currentTime = target/);
  assert.match(client, /startProceduralFallback/);
  assert.match(client, /new THREE\.WebGLRenderer/);
  assert.match(client, /new THREE\.MeshPhysicalMaterial/);
  assert.match(client, /new THREE\.InstancedMesh/);
  assert.match(client, /new THREE\.LOD/);
  assert.match(client, /new THREE\.FogExp2/);
  assert.match(client, /emissive:\s*0xffa500/);
  assert.match(client, /REEL_BEAT_SECONDS = 3/);
  assert.match(client, /HEADER_LOOP_SECONDS = 72/);
  assert.match(client, /updateExplosion/);
  assert.match(client, /setTreeGrowth/);
  assert.match(client, /enterOfficialSite/);
  assert.match(build, /cinematic-intro\.js/);
  assert.match(build, /three\.module\.min\.js/);
  assert.match(packageJson, /"three":\s*"0\.160\.0"/);
  assert.ok(cinematicVideo.byteLength > 1_000_000);
});
