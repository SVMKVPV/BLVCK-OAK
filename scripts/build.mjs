import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await cp(resolve(root, 'index.html'), resolve(output, 'index.html'));
await cp(resolve(root, 'referrals.html'), resolve(output, 'referrals.html'));
await cp(resolve(root, 'contact.html'), resolve(output, 'contact.html'));
await cp(resolve(root, 'privacy.html'), resolve(output, 'privacy.html'));
await cp(resolve(root, 'terms.html'), resolve(output, 'terms.html'));
await cp(resolve(root, 'refunds.html'), resolve(output, 'refunds.html'));
await cp(resolve(root, 'portfolio.html'), resolve(output, 'portfolio.html'));
await cp(resolve(root, 'quote.html'), resolve(output, 'quote.html'));
await cp(resolve(root, 'style.css'), resolve(output, 'style.css'));
await cp(resolve(root, 'og.png'), resolve(output, 'og.png'));
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'script.js'), resolve(output, 'script.js'));
for (const file of ['partners.html', 'partners.js', 'portal.css', 'pay.html', 'pay.js', 'progress.html', 'progress.js', 'portfolio.js', 'quote-builder.js']) {
  await cp(resolve(root, file), resolve(output, file));
}

console.log('Black Oak launch-hardened client built successfully.');
