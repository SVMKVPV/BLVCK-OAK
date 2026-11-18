import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyTurnstile } from '../netlify/lib/turnstile.mjs';
import { finalizeAssets, installTurnstile } from '../scripts/finalize-assets.mjs';

test('spam check is skipped until a Turnstile secret is configured', async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal(await verifyTurnstile({}, {}), null);
});

test('spam check rejects missing or failed tokens and accepts verified ones', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'secret';
  try {
    assert.equal((await verifyTurnstile({}, {})).status, 400);
    const failing = async () => ({ json: async () => ({ success: false }) });
    assert.equal((await verifyTurnstile({ turnstileToken: 't' }, {}, { fetchImpl: failing })).status, 400);
    let sent;
    const passing = async (url, init) => { sent = init.body; return { json: async () => ({ success: true }) }; };
    assert.equal(await verifyTurnstile({ 'cf-turnstile-response': 'tok' }, { ip: '203.0.113.9' }, { fetchImpl: passing }), null);
    assert.equal(sent.get('response'), 'tok');
    assert.equal(sent.get('remoteip'), '203.0.113.9');
    const broken = async () => { throw new Error('offline'); };
    assert.equal((await verifyTurnstile({ turnstileToken: 't' }, {}, { fetchImpl: broken })).status, 503);
  } finally { delete process.env.TURNSTILE_SECRET_KEY; }
});

test('public forms carry a Turnstile placeholder', async () => {
  for (const file of ['contact.html', 'book.html', 'audit.html', 'automation.html']) {
    assert.match(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /<div data-turnstile><\/div>/, file);
  }
});

test('Turnstile widget is injected only when a site key is supplied', () => {
  const html = '<html><head></head><body><form><div data-turnstile></div></form></body></html>';
  assert.doesNotMatch(installTurnstile(html, ''), /turnstile/);
  const live = installTurnstile(html, '0x4AAA-key');
  assert.match(live, /class="cf-turnstile" data-sitekey="0x4AAA-key"/);
  assert.match(live, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
});

test('built pages reference local scripts and styles by content hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bo-assets-'));
  await mkdir(join(dir, 'community/demo'), { recursive: true });
  await writeFile(join(dir, 'app.js'), 'console.log(1)');
  await writeFile(join(dir, 'site.css'), 'body{}');
  await writeFile(join(dir, 'index.html'), '<link href="site.css?v=12"><script src="app.js?v=3"></script><script src="https://example.com/x.js"></script>');
  await writeFile(join(dir, 'community/demo/index.html'), '<script src="/app.js"></script>');
  await finalizeAssets(dir);
  const index = await readFile(join(dir, 'index.html'), 'utf8');
  assert.match(index, /href="site\.css\?v=[0-9a-f]{10}"/);
  assert.match(index, /src="app\.js\?v=[0-9a-f]{10}"/);
  assert.match(index, /src="https:\/\/example\.com\/x\.js"/);
  assert.match(await readFile(join(dir, 'community/demo/index.html'), 'utf8'), /src="\/app\.js\?v=[0-9a-f]{10}"/);
});
