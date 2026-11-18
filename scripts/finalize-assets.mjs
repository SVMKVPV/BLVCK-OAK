import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
const ASSET_REF = /\b(src|href)="((?!https?:|\/\/|data:)[^"?#]+\.(?:js|css))(?:\?v=[^"#]*)?"/g;

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export function installTurnstile(html, siteKey) {
  if (!html.includes('<div data-turnstile></div>')) return html;
  if (!siteKey) return html.replaceAll('<div data-turnstile></div>', '');
  const widget = `<div class="cf-turnstile" data-sitekey="${siteKey.replace(/[^A-Za-z0-9_-]/g, '')}" data-theme="dark"></div>`;
  return html.replaceAll('<div data-turnstile></div>', widget).replace('</head>', `${TURNSTILE_SCRIPT}</head>`);
}

// Replace hand-maintained ?v=N cache busters with content hashes of the built file.
export async function fingerprintAssets(html, file, output, hashes = new Map()) {
  let result = html;
  for (const match of html.matchAll(ASSET_REF)) {
    const [whole, attribute, path] = match;
    const target = path.startsWith('/') ? resolve(output, '.' + path) : resolve(dirname(file), path);
    if (!hashes.has(target)) {
      try { hashes.set(target, createHash('sha256').update(await readFile(target)).digest('hex').slice(0, 10)); }
      catch { hashes.set(target, null); }
    }
    const hash = hashes.get(target);
    if (hash) result = result.replace(whole, `${attribute}="${path}?v=${hash}"`);
  }
  return result;
}

export async function finalizeAssets(output, { turnstileSiteKey = '' } = {}) {
  const hashes = new Map();
  for (const file of await htmlFiles(output)) {
    const html = await readFile(file, 'utf8');
    const next = await fingerprintAssets(installTurnstile(html, turnstileSiteKey), file, output, hashes);
    if (next !== html) await writeFile(file, next);
  }
}
