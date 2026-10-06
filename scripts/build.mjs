import { cp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareRelease } from './prepare-release.mjs';
import { markUnavailableLinks } from './unavailable-links.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of [
  'site-access.js','site-access.css','index.html','referrals.html','contact.html','privacy.html','terms.html','refunds.html',
  'portfolio.html','marketplace.html','marketplace.css','marketplace.js','quote.html','style.css','og.png','cinematic-intro.js','script.js',
  'partners.html','partners.js','portal.css','pay.html','pay.js','progress.html','progress.js',
  'portfolio.js','quote-builder.js','audit.html','book.html','ai-generator.html','ai-generator.css','ai-generator.js','sales-config.js','sales.js',
  'oakpay.html','oakpay-app.html','oakpay.css','oakpay-app.js',
  'robots.txt','sitemap.xml','favicon.ico','favicon.svg','apple-touch-icon.png','android-chrome-192x192.png','android-chrome-512x512.png','site.webmanifest'
]) {
  await cp(resolve(root, file), resolve(output, file));
}

await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'previews'), resolve(output, 'previews'), { recursive: true });
await mkdir(resolve(output, 'vendor'), { recursive: true });
await cp(
  resolve(root, 'node_modules/three/build/three.module.min.js'),
  resolve(output, 'vendor/three.module.min.js'),
);
await prepareRelease(output);
await markUnavailableLinks(output);

// Run before feature scripts on every published page, including generated pages.
async function installAccessGate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await installAccessGate(path);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(path, 'utf8');
      await writeFile(path, html.replace(/<head([^>]*)>/i, '<head$1><link rel="stylesheet" href="/site-access.css"><script src="/site-access.js"></script>'));
    }
  }
}
await installAccessGate(output);

console.log('Black Oak public client built successfully. Marketplace is live; community and nearby discovery remain Coming soon.');
