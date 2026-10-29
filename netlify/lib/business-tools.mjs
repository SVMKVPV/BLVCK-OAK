import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '@netlify/database';
import { PortalError } from './portal-auth.mjs';
import { normaliseRecord, nextDate, sydneyDate, supplierRows, toolById } from '../../business-tools-model.js';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let toolsPool;
export const getToolsPool = () => toolsPool ||= getDatabase().pool;
const iso = value => value instanceof Date ? value.toISOString() : value;
export function publicRecord(row) { return row ? { id: row.id, service: row.service, title: row.title, status: row.status, dueDate: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : row.due_date, data: row.data, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null; }
function validate(fn) { try { return fn(); } catch (error) { throw new PortalError(error.message); } }
function id(value) { if (typeof value !== 'string' || !uuidPattern.test(value)) throw new PortalError('Invalid record identifier.'); return value; }
async function event(client, owner, record, action, detail = {}) { await client.query('INSERT INTO oak_tool_events(owner_id,record_id,action,detail) VALUES($1,$2,$3,$4)', [owner, record, action, JSON.stringify(detail)]); }
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw new PortalError(error.constraint === 'oak_tool_product_sku' ? 'A product with that SKU already exists. Refresh and review the existing record.' : 'This action has already been recorded. Reload the record before trying again.', 409); throw error; }
  finally { client.release(); }
}
export async function getRecord(pool, owner, recordId, lock = false) {
  const { rows } = await pool.query('SELECT * FROM oak_tool_records WHERE owner_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''), [owner, id(recordId)]);
  if (!rows[0]) throw new PortalError('Record not found.', 404);
  return rows[0];
}
async function updateRecord(client, owner, recordId, record, version) {
  const { rows } = await client.query('UPDATE oak_tool_records SET title=$3,status=$4,due_date=$5,data=$6,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 AND version=$7 RETURNING *', [owner, recordId, record.title, record.status, record.dueDate, JSON.stringify(record.data), version]);
  if (!rows[0]) throw new PortalError('This record changed in another window. Reload it before saving.', 409);
  return publicRecord(rows[0]);
}
async function insertRecord(client, owner, record) {
  const { rows } = await client.query('INSERT INTO oak_tool_records(id,owner_id,service,title,status,due_date,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUUID(), owner, record.service, record.title, record.status, record.dueDate, JSON.stringify(record.data)]);
  const result = publicRecord(rows[0]); await event(client, owner, result.id, 'created'); return result;
}
export async function mutate(pool, owner, body) {
  if (!uuidPattern.test(body.requestId || '')) throw new PortalError('Refresh before submitting this action.');
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return transaction(pool, async client => {
    // Serialises requests with the same id before checking durable idempotency.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner + ':' + body.requestId]);
    const previous = (await client.query('SELECT * FROM oak_tool_requests WHERE owner_id=$1 AND request_id=$2', [owner, body.requestId])).rows[0];
    if (previous) { if (previous.fingerprint !== fingerprint) throw new PortalError('This request identifier was already used for different changes. Reload and try again.', 409); return previous.result; }
    let result;
    if (body.action === 'save') {
      const record = validate(() => normaliseRecord(body.record));
      if (body.record.id) {
        const old = await getRecord(client, owner, body.record.id, true);
        if (old.service !== record.service) throw new PortalError('A record cannot move between tools.');
        // Computed balances/checks cannot be changed through the record editor.
        for (const key of ['stock', '_check']) if (Object.hasOwn(old.data, key)) record.data[key] = old.data[key];
        result = { record: await updateRecord(client, owner, old.id, record, body.record.version) };
        await event(client, owner, old.id, 'saved', { previousStatus: old.status, status: record.status, version: result.record.version });
      } else result = { record: await insertRecord(client, owner, record) };
    } else if (body.action === 'adjust') {
      const old = await getRecord(client, owner, body.id, true);
      if (!['inventory', 'warehouse', 'loyalty'].includes(old.service)) throw new PortalError('This record does not have a balance.');
      const delta = body.delta, reason = String(body.reason || '').trim();
      if (!Number.isInteger(delta) || !delta || Math.abs(delta) > 1000000 || reason.length < 3 || reason.length > 300) throw new PortalError('Enter a non-zero whole-number adjustment and a reason.');
      const balance = Number(old.data.stock || 0) + delta;
      if (!Number.isSafeInteger(balance) || balance < 0) throw new PortalError('This adjustment would create a negative or invalid balance.');
      result = { record: await updateRecord(client, owner, old.id, { title: old.title, status: old.status, dueDate: old.due_date, data: { ...old.data, stock: balance } }, old.version) };
      await event(client, owner, old.id, 'balance_adjusted', { delta, balance, reason });
    } else if (body.action === 'import_supplier') {
      const old = await getRecord(client, owner, body.id, true);
      if (old.service !== 'supplier-import') throw new PortalError('Select a supplier import record.');
      if (old.version !== body.version) throw new PortalError('Reload the import record before importing.', 409);
      const products = validate(() => supplierRows(old.data.csv || ''));
      if (!products.length || products.length > 100) throw new PortalError('Import 1–100 products at a time.');
      // The SKU index is also the final protection against concurrent manual creates.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner + ':supplier-import']);
      const existing = new Set((await client.query("SELECT lower(data->>'sku') AS sku FROM oak_tool_records WHERE owner_id=$1 AND service='online-store' AND status<>'Archived'", [owner])).rows.map(r => r.sku));
      const imported = [], skipped = [];
      for (const p of products) {
        if (existing.has(p.sku.toLowerCase())) { skipped.push(p.sku); continue; }
        const record = validate(() => normaliseRecord({ service: 'online-store', title: p.title, status: 'Draft', data: { sku: p.sku, supplier: old.data.supplier || '', cost: p.cost, price: p.price } }));
        imported.push((await insertRecord(client, owner, record)).id); existing.add(p.sku.toLowerCase());
      }
      await event(client, owner, old.id, 'supplier_imported', { imported: imported.length, skipped });
      result = { imported: imported.length, skipped, message: `${imported.length} private product records created; ${skipped.length} existing SKUs skipped. No products published.` };
    } else throw new PortalError('Unknown business-tool action.');
    await client.query('INSERT INTO oak_tool_requests(owner_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)', [owner, body.requestId, fingerprint, JSON.stringify(result)]);
    return result;
  });
}
export async function recordCheck(pool, owner, recordId, version, check) {
  return transaction(pool, async client => {
    const old = await getRecord(client, owner, recordId, true);
    const previous = old.data._check;
    const value = { ...check, previousFingerprint: previous?.fingerprint || null, changed: previous ? previous.fingerprint !== check.fingerprint : null };
    const record = await updateRecord(client, owner, old.id, { title: old.title, status: old.status, dueDate: old.due_date, data: { ...old.data, _check: value } }, version);
    await event(client, owner, old.id, 'page_checked', { status: check.status, score: check.score, changed: value.changed });
    return { record };
  });
}
export async function snapshot(pool, owner, now = Date.now()) {
  const today = sydneyDate(now);
  const grouped = await pool.query("SELECT service,count(*)::int AS total,count(*) FILTER (WHERE status NOT IN ('Done','Archived','Resolved','Rejected'))::int AS open,count(*) FILTER (WHERE due_date<=$2::date AND status NOT IN ('Done','Archived','Resolved','Rejected'))::int AS due FROM oak_tool_records WHERE owner_id=$1 GROUP BY service", [owner, today]);
  const due = await pool.query("SELECT * FROM oak_tool_records WHERE owner_id=$1 AND due_date<=$2::date AND status NOT IN ('Done','Archived','Resolved','Rejected') ORDER BY due_date,id LIMIT 40", [owner, today]);
  const metrics = (await pool.query("SELECT count(*) FILTER (WHERE service='workflow-builder' AND status='Active')::int AS active_rules,count(*) FILTER (WHERE service IN ('inventory','warehouse') AND status<>'Archived' AND coalesce((data->>'stock')::numeric,0)<=coalesce(nullif(data->>'reorder','')::numeric,0))::int AS low_stock FROM oak_tool_records WHERE owner_id=$1", [owner])).rows[0];
  return { counts: grouped.rows, due: due.rows.map(publicRecord), summary: { total: grouped.rows.reduce((s, r) => s + r.total, 0), open: grouped.rows.reduce((s, r) => s + r.open, 0), due: grouped.rows.reduce((s, r) => s + r.due, 0), activeRules: metrics.active_rules, lowStock: metrics.low_stock }, today };
}
export async function listRecords(pool, owner, { service, offset = 0, search = '', limit = 100 } = {}) {
  if (service && !toolById.has(service)) throw new PortalError('Unknown tool.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || search.length > 180) throw new PortalError('Invalid list options.');
  const filter = 'owner_id=$1 AND ($2::text IS NULL OR service=$2) AND ($3::text=\'\' OR strpos(lower(title),lower($3))>0)';
  const rows = await pool.query('SELECT * FROM oak_tool_records WHERE ' + filter + ' ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5', [owner, service || null, search, limit + 1, offset]);
  return { records: rows.rows.slice(0, limit).map(publicRecord), hasMore: rows.rows.length > limit, offset };
}
export async function runRules(pool, now = Date.now()) {
  const today = sydneyDate(now);
  return transaction(pool, async client => {
    const { rows } = await client.query("SELECT * FROM oak_tool_records WHERE service='workflow-builder' AND status='Active' AND data->>'nextRun'<=$1 ORDER BY data->>'nextRun',id LIMIT 100 FOR UPDATE SKIP LOCKED", [today]);
    let created = 0;
    for (const rule of rows) {
      const valid = validate(() => normaliseRecord(publicRecord(rule)));
      const date = valid.data.nextRun;
      const duplicate = (await client.query('SELECT task_id FROM oak_tool_rule_runs WHERE rule_id=$1 AND run_date=$2', [rule.id, date])).rows[0];
      if (!duplicate) {
        const target = toolById.get(valid.data.target);
        const record = validate(() => normaliseRecord({ service: target.id, title: rule.title, status: target.statuses[0], dueDate: date, data: { brief: valid.data.brief, assignee: valid.data.assignee || '' } }));
        const task = await insertRecord(client, rule.owner_id, record);
        await client.query('INSERT INTO oak_tool_rule_runs(rule_id,run_date,task_id) VALUES($1,$2,$3)', [rule.id, date, task.id]);
        await event(client, rule.owner_id, rule.id, 'rule_ran', { date, taskId: task.id, target: target.id }); created++;
      }
      // Catch up with one work item, rather than flooding the desk after a pause.
      let next = nextDate(date, valid.data.frequency);
      while (next && next <= today) next = nextDate(next, valid.data.frequency);
      const data = { ...rule.data, nextRun: next || date };
      await updateRecord(client, rule.owner_id, rule.id, { title: rule.title, status: next ? 'Active' : 'Done', dueDate: rule.due_date, data }, rule.version);
    }
    return { examined: rows.length, created };
  });
}
