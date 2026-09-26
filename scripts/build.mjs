import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareRelease } from './prepare-release.mjs';
import { markUnavailableLinks } from './unavailable-links.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of [
  'index.html','referrals.html','contact.html','privacy.html','terms.html','refunds.html',
  'portfolio.html','marketplace.html','marketplace.css','marketplace.js','quote.html','style.css','og.png','script.js',
  'partners.html','partners.js','portal.css','pay.html','pay.js','progress.html','progress.js',
  'portfolio.js','quote-builder.js','audit.html','book.html','ai-generator.html','sales-config.js','sales.js'
]) {
  await cp(resolve(root, file), resolve(output, file));
}

await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'previews'), resolve(output, 'previews'), { recursive: true });
await prepareRelease(output);
await markUnavailableLinks(output);

console.log('Black Oak public client built successfully. New shops and community remain Coming soon; private prototypes are excluded.');
