import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('retained cinematic assets preserve the oak renderer, video timing and procedural fallback', async () => {
  const [css, client, build, packageJson, cinematicVideo] = await Promise.all([
    read('studio-intro.css'),
    read('cinematic-intro.js'),
    read('scripts/build.mjs'),
    read('package.json'),
    readFile(new URL('../assets/obsidian-oak-scroll-ccw.mp4', import.meta.url)),
  ]);

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
