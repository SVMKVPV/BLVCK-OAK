import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const stylesheet = '<link rel="stylesheet" href="/firefall.css">';
const script = '<script src="/firefall.js" defer></script>';
const hasStylesheet = (html) => /<link\b[^>]*href=["']\/firefall\.css(?:\?[^"']*)?["'][^>]*>/i.test(html);
const hasScript = (html) => /<script\b[^>]*src=["']\/firefall\.js(?:\?[^"']*)?["'][^>]*><\/script>/i.test(html);

export async function installFirefall(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await installFirefall(path);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    const html = await readFile(path, 'utf8');
    if (!/<\/head>/i.test(html)) throw new Error(`Cannot install firefall without </head>: ${path}`);

    let updated = html;
    const additions = [];
    if (!hasStylesheet(updated)) additions.push(stylesheet);
    if (!hasScript(updated)) additions.push(script);
    if (!additions.length) continue;

    updated = updated.replace(/<\/head>/i, `${additions.join('\n')}\n</head>`);
    await writeFile(path, updated);
  }
}
