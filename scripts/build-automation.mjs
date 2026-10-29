import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { categories, services } from '../automation-catalog.js';
import { serviceCard, goalOptions, escape } from '../automation-render.js';
export async function buildAutomation(directory) {
 const path=resolve(directory,'automation.html');
 const html=(await readFile(path,'utf8'))
  .replace('<!-- goal-options -->',goalOptions())
  .replace('<!-- category-options -->',categories.map(c=>`<option value="${c.id}">${escape(c.name)}</option>`).join(''))
  .replace('<!-- service-cards -->',services.map(service=>serviceCard(service)).join('\n'));
 await writeFile(path,html);
}
