import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { installFutureUi } from '../scripts/install-future-ui.mjs';

test('shared theme installs once on studio pages while preserving forms and independent customer sites', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blvck-oak-future-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const form = '<form data-quote-form><label>Amount<input name="total" type="number" min="100" step="0.01"></label><select name="paymentPlan"><option value="instalments_15">15 parts</option></select><button type="submit">Create quote</button></form>';
  const scripts = '<script src="partners.js?v=3" defer></script><script type="module" src="quote-builder.js?v=3"></script>';
  const html = `<!doctype html><html lang="en"><head><meta name="theme-color" content="#123456">${scripts}</head><body class="workspace" data-page="quote"><main>${form}</main></body></html>`;
  const existing = html.replace('</head>', '<link rel="stylesheet" href="future-ui.css?v=7"><script src="future-ui.js?v=7" defer></script></head>').replace('data-page="quote"', 'data-page="quote" data-future-ui');
  const fixtures = new Map([
    ['index.html', existing],
    ['quote.html', html],
    ['pay.html', html],
    ['partners.html', html],
    ['client-preview.html', html],
    ['previews/index.html', html],
    ['previews/quote.html', html],
    ['community/sample-cafe/index.html', html],
  ]);
  await Promise.all([...fixtures].map(async ([name, content]) => {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), content);
  }));

  await installFutureUi(directory);
  const first = new Map(await Promise.all([...fixtures.keys()].map(async name => [name, await readFile(join(directory, name), 'utf8')])));
  for (const name of ['index.html', 'quote.html', 'pay.html', 'partners.html']) {
    const output = first.get(name);
    assert.equal((output.match(/\bdata-future-ui(?=[\s>])/g) || []).length, 1, `${name} opts in once`);
    assert.equal((output.match(/future-ui\.css/g) || []).length, 1, `${name} loads one stylesheet`);
    assert.equal((output.match(/future-ui\.js/g) || []).length, 1, `${name} loads one interaction layer`);
    assert.ok(output.includes(form), `${name} preserves every form field and submit hook`);
    assert.ok(output.includes(scripts), `${name} preserves feature script tags and ordering`);
    assert.match(output, /class="workspace" data-page="quote"/);
    assert.match(output, /name="theme-color" content="#080909"/);
  }
  assert.ok(first.get('index.html').includes('future-ui.js?v=7'), 'an existing asset version is retained');
  for (const name of ['client-preview.html', 'previews/index.html', 'previews/quote.html', 'community/sample-cafe/index.html']) {
    assert.equal(first.get(name), fixtures.get(name), `${name} stays independent even when a nested basename matches a studio page`);
  }

  await installFutureUi(directory);
  for (const [name, expected] of first) {
    assert.equal(await readFile(join(directory, name), 'utf8'), expected, `${name} is byte-identical after a second install`);
  }
});
