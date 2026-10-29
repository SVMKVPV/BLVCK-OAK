import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { CHECKLIST, customerDraft, followUpEligible, leadWorkflow, operationsCsv, operationsReport, operationsSnapshot, readAutomation, sydneyDate, validDate } from '../operations-model.js';
import { saveLeadOperations } from '../netlify/lib/owner-operations.mjs';
import { createOperationsHandler } from '../netlify/functions/owner-operations.mjs';
import { createSalesLead, publicLead, updateSalesLead } from '../netlify/lib/sales-leads.mjs';
import { createSession, PortalError, requireAccount } from '../netlify/lib/portal-auth.mjs';
import { publicAnalyticsPath } from '../netlify/lib/site-analytics.mjs';

const NOW = Date.parse('2026-10-29T15:00:00Z'); // 30 October in Sydney.
const ID = 'a'.repeat(32);
const owner = { id: 'owner', name: 'Sam', email: 'owner@example.test' };
const baseLead = { id: ID, name: 'Example Client', email: 'client@example.test', company: 'Example Studio', service: 'Booking automation', type: 'contact', message: 'Connect our booking requests to the calendar for a person to review.', createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z', status: 'new', ownerNote: '', followUpSentAt: null };
const auth = { isOwner: true, account: owner, session: { csrf: 'owner-csrf' } };
class MemoryStore {
  values = new Map(); serial = 0; writes = 0;
  async get(key) { return structuredClone(this.values.get(key)?.value ?? null); }
  async getWithMetadata(key) { const row = this.values.get(key); return row ? { data: structuredClone(row.value), etag: row.etag } : null; }
  async set(key, value, options = {}) {
    const row = this.values.get(key);
    if ((options.onlyIfNew && row) || (options.onlyIfMatch && options.onlyIfMatch !== row?.etag)) return { modified: false };
    const etag = String(++this.serial); this.values.set(key, { value: structuredClone(value), etag }); this.writes++;
    return { modified: true, etag };
  }
  async setJSON(...args) { return this.set(...args); }
  async list({ prefix }) { return { blobs: [...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, etag: value.etag })) }; }
}
const req = (body, headers = {}) => new Request('https://blvckoak.com.au/api/owner-operations', body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://blvckoak.com.au', 'x-csrf-token': 'owner-csrf', ...headers }, body: JSON.stringify(body) });
const bodyFor = (lead = baseLead) => ({ action: 'save_lead', id: lead.id, revision: readAutomation(lead).revision, status: lead.status, ownerNote: lead.ownerNote || '', nextAction: '', dueDate: '', launchDate: '', followUpPaused: false, checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, false])) });
const handlerFor = (store, overrides = {}) => createOperationsHandler({ getPortalStore: () => ({}), getSalesStore: () => store, authenticate: async () => auth, now: () => NOW, env: () => '', ...overrides });

test('the desk denies anonymous and non-owner accounts before reading leads or configuration', async () => {
  const sessions = new MemoryStore(); let privateReads = 0;
  const handler = createOperationsHandler({ getPortalStore: () => sessions, authenticate: requireAccount, getSalesStore: () => { privateReads++; return {}; }, env: () => { privateReads++; return 'private'; } });
  const anonymous = await handler(req());
  assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  const old = process.env.OWNER_AUTH_EMAIL; process.env.OWNER_AUTH_EMAIL = owner.email;
  try {
    const partner = { id: 'partner', email: 'not-owner@example.test', role: 'owner' };
    await sessions.setJSON('account/partner', partner);
    const session = await createSession(partner, sessions);
    for (const request of [req(undefined, { cookie: session.cookie }), req({ action: 'create_lead' }, { cookie: session.cookie })]) assert.equal((await handler(request)).status, 403);
    assert.equal(privateReads, 0);
  } finally { if (old === undefined) delete process.env.OWNER_AUTH_EMAIL; else process.env.OWNER_AUTH_EMAIL = old; }
});

test('owner writes require CSRF and the correct origin; no writes happen on invalid requests', async () => {
  const store = new MemoryStore(); const handler = handlerFor(store);
  const old = process.env.SITE_URL; process.env.SITE_URL = 'https://blvckoak.com.au';
  try {
    assert.equal((await handler(req({ action: 'save_lead' }, { 'x-csrf-token': 'wrong' }))).status, 403);
    assert.equal((await handler(req({ action: 'save_lead' }, { origin: 'https://untrusted.example' }))).status, 403);
    assert.equal((await handler(new Request('https://blvckoak.com.au/api/owner-operations', { method: 'DELETE' }))).status, 405);
    assert.equal((await handler(req(null))).status, 400);
    assert.equal(store.writes, 0);
  } finally { if (old === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = old; }
});

test('real owner sessions can read records; authorization is rechecked and secrets never appear', async () => {
  const store = new MemoryStore(), sessions = new MemoryStore();
  const lead = await createSalesLead({ ...baseLead, requestId: 'real-owner-test-12345' }, store, baseLead.createdAt);
  const old = process.env.OWNER_AUTH_EMAIL; process.env.OWNER_AUTH_EMAIL = owner.email;
  try {
    await sessions.setJSON('account/owner', owner); const { cookie } = await createSession(owner, sessions);
    const handler = createOperationsHandler({ getPortalStore: () => sessions, getSalesStore: () => store, authenticate: requireAccount, env: () => 'never-return-secret-values', now: () => NOW });
    const response = await handler(req(undefined, { cookie }));
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.leads[0].id, lead.id); assert.equal(data.configuration.email, true); assert.ok(data.csrf);
    assert.doesNotMatch(JSON.stringify(data), /never-return-secret-values/);
    await sessions.setJSON('account/owner', { ...owner, disabled: true });
    assert.equal((await handler(req(undefined, { cookie }))).status, 403);
  } finally { if (old === undefined) delete process.env.OWNER_AUTH_EMAIL; else process.env.OWNER_AUTH_EMAIL = old; }
});

test('manual enquiries persist once on retries, are private, and cannot trigger automatic follow-up', async () => {
  const store = new MemoryStore(), handler = handlerFor(store);
  const body = { action: 'create_lead', requestId: 'manual-enquiry-12345', name: baseLead.name, email: baseLead.email, company: baseLead.company, service: baseLead.service, message: baseLead.message };
  const first = await handler(req(body)), second = await handler(req(body));
  const a = await first.json(), b = await second.json();
  assert.equal(first.status, 201); assert.equal(a.lead.id, b.lead.id); assert.equal(a.lead.type, 'manual'); assert.equal(a.lead.automation.followUpPaused, true);
  assert.equal(followUpEligible(a.lead, NOW + 2 * 86400000), false);
  const changed = await (await handler(req({ ...body, message: body.message + ' Include a second department.' }))).json();
  assert.notEqual(changed.lead.id, a.lead.id);
  assert.equal((await store.list({ prefix: 'lead/' })).blobs.length, 2);
  assert.equal((await handler(req({ ...body, email: 'invalid' }))).status, 400);
});

test('lead details and list snapshots share the same saved records without email or Stripe dependencies', async () => {
  const store = new MemoryStore(); const lead = await createSalesLead({ ...baseLead, requestId: 'snapshot-lead-12345' }, store, baseLead.createdAt);
  const handler = handlerFor(store);
  const snapshot = await (await handler(req())).json();
  assert.equal(snapshot.summary.total, 1); assert.equal(snapshot.configuration.email, false); assert.equal(snapshot.configuration.payments, false);
  const result = await handler(new Request('https://blvckoak.com.au/api/owner-operations?lead=' + lead.id));
  assert.equal((await result.json()).lead.email, lead.email);
  assert.equal((await handler(new Request('https://blvckoak.com.au/api/owner-operations?lead=../account/owner'))).status, 400);
  assert.equal((await handler(new Request('https://blvckoak.com.au/api/owner-operations?lead=' + ID))).status, 404);
});

test('next actions use Sydney calendar dates, close lost leads and schedule retention after actual launch', () => {
  assert.equal(sydneyDate(NOW), '2026-10-30');
  assert.equal(leadWorkflow(baseLead, NOW).urgency, 'overdue');
  assert.equal(leadWorkflow({ ...baseLead, status: 'lost' }, NOW).title, '');
  const completed = Object.fromEntries(CHECKLIST.map(item => [item.id, item.id !== 'checkin']));
  const won = { ...baseLead, status: 'won', automation: { checklist: completed, launchDate: '2026-10-04' } };
  assert.equal(leadWorkflow(won, NOW).dueDate, '2026-11-03');
  assert.equal(leadWorkflow(won, NOW).kind, 'retention');
  assert.equal(leadWorkflow({ ...won, automation: { ...won.automation, checklist: { ...completed, checkin: true } } }, NOW).title, '');
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2028-02-29'), true);
});

test('workflow edits validate dates and fields, use optimistic concurrency and preserve original enquiry', async () => {
  const store = new MemoryStore(); await store.setJSON('lead/' + ID, baseLead);
  const updated = await saveLeadOperations(store, { ...bodyFor(), status: 'won', nextAction: 'Prepare kickoff', dueDate: '2026-11-03', followUpPaused: true }, owner.id, NOW);
  assert.equal(updated.message, baseLead.message); assert.equal(updated.automation.revision, 1);
  assert.equal(leadWorkflow(updated, NOW).title, 'Prepare kickoff'); assert.equal(updated.statusChangedAt, new Date(NOW).toISOString());
  await assert.rejects(saveLeadOperations(store, bodyFor(), owner.id, NOW), error => error.status === 409);
  for (const patch of [{ dueDate: '2026-02-30' }, { launchDate: '2027-01-01' }, { status: '__proto__' }, { nextAction: 'a'.repeat(181) }, { checklist: [] }]) await assert.rejects(saveLeadOperations(store, { ...bodyFor(updated), ...patch }, owner.id, NOW), PortalError);
  const saved = await store.get('lead/' + ID); assert.equal(saved.automation.revision, 1);
  const conflicted = { getWithMetadata: store.getWithMetadata.bind(store), setJSON: async () => ({ modified: false }) };
  await assert.rejects(saveLeadOperations(conflicted, bodyFor(updated), owner.id, NOW), error => error.status === 409);
});

test('logging human contact stops the follow-up and records stable first-contact and latest-contact dates', async () => {
  const store = new MemoryStore(); await store.setJSON('lead/' + ID, baseLead);
  assert.equal(followUpEligible(baseLead, NOW), true);
  const first = await saveLeadOperations(store, { action: 'log_contact', id: ID, revision: 0 }, owner.id, NOW);
  assert.equal(first.status, 'contacted'); assert.equal(first.automation.followUpPaused, true); assert.equal(followUpEligible(first, NOW), false);
  const second = await saveLeadOperations(store, { action: 'log_contact', id: ID, revision: 1 }, owner.id, NOW + 86400000);
  assert.equal(first.automation.firstContactAt, second.automation.firstContactAt);
  assert.notEqual(first.automation.lastContactAt, second.automation.lastContactAt);
  assert.equal(leadWorkflow(second, NOW).dueDate, '2026-11-03');
  const reopened = { ...second, status: 'new' }; assert.equal(followUpEligible(reopened, NOW), false);
});

test('legacy partner edits retain automation settings and invalidate stale desk edits', async () => {
  const store = new MemoryStore(); await store.setJSON('lead/' + ID, { ...baseLead, automation: { revision: 3, followUpPaused: true, nextAction: 'Confirm requirements', dueDate: '2026-11-02' } });
  const updated = await updateSalesLead(ID, { status: 'qualified', ownerNote: 'Ready for scoping' }, owner.id, store, new Date(NOW).toISOString());
  assert.equal(updated.automation.revision, 4); assert.equal(updated.automation.followUpPaused, true); assert.equal(updated.automation.nextAction, 'Confirm requirements');
  await assert.rejects(saveLeadOperations(store, { ...bodyFor(updated), revision: 3 }, owner.id, NOW), error => error.status === 409);
});

test('the automatic follow-up window respects pause, manual records, sent records and closed stages', () => {
  for (const lead of [{ ...baseLead, automation: { followUpPaused: true } }, { ...baseLead, type: 'manual' }, { ...baseLead, followUpSentAt: new Date(NOW).toISOString() }, { ...baseLead, status: 'lost' }, { ...baseLead, createdAt: new Date(NOW).toISOString() }, { ...baseLead, createdAt: '2026-10-01T00:00:00Z' }]) assert.equal(followUpEligible(publicLead(lead), NOW), false);
});

test('drafts and reports use actual data, describe review limits and neutralise spreadsheet formulas', () => {
  const lead = { ...baseLead, name: ' =HYPERLINK("bad")', status: 'won' };
  const snapshot = operationsSnapshot([lead], NOW);
  assert.equal(snapshot.summary.won, 1); assert.equal(snapshot.summary.loggedContacts, 0);
  assert.match(operationsCsv(snapshot), /"' =HYPERLINK/);
  assert.match(operationsReport(snapshot), /not a historical conversion funnel/);
  assert.match(customerDraft(baseLead, 'proposal').body, /Final price, GST treatment/);
  assert.match(customerDraft(baseLead, 'reply').body, /Example Client/);
  assert.doesNotMatch(customerDraft(baseLead, 'reply').body, /paid|confirmed booking/);
});

test('errors return no private internal details and never invent a successful empty pipeline', async () => {
  const handler = handlerFor({}, { listLeads: async () => { throw new Error('sensitive-storage-detail'); } });
  const response = await handler(req());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /sensitive-storage-detail|"leads"/);
});

test('owner operations remain excluded from public analytics and search indexing', async () => {
  for (const path of ['/operations', '/operations.html', '/%6fperations.html', '/safe/../operations.html?lead=private']) assert.equal(publicAnalyticsPath(path), null);
  const [html, tracking, build] = await Promise.all(['operations.html', 'analytics-tracking.js', 'scripts/build.mjs'].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(html, /noindex,nofollow/); assert.match(tracking, /operations/);
  for (const path of ['operations.html', 'operations.js', 'operations.css', 'operations-model.js']) assert.ok(build.includes(`'${path}'`));
});

test('quote handoff requires owner access, copies the enquiry and leaves final pricing for review', async () => {
  const source = await readFile(new URL('../partners.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function prefillLeadQuote()'), source.indexOf('function calculatePreview()'));
  let reads = 0, submitted = 0, route = '', previewed = false;
  const elements = Object.fromEntries(['customerName', 'customerEmail', 'service', 'description', 'total'].map(key => [key, { value: 'old' }]));
  const note = { textContent: '' }, form = { elements, scrollIntoView() {}, submit() { submitted++; } };
  const context = {
    URL, dashboard: { isOwner: true }, location: { href: 'https://blvckoak.com.au/partners.html?lead=' + ID + '#quote-editor' },
    api: async path => { reads++; assert.equal(path, '/api/owner-operations?lead=' + ID); return { lead: baseLead }; },
    $: selector => selector === '[data-quote-form]' ? form : note,
    history: { replaceState(_state, _unused, value) { route = value; } },
    updateQuotePreview() { previewed = true; }, status() {},
  };
  await runInNewContext(fn + '\nprefillLeadQuote()', context);
  assert.equal(elements.customerEmail.value, baseLead.email); assert.equal(elements.description.value, baseLead.message);
  assert.equal(elements.total.value, ''); assert.equal(submitted, 0); assert.equal(previewed, true);
  assert.equal(route, '/partners.html#quote-editor'); assert.match(note.textContent, /enter the agreed final price/);
  context.dashboard.isOwner = false;
  await runInNewContext(fn + '\nprefillLeadQuote()', context);
  assert.equal(reads, 1);
});
