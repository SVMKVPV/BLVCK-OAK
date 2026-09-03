import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of [
  'index.html','referrals.html','contact.html','privacy.html','terms.html','refunds.html',
  'portfolio.html','quote.html','style.css','og.png','script.js',
  'partners.html','partners.js','portal.css','pay.html','pay.js','progress.html','progress.js',
  'portfolio.js','quote-builder.js'
]) {
  await cp(resolve(root, file), resolve(output, file));
}

await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'previews'), resolve(output, 'previews'), { recursive: true });

console.log('Black Oak launch-hardened client built successfully, including portfolio previews.');
