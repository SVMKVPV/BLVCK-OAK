import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NetlifyDB } from '@netlify/database-dev';
import { getDatabase } from '@netlify/database';
import { tools, calculate, cleanCsv, connectionStatus, csvText, nextDate, normaliseRecord, parseCsv, reconcile, searchKnowledge, supplierRows, validDate } from '../business-tools-model.js';
import { calendarFile, pageDocument, recordDocument } from '../business-tools-render.js';
import { getRecord, listRecords, mutate, publicRecord, recordCheck, runRules, snapshot } from '../netlify/lib/business-tools.mjs';
import { createBusinessToolsHandler } from '../netlify/functions/business-tools.mjs';
import { PortalError } from '../netlify/lib/portal-auth.mjs';
import { publicAnalyticsPath } from '../netlify/lib/site-analytics.mjs';

test('all 78 services have concrete owner fields, explicit capabilities and valid defaults', () => {
  assert.equal(tools.length, 78); assert.equal(new Set(tools.map(t => t.id)).size, 78);
  for (const tool of tools) { assert.ok(tool.fields.length); assert.ok(tool.now.length > 30); assert.ok(tool.actions.length); assert.equal(new Set(tool.fields.map(f => f.key)).size, tool.fields.length); assert.doesNotThrow(() => normaliseRecord({ service: tool.id, title: 'Example record', status: tool.statuses[0], data: {} })); }
  assert.equal(publicAnalyticsPath('/business-tools.html'), null);
  assert.equal(publicAnalyticsPath('/business-tools'), null);
});
test('typed records reject bad dates, unexpected status, unsafe links and invalid active rules', () => {
  const base = { service: 'inventory', title: 'A stock item', status: 'Draft', data: { reorder: 2 } };
  assert.throws(() => normaliseRecord({ ...base, dueDate: '2026-02-30' }));
  assert.equal(validDate('2026-99-99'), false);
  assert.throws(() => normaliseRecord({ ...base, data: { reorder: -1 } }));
  assert.throws(() => normaliseRecord({ ...base, status: 'Published' }));
  assert.throws(() => normaliseRecord({ service: 'brand-portal', title: 'Link', status: 'Draft', data: { assetUrl: 'javascript:alert(1)' } }));
  assert.throws(() => normaliseRecord({ service: 'workflow-builder', title: 'Rule', status: 'Active', data: {} }));
  assert.equal(normaliseRecord({ ...base, data: { stock: 100000, secret: 'ignored' } }).data.stock, undefined);
});
test('invoice rounding, margin ceilings, time and renewal calculations use entered facts', () => {
  const invoice = calculate('invoices', { items: 'Setup | 2 | 19.99 | 10\nSupport | 1.5 | 40 | 0' });
  assert.equal(invoice.subtotal, 99.98); assert.equal(invoice.tax, 4); assert.equal(invoice.total, 103.98);
  assert.throws(() => calculate('invoices', { items: 'Bad | 1 | 99' }));
  assert.throws(() => calculate('pricing-rules', { cost: 10, margin: 100 }));
  assert.equal(calculate('pricing-rules', { cost: 50, margin: 50, ceiling: 90 }).proposed, 90);
  assert.throws(() => calculate('pricing-rules', { cost: 20, floor: 100, ceiling: 80 }));
  assert.equal(calculate('timesheets', { start: '2026-10-30T09:00', end: '2026-10-30T17:30', breakMinutes: 30, hourlyRate: 40 }).hours, 8);
  assert.throws(() => calculate('timesheets', { start: '2026-10-30T17:00', end: '2026-10-30T09:00' }));
  assert.equal(calculate('renewals', { expiry: '2027-01-05', noticeDays: 30 }).dueDate, '2026-12-06');
  assert.throws(() => calculate('gst-tax', { amount: 10, tax: 15 }));
});
test('CSV cleanup handles quotes/newlines, rejects malformed data, and neutralises spreadsheet formulas', () => {
  assert.deepEqual(parseCsv('name,description\r\n"A, B","two\nlines"').rows, [['A, B', 'two\nlines']]);
  assert.throws(() => parseCsv('name,amount\nX,1,2'));
  assert.throws(() => parseCsv('name,Name\nX,Y'));
  assert.throws(() => parseCsv('name\n"unfinished'));
  const result = cleanCsv('email,amount\na@example.test,5\na@example.test,6\nb@example.test,7', 'email');
  assert.equal(result.rows.length, 2); assert.equal(result.rows[0][1], '5');
  assert.match(csvText([['=HYPERLINK("bad")', ' +SUM(1,2)']]), /'=HYPERLINK/);
  assert.match(result.summary, /1 duplicates removed/);
  assert.throws(() => supplierRows('sku,title,cost,price\nA,one,1,2\na,two,2,3'));
});
test('reconciliation never silently matches ambiguous references or wrong amounts', () => {
  const result = reconcile('reference,amount\nA,100\nB,40\nB,50\nC,10', 'reference,amount\nA,100\nB,40\nC,11\nD,5');
  assert.deepEqual(result.rows.map(r => r[1]), ['Matched', 'Ambiguous duplicate', 'Amount mismatch', 'Payment without invoice']);
});
test('knowledge search returns only approved private answers and connection checks never return secret values', () => {
  const rows = [{ service: 'knowledge-chat', title: 'Prices', status: 'Draft', data: { answer: 'secret price' } }, { service: 'receptionist', title: 'Hours', status: 'Approved', data: { question: 'When are you open?', answer: 'Weekdays', sourceUrl: 'https://example.test' } }];
  assert.equal(searchKnowledge(rows, 'price').length, 0); assert.equal(searchKnowledge(rows, 'hours')[0].record.data.answer, 'Weekdays');
  const connections = connectionStatus(() => 'never-expose-this');
  assert.equal(connections.find(c => c.id === 'ai').configured, true); assert.equal(connections.find(c => c.id === 'social').configured, false);
  assert.doesNotMatch(JSON.stringify(connections), /never-expose-this/);
});
test('generated pages/documents escape content and calendar output prevents injected properties', () => {
  const record = { service: 'landing-generator', title: '<script>alert(1)</script>', status: 'Draft', data: { headline: '<img src=x onerror=alert(1)>', links: 'Website | https://example.test', intro: 'Hello' } };
  const html = pageDocument(record); assert.doesNotMatch(html, /<script>|<img/); assert.match(html, /&lt;img/);
  assert.throws(() => pageDocument({ ...record, data: { links: 'Bad | javascript:alert(1)' } }));
  assert.doesNotMatch(recordDocument(record), /<script>|<img/);
  const ics = calendarFile({ id: 'sample', title: 'Title\nATTENDEE:evil@example.test', data: { start: '2026-10-30T09:00', end: '2026-10-30T10:00' } });
  assert.match(ics, /TZID:Australia\/Sydney/); assert.doesNotMatch(ics, /\r\nATTENDEE/);
  assert.equal(nextDate('2028-01-31', 'Monthly'), '2028-02-29'); assert.equal(nextDate('2026-10-30', 'Weekly'), '2026-11-06');
});

test('database: private durable records, transactional ledgers, imports, task rules and API boundaries', { timeout: 60000 }, async t => {
  const db = new NetlifyDB({ logger: () => {} });
  const connectionString = await db.start();
  const previousDriver = process.env.NETLIFY_DB_DRIVER;
  process.env.NETLIFY_DB_DRIVER = 'server';
  const pool = getDatabase({ connectionString }).pool;
  if (previousDriver === undefined) delete process.env.NETLIFY_DB_DRIVER; else process.env.NETLIFY_DB_DRIVER = previousDriver;
  // PGlite is one Postgres backend, even when its wire server accepts several
  // sockets. Serialise connections in this local harness; production Postgres
  // uses real transactions, row/advisory locks and unique constraints.
  pool.options.max = 1;
  const owner = 'tool-test-owner';
  try {
    await db.applyMigrations(new URL('../netlify/database/migrations', import.meta.url).pathname);
    const save = (record, who = owner) => mutate(pool, who, { action: 'save', requestId: randomUUID(), record });
    let stock;
    await t.test('idempotent creates, optimistic edits, private ownership and immutable computed fields', async () => {
      const body = { action: 'save', requestId: randomUUID(), record: { service: 'inventory', title: 'OAK stock', status: 'Draft', dueDate: '2026-10-30', data: { sku: 'OAK-1', reorder: 2, stock: 999 } } };
      const a = await mutate(pool, owner, body), b = await mutate(pool, owner, body); assert.equal(a.record.id, b.record.id); stock = a.record;
      assert.equal(stock.data.stock, undefined);
      await assert.rejects(mutate(pool, owner, { ...body, record: { ...body.record, title: 'Other' } }), /already used/);
      await assert.rejects(getRecord(pool, 'other-owner', stock.id), /not found/);
      const changed = await save({ ...stock, title: 'Updated stock' });
      await assert.rejects(save({ ...stock, title: 'Stale overwrite' }), /another window/);
      stock = changed.record;
    });
    await t.test('stock changes are atomic, retry safe, audited and cannot go negative', async () => {
      const body = { action: 'adjust', id: stock.id, delta: 10, reason: 'Received ten units', requestId: randomUUID() };
      const [a, b] = await Promise.all([mutate(pool, owner, body), mutate(pool, owner, body)]);
      assert.equal(a.record.data.stock, 10); assert.equal(b.record.data.stock, 10);
      const attempts = await Promise.allSettled([1, 2].map(() => mutate(pool, owner, { action: 'adjust', id: stock.id, delta: -7, reason: 'Order dispatch', requestId: randomUUID() })));
      assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
      stock = publicRecord(await getRecord(pool, owner, stock.id)); assert.equal(stock.data.stock, 3);
      const result = await save({ ...stock, data: { ...stock.data, stock: 9000 } }); assert.equal(result.record.data.stock, 3);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM oak_tool_events WHERE record_id=$1 AND action='balance_adjusted'", [stock.id])).rows[0].n, 2);
    });
    await t.test('supplier import is transactional and skips existing SKUs on later imports', async () => {
      const { record } = await save({ service: 'supplier-import', title: 'Supplier A', status: 'Draft', data: { supplier: 'A', csv: 'sku,title,cost,price\nA-1,Product one,10,20\nA-2,Product two,15,30' } });
      const body = { action: 'import_supplier', id: record.id, version: record.version, requestId: randomUUID() };
      assert.equal((await mutate(pool, owner, body)).imported, 2); assert.equal((await mutate(pool, owner, body)).imported, 2);
      const again = await mutate(pool, owner, { ...body, requestId: randomUUID() }); assert.equal(again.imported, 0); assert.equal(again.skipped.length, 2);
      assert.equal((await listRecords(pool, owner, { service: 'online-store' })).records.length, 2);
    });
    await t.test('scheduled rules create one internal task per due date and paused rules stay paused', async () => {
      const { record: rule } = await save({ service: 'workflow-builder', title: 'Weekly equipment check', status: 'Active', data: { target: 'maintenance', frequency: 'Weekly', nextRun: '2026-10-30', brief: 'Check the equipment and record issues.' } });
      await save({ service: 'workflow-builder', title: 'Paused rule', status: 'Paused', data: { target: 'projects', frequency: 'Daily', nextRun: '2026-10-01', brief: 'Must not run.' } });
      const now = Date.parse('2026-10-29T20:00:00Z');
      const results = await Promise.all([runRules(pool, now), runRules(pool, now)]); assert.equal(results.reduce((n, r) => n + r.created, 0), 1);
      const rows = (await listRecords(pool, owner, { service: 'maintenance' })).records; assert.equal(rows.length, 1); assert.equal(rows[0].dueDate, '2026-10-30');
      assert.equal((await getRecord(pool, owner, rule.id)).data.nextRun, '2026-11-06');
      assert.equal((await listRecords(pool, owner, { service: 'projects' })).records.length, 0);
      assert.equal((await snapshot(pool, owner, now)).summary.activeRules, 1);
    });
    await t.test('saved page checks retain a baseline and reject stale concurrent results', async () => {
      const { record } = await save({ service: 'website-monitoring', title: 'Public homepage', status: 'Draft', data: { website: 'https://example.test' } });
      const a = await recordCheck(pool, owner, record.id, record.version, { fingerprint: 'a', score: 80, status: 200 }); assert.equal(a.record.data._check.changed, null);
      const b = await recordCheck(pool, owner, record.id, a.record.version, { fingerprint: 'b', score: 90, status: 200 }); assert.equal(b.record.data._check.changed, true);
      await assert.rejects(recordCheck(pool, owner, record.id, a.record.version, { fingerprint: 'c' }), /another window/);
    });
    await t.test('API authentication, CSRF, missing AI credentials and provider isolation', async () => {
      const auth = { isOwner: true, account: { id: owner, name: 'Owner' }, session: { csrf: 'csrf-test' } };
      let accesses = 0, providerCalls = 0;
      const handler = extra => createBusinessToolsHandler({ getAuthStore: () => ({}), authenticate: async () => auth, getPool: () => { accesses++; return pool; }, env: () => '', request: async () => { providerCalls++; throw new Error('No outbound calls in this test'); }, ...extra });
      const req = (body, headers = {}) => new Request('https://blvckoak.com.au/api/business-tools', body ? { method: 'POST', headers: { origin: 'https://blvckoak.com.au', 'content-type': 'application/json', 'x-csrf-token': 'csrf-test', ...headers }, body: JSON.stringify(body) } : {});
      assert.equal((await handler({ authenticate: async () => { throw new PortalError('Sign in', 401); } })(req())).status, 401);
      assert.equal((await handler({ authenticate: async () => ({ ...auth, isOwner: false }) })(req())).status, 403); assert.equal(accesses, 0);
      assert.equal((await handler({})(req({ action: 'save' }, { 'x-csrf-token': 'wrong' }))).status, 403); assert.equal(accesses, 0);
      const response = await handler({})(req()); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.csrf, 'csrf-test'); assert.equal(data.connections.find(c => c.id === 'ai').configured, false);
      assert.equal((await handler({})(req({ action: 'ai_draft', id: stock.id }))).status, 409); assert.equal(providerCalls, 0);
      assert.equal((await handler({})(new Request('https://blvckoak.com.au/api/business-tools?id=' + randomUUID()))).status, 404);
      assert.equal((await handler({})(req({ action: 'save', requestId: randomUUID(), record: { title: 'Invalid' } }))).status, 400);
    });
  } finally { await pool.end(); await db.stop(); }
});
