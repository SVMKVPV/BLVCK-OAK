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
  assert.match(client, /forced-colors:\s*active/);
  assert.match(client, /window\.self\s*!==\s*window\.top/);
  assert.match(client, /particleLimit\s*=\s*width\s*<\s*700\s*\?\s*12\s*:\s*24/);
  assert.match(client, /pixelRatio\s*=\s*Math\.min\([^;]+width\s*<\s*700\s*\?\s*1\s*:\s*width\s*>\s*1900\s*\?\s*1\.1\s*:\s*1\.35\)/);
  assert.match(client, /rootPixelRatio\s*=\s*Math\.min\([^;]+width\s*<\s*700\s*\?\s*\.75/);
  assert.match(client, /canvas\.setAttribute\('aria-hidden',\s*'true'\)/);
  assert.match(client, /canvas\.setAttribute\('role',\s*'presentation'\)/);
  assert.match(client, /x:\s*random\(/);
  assert.match(client, /vy:\s*random\(95,\s*158\)\s*\+/);
  assert.match(client, /buildRootNetwork/);
  assert.match(client, /drawRoots\(growth\)/);
  assert.match(client, /rootGrowth/);
  assert.match(client, /const rootCanvas = document\.createElement\('canvas'\)/);
  assert.match(client, /rootCacheProgress/);
  assert.match(client, /Math\.round\(rootGrowth\(\) \* 160\) \/ 160/);
  assert.match(client, /1000 \/ 30\s*:\s*1000 \/ 45/);
  assert.match(client, /foreground:\s*!subdued/);
  assert.match(client, /perspectiveScale/);
  assert.match(client, /context\.transform\(/);
  assert.match(client, /globalCompositeOperation\s*=\s*'destination-out'/);
  assert.match(client, /cutContentWindows\(\);[\s\S]*leaf\.foreground/);
  assert.match(client, /new MutationObserver\(scheduleContentRefresh\)/);
  assert.match(client, /attributeFilter:\s*\['class',\s*'hidden',\s*'open',\s*'aria-hidden'\]/);
  assert.doesNotMatch(client, /contentWindows\.length\s*>=\s*84/);
  assert.match(client, /addEventListener\('scroll',\s*onScroll,\s*\{\s*passive:\s*true\s*\}\)/);
  assert.match(client, /data-cinematic-oak/);
  assert.match(client, /intersectionRatio\s*>=\s*\.55/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /function onPageHide\(event\)/);
  assert.match(client, /event\.persisted/);
  assert.match(client, /addEventListener\('pagehide',\s*onPageHide\)/);
  assert.match(client, /addEventListener\('pageshow',\s*onPageShow\)/);
  assert.match(client, /connection\?\.addEventListener\?\.\('change',\s*onConnectionChange\)/);
  assert.match(client, /requestAnimationFrame/);
  assert.doesNotMatch(client, /preventDefault|scrollTo|scrollIntoView/);

  assert.match(build, /'firefall\.js','firefall\.css'/);
  assert.match(build, /installFirefall\(output\)/);
  assert.match(checkScript, /'firefall\.js'/);
  assert.match(releaseSmoke, /'\/firefall\.js'/);
  assert.match(releaseSmoke, /'\/firefall\.css'/);
  assert.match(releaseSmoke, /firefallConnected/);
  assert.match(releaseSmoke, /firefallStyles\.length\s*===\s*1/);
  assert.match(releaseSmoke, /firefallScripts\.length\s*===\s*1/);
  assert.match(releaseSmoke, /destination-out/);
  assert.match(releaseSmoke, /rootCanvas/);
});

test('build helper installs firefall once in every nested HTML document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'firefall-'));
  try {
    const nested = join(directory, 'community', 'profile');
    await mkdir(nested, { recursive: true });
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><head></head><body>Home</body></html>');
    await writeFile(join(nested, 'index.html'), '<!doctype html><html><head></head><body>Profile</body></html>');
    await writeFile(join(directory, 'partial.html'), '<!doctype html><html><head><script src="/firefall.js" defer></script></head><body>Partial</body></html>');
    await writeFile(join(directory, 'duplicate.html'), '<!doctype html><html><head><link href="/firefall.css" rel="stylesheet"><link rel="stylesheet" href="/firefall.css"><script src="/firefall.js"></script><script defer src="/firefall.js"></script></head><body>Duplicate</body></html>');
    await writeFile(join(directory, 'notes.txt'), '</head>');

    assert.equal(await installFirefall(directory), 4);
    assert.equal(await installFirefall(directory), 4);

    for (const path of [join(directory, 'index.html'), join(nested, 'index.html'), join(directory, 'partial.html'), join(directory, 'duplicate.html')]) {
      const html = await readFile(path, 'utf8');
      assert.equal((html.match(/\/firefall\.css/g) || []).length, 1);
      assert.equal((html.match(/\/firefall\.js/g) || []).length, 1);
      assert.ok(html.indexOf('/firefall.css') < html.indexOf('</head>'));
      assert.match(html, /<script src="\/firefall\.js" defer><\/script>/);
    }
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
