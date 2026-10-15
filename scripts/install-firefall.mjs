import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const stylesheet = '<link rel="stylesheet" href="/firefall.css">';
const script = '<script src="/firefall.js" defer></script>';
const stylesheetPattern = /<link\b[^>]*href=["']\/firefall\.css(?:\?[^"']*)?["'][^>]*>\s*/gi;
const scriptPattern = /<script\b[^>]*src=["']\/firefall\.js(?:\?[^"']*)?["'][^>]*>[\s\S]*?<\/script>\s*/gi;
const count = (html, pattern) => (html.match(pattern) || []).length;

export async function installFirefall(directory) {
  let htmlCount = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      htmlCount += await installFirefall(path);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    htmlCount += 1;

    const html = await readFile(path, 'utf8');
    if (!/<\/head>/i.test(html)) throw new Error(`Cannot install firefall without </head>: ${path}`);

    const clean = html.replace(stylesheetPattern, '').replace(scriptPattern, '');
    const updated = clean.replace(/<\/head>/i, `${stylesheet}\n${script}\n</head>`);
    if (count(updated, stylesheetPattern) !== 1 || count(updated, scriptPattern) !== 1 || !updated.includes(script)) {
      throw new Error(`Firefall installation is not canonical: ${path}`);
    }
    if (updated !== html) await writeFile(path, updated);
  }
  return htmlCount;
}
