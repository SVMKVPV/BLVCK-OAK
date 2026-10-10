import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const invitationUrl = 'https://the-20-december-wedding.samkapa3.chatgpt.site/';

test('the wedding invitation opens its live public website from portfolio and marketplace', async () => {
  const [portfolio, marketplace] = await Promise.all([
    readFile(new URL('../portfolio.html', import.meta.url), 'utf8'),
    readFile(new URL('../marketplace.js', import.meta.url), 'utf8'),
  ]);

  assert.match(portfolio, new RegExp(`href="${invitationUrl}"[^>]+target="_blank"[^>]+rel="noopener noreferrer"`));
  assert.match(marketplace, new RegExp(`preview:'${invitationUrl.replaceAll('/', '\\/')}'`));
});
