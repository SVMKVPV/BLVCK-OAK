import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

for (const [file, url] of [
  ['qr-menu-ordering.html', 'https://tablepulse-blackoak.netlify.app/'],
  ['aurora-cafe.html', 'https://aurora-cafe-blackoak.netlify.app/'],
]) {
  test(`${file} embeds its dedicated deployment without access bypass`, async () => {
    const html = await readFile(new URL(`../previews/${file}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`src="${url}"`));
    assert.match(html, /<iframe title="[^"]+"/);
    assert.match(html, /<head>/i);
    assert.doesNotMatch(html, /(?:src|href)="preview\.(?:js|css)"|location\.(replace|assign)|localStorage/);
  });
}

test('build continues to install the existing access gate on preview wrappers', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /installAccessGate\(output\)/);
  assert.match(build, /site-access\.js/);
});
