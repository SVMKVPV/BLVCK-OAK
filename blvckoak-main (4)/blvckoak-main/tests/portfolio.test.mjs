import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createQuote } from '../netlify/lib/quotes.mjs';
import { applyProjectProgress } from '../netlify/lib/project-progress.mjs';
import { applyPortfolio, publicPortfolioItem, readPortfolio } from '../netlify/lib/portfolio.mjs';

const owner = { id: 'owner-1', name: 'Black Oak Owner', email: 'owner@example.test' };
const input = { service: 'Neighbourhood bakery website', description: 'A responsive five-page website with online enquiries and local search foundations.', customerName: 'Private Client', customerEmail: 'private@example.test', total: '3200', deposit: '800' };
const completedQuote = () => applyProjectProgress(createQuote(input, owner, 'BO-AB12CD34EF', true), {
  progressRevision: 0,
  stage: 'completed',
  percentage: 100,
  summary: 'The new website has launched.',
  completedItems: ['Responsive website', 'Enquiry form'],
  nextSteps: [],
}, owner.id, '2026-09-02T09:00:00.000Z');

const listing = {
  portfolioRevision: 0,
  published: true,
  title: 'Local bakery digital launch',
  category: 'Website design',
  summary: 'A warm, fast and mobile-first website designed to turn local searches into customer enquiries.',
  websiteUrl: 'https://bakery.example/work#private-fragment',
};

test('only completed projects can be added to the public portfolio', () => {
  const unfinished = createQuote(input, owner, 'BO-AB12CD34EF', true);
  assert.throws(() => applyPortfolio(unfinished, listing, owner.id), /100% complete/);
});

test('portfolio listings are validated, revisioned and can be unpublished', () => {
  const published = applyPortfolio(completedQuote(), listing, owner.id, '2026-09-02T10:00:00.000Z', () => '1234567890abcdef1234');
  assert.equal(published.portfolio.revision, 1);
  assert.equal(published.portfolio.published, true);
  assert.equal(published.portfolio.websiteUrl, 'https://bakery.example/work');
  assert.throws(() => applyPortfolio(published, { ...listing, portfolioRevision: 0 }, owner.id), /changed/);
  assert.throws(() => applyPortfolio(completedQuote(), { ...listing, websiteUrl: 'http://example.com' }, owner.id), /https/);
  const hidden = applyPortfolio(published, { ...listing, portfolioRevision: 1, published: false }, owner.id, '2026-09-02T11:00:00.000Z');
  assert.equal(readPortfolio(hidden).published, false);
  assert.equal(publicPortfolioItem(hidden), null);
});

test('public portfolio output excludes client, quote, payment and internal data', () => {
  const quote = applyPortfolio(completedQuote(), listing, owner.id, '2026-09-02T10:00:00.000Z', () => '1234567890abcdef1234');
  const item = publicPortfolioItem(quote);
  assert.deepEqual(Object.keys(item), ['id', 'title', 'category', 'summary', 'websiteUrl', 'completedAt', 'publishedAt']);
  const serialized = JSON.stringify(item);
  for (const privateValue of [quote.id, quote.publicToken, quote.customerName, quote.customerEmail, quote.partnerEmail, quote.totalCents, owner.id]) {
    assert.equal(serialized.includes(String(privateValue)), false);
  }
});

test('public page loads published work and the owner workspace exposes deliberate publishing controls', async () => {
  const [page, client, workspace] = await Promise.all([
    readFile(new URL('../portfolio.html', import.meta.url), 'utf8'),
    readFile(new URL('../portfolio.js', import.meta.url), 'utf8'),
    readFile(new URL('../partners.html', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /data-portfolio-grid/);
  assert.match(client, /fetch\('\/api\/portfolio'/);
  assert.match(workspace, /data-portfolio-editor/);
  assert.match(workspace, /I confirm Black Oak may publicly show this work/);
});
