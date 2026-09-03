import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuote } from '../netlify/lib/quotes.mjs';
import { applyProjectProgress, projectProgressLink, publicProjectProgress, readProjectProgress, validateProjectProgress } from '../netlify/lib/project-progress.mjs';

const account = { id: 'owner-1', name: 'Black Oak Owner', email: 'owner@example.test' };
const input = { service: 'Local business website', description: 'A five-page responsive website with enquiry form and search optimisation.', customerName: 'Demo Client', customerEmail: 'client@example.test', total: '2400', deposit: '600' };
const approvedQuote = () => createQuote(input, account, 'BO-AB12CD34EF', true);

test('legacy approved quotes receive a safe initial progress state', () => {
  const progress = readProjectProgress(approvedQuote());
  assert.equal(progress.revision, 0);
  assert.equal(progress.stage, 'planning');
  assert.equal(progress.percentage, 0);
  assert.match(progress.summary, /approved/);
});

test('progress validation enforces stages, whole percentages and bounded lists', () => {
  const valid = validateProjectProgress({ stage: 'development', percentage: '45', summary: 'The core pages are now built.', completedItems: 'Homepage\nNavigation', nextSteps: 'Contact form' });
  assert.deepEqual(valid.completedItems, ['Homepage', 'Navigation']);
  assert.equal(valid.percentage, 45);
  for (const changes of [{ stage: '__proto__' }, { stage: 'unknown' }, { percentage: 101 }, { percentage: 1.5 }, { stage: 'completed', percentage: 90 }]) {
    assert.throws(() => validateProjectProgress({ ...valid, ...changes }));
  }
  assert.throws(() => validateProjectProgress({ ...valid, completedItems: Array.from({ length: 13 }, (_, index) => `Item ${index}`) }));
});

test('updates use a separate revision and preserve a dated client history', () => {
  const quote = approvedQuote();
  const first = applyProjectProgress(quote, { progressRevision: 0, stage: 'design', percentage: 25, summary: 'Wireframes are ready.', completedItems: 'Discovery call', nextSteps: 'Client wireframe review' }, account.id, '2026-09-01T10:00:00.000Z');
  assert.equal(first.revision, quote.revision);
  assert.equal(first.projectProgress.revision, 1);
  assert.equal(first.projectProgress.history.length, 1);
  const second = applyProjectProgress(first, { progressRevision: 1, stage: 'development', percentage: 50, summary: 'Approved pages are in development.', completedItems: ['Discovery call', 'Wireframes'], nextSteps: ['Build forms'] }, account.id, '2026-09-02T10:00:00.000Z');
  assert.equal(second.projectProgress.revision, 2);
  assert.deepEqual(second.projectProgress.history.map(({ percentage }) => percentage), [25, 50]);
  assert.throws(() => applyProjectProgress(second, { progressRevision: 1, stage: 'launch', percentage: 90 }, account.id), /changed/);
});

test('client progress excludes private tokens, emails and internal updater identity', () => {
  const quote = applyProjectProgress(approvedQuote(), { progressRevision: 0, stage: 'development', percentage: 55, summary: 'Build is underway.', completedItems: [], nextSteps: [] }, account.id);
  const safe = publicProjectProgress(quote);
  assert.equal(safe.progress.stageLabel, 'Development');
  const serialized = JSON.stringify(safe);
  for (const value of [quote.publicToken, quote.customerEmail, quote.partnerEmail, account.id, 'updatedBy']) assert.equal(serialized.includes(value), false);
});

test('progress links use the private URL fragment and configured site origin', () => {
  const previous = process.env.SITE_URL;
  try {
    process.env.SITE_URL = 'https://blackoak.example';
    const quote = approvedQuote();
    assert.equal(projectProgressLink(quote), `https://blackoak.example/progress.html?project=${quote.id}#${quote.publicToken}`);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});
