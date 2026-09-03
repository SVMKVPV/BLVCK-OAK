import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pages = ['index.html', 'contact.html', 'referrals.html', 'refunds.html', 'privacy.html', 'terms.html', 'partners.html', 'pay.html', 'progress.html', 'portfolio.html', 'quote.html'];

test('public, partner and payment pages display the supplied ACN and ABN', async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /ACN 701 878 775/, `${page} must show the ACN`);
    assert.match(html, /ABN 57 799 643 567/, `${page} must show the ABN`);
  }
});
