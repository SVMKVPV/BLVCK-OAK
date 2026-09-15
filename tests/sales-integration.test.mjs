import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public sales entry points and server routes are connected', async () => {
  const [home, audit, booking, config, build] = await Promise.all([
    read('index.html'), read('audit.html'), read('book.html'), read('netlify.toml'), read('scripts/build.mjs'),
  ]);
  assert.match(home, /href="audit\.html"/);
  assert.match(home, /href="book\.html"/);
  assert.match(audit, /data-audit-form/);
  assert.match(booking, /data-booking-form/);
  assert.match(config, /from = "\/api\/website-audit"/);
  assert.match(config, /from = "\/api\/book"/);
  assert.match(build, /'audit\.html','book\.html','sales-config\.js','sales\.js'/);
});

test('lead pipeline stays inside the authenticated owner workspace', async () => {
  const [workspace, client, server] = await Promise.all([
    read('partners.html'), read('partners.js'), read('netlify/functions/partner-api.mjs'),
  ]);
  assert.match(workspace, /data-owner-sales hidden/);
  assert.match(client, /dashboard\.isOwner/);
  assert.match(server, /if \(!auth\.isOwner\) throw new PortalError\('Only the Black Oak owner can manage sales leads\.'/);
});

test('the privacy policy describes audit and follow-up processing', async () => {
  const policy = await read('privacy.html');
  assert.match(policy, /free website audit reads publicly available page code/);
  assert.match(policy, /one service-related follow-up/);
});
