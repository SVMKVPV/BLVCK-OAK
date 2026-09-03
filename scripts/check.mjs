import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const run = (...args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};
for (const file of ['script.js', 'partners.js', 'pay.js', 'progress.js', 'portfolio.js', 'quote-builder.js']) run('--check', file);
for (const directory of ['netlify/functions', 'netlify/lib', 'scripts']) {
  for (const file of readdirSync(resolve(root, directory)).filter((name) => name.endsWith('.mjs'))) run('--check', directory + '/' + file);
}
run('scripts/preflight.mjs');
run('--test', ...readdirSync(resolve(root, 'tests')).filter((name) => name.endsWith('.test.mjs')).map((name) => 'tests/' + name));
