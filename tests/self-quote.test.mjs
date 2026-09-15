import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEstimateBrief, calculateEstimate, formatRange } from '../quote-builder.js';

const selection = {
  websiteBuild: 'new',
  websiteLevel: 'professional',
  features: ['booking'],
  services: ['seo'],
  marketingSetup: ['strategy'],
  monthly: ['social'],
  timeline: 'one-month',
  payment: 'pay-as-you-sell',
  industry: 'Local café',
  notes: 'We need online reservations.',
};

test('self-quote adds one-off work and keeps monthly marketing separate', () => {
  const estimate = calculateEstimate(selection);
  assert.deepEqual(estimate.oneOff, { min: 2650, max: 4800 });
  assert.deepEqual(estimate.monthly, { min: 500, max: 1200 });
  assert.equal(estimate.oneOffItems.length, 4);
  assert.equal(estimate.monthlyItems.length, 1);
  assert.match(formatRange(estimate.oneOff), /2,650/);
  assert.match(formatRange(estimate.oneOff), /4,800/);
});

test('monthly-only work is allowed while empty or forged selections are rejected', () => {
  const monthlyOnly = calculateEstimate({ ...selection, websiteBuild: 'none', websiteLevel: '', features: [], services: [], marketingSetup: [], monthly: ['maintenance'] });
  assert.deepEqual(monthlyOnly.oneOff, { min: 0, max: 0 });
  assert.deepEqual(monthlyOnly.monthly, { min: 99, max: 350 });
  assert.throws(() => calculateEstimate({ ...selection, websiteBuild: 'none', websiteLevel: '', features: [], services: [], marketingSetup: [], monthly: [] }), /at least one/);
  assert.throws(() => calculateEstimate({ ...selection, services: ['constructor'] }), /valid specialist/);
  assert.throws(() => calculateEstimate({ ...selection, timeline: '__proto__' }), /valid project timing/);
});

test('generated brief carries selected scope and non-binding pricing language to the contact form', () => {
  const brief = buildEstimateBrief(calculateEstimate(selection), 'BOQ-12345678');
  assert.match(brief, /INDICATIVE ESTIMATE ONLY/);
  assert.match(brief, /Professional foundation/);
  assert.match(brief, /Social media management/);
  assert.match(brief, /Pay as You Sell/);
  assert.match(brief, /not a binding offer/);
  assert.ok(brief.length <= 2900);
});

test('the public builder includes all stages, marketing choices and the estimate disclaimer', async () => {
  const page = await readFile(new URL('../quote.html', import.meta.url), 'utf8');
  assert.equal([...page.matchAll(/<section class="quote-step/g)].length, 5);
  assert.match(page, /One-off marketing setup/);
  assert.match(page, /Optional monthly marketing/);
  assert.match(page, /Ask about Pay as You Sell/);
  assert.match(page, /not a binding offer/);
  assert.match(page, /data-send-estimate/);
});
