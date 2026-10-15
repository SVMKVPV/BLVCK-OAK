import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installFirefall } from '../scripts/install-firefall.mjs';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('scroll firefall is decorative, bounded and motion-aware', async () => {
  const [client, stylesheet, build, checkScript, releaseSmoke] = await Promise.all([
    read('firefall.js'),
    read('firefall.css'),
    read('scripts/build.mjs'),
    read('scripts/check.mjs'),
    read('scripts/release-smoke.mjs'),
  ]);

  assert.match(stylesheet, /position:\s*fixed/);
  assert.match(stylesheet, /pointer-events:\s*none/);
  assert.match(stylesheet, /z-index:\s*8/);
  assert.match(stylesheet, /site-firefall--subdued/);
  assert.match(stylesheet, /site-firefall\.is-suppressed/);
  assert.match(stylesheet, /prefers-reduced-motion:\s*reduce/);
  assert.match(stylesheet, /forced-colors:\s*active/);

  assert.match(client, /navigator\.connection/);
  assert.match(client, /connection\?\.saveData/);
  assert.match(client, /prefers-reduced-motion:\s*reduce/);
  assert.match(client, /window\.self\s*!==\s*window\.top/);
  assert.match(client, /particleLimit\s*=\s*width\s*<\s*700\s*\?\s*12\s*:\s*24/);
  assert.match(client, /pixelRatio\s*=\s*Math\.min\([^;]+width\s*<\s*700\s*\?\s*1\s*:\s*1\.35\)/);
  assert.match(client, /canvas\.setAttribute\('aria-hidden',\s*'true'\)/);
  assert.match(client, /canvas\.setAttribute\('role',\s*'presentation'\)/);
  assert.match(client, /x:\s*random\(/);
  assert.match(client, /vy:\s*random\(95,\s*158\)\s*\+/);
  assert.match(client, /addEventListener\('scroll',\s*onScroll,\s*\{\s*passive:\s*true\s*\}\)/);
  assert.match(client, /data-cinematic-oak/);
  assert.match(client, /intersectionRatio\s*>=\s*\.55/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /addEventListener\('pagehide',\s*destroy/);
  assert.match(client, /requestAnimationFrame/);
  assert.doesNotMatch(client, /preventDefault|scrollTo|scrollIntoView/);

  assert.match(build, /'firefall\.js','firefall\.css'/);
  assert.match(build, /installFirefall\(output\)/);
  assert.match(checkScript, /'firefall\.js'/);
  assert.match(releaseSmoke, /'\/firefall\.js'/);
  assert.match(releaseSmoke, /'\/firefall\.css'/);
  assert.match(releaseSmoke, /firefallConnected/);
});

test('build helper installs firefall once in every nested HTML document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'firefall-'));
  try {
    const nested = join(directory, 'community', 'profile');
    await mkdir(nested, { recursive: true });
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><head></head><body>Home</body></html>');
    await writeFile(join(nested, 'index.html'), '<!doctype html><html><head></head><body>Profile</body></html>');
    await writeFile(join(directory, 'partial.html'), '<!doctype html><html><head><script src="/firefall.js" defer></script></head><body>Partial</body></html>');
    await writeFile(join(directory, 'notes.txt'), '</head>');

    await installFirefall(directory);
    await installFirefall(directory);

    for (const path of [join(directory, 'index.html'), join(nested, 'index.html')]) {
      const html = await readFile(path, 'utf8');
      assert.equal((html.match(/\/firefall\.css/g) || []).length, 1);
      assert.equal((html.match(/\/firefall\.js/g) || []).length, 1);
      assert.ok(html.indexOf('/firefall.css') < html.indexOf('</head>'));
    }
    const partial = await readFile(join(directory, 'partial.html'), 'utf8');
    assert.equal((partial.match(/\/firefall\.css/g) || []).length, 1);
    assert.equal((partial.match(/\/firefall\.js/g) || []).length, 1);
    assert.equal(await readFile(join(directory, 'notes.txt'), 'utf8'), '</head>');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('build helper fails closed when an HTML document has no head terminator', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'firefall-invalid-'));
  try {
    await writeFile(join(directory, 'broken.html'), '<!doctype html><html><body>Broken</body></html>');
    await assert.rejects(installFirefall(directory), /Cannot install firefall without <\/head>/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
