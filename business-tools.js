import { tools, toolById, categories, calculate, cleanCsv, connectionStatus, csvText, draftFor, normaliseRecord, reconcile, searchKnowledge, supplierRows } from './business-tools-model.js';
import { escape, recordDocument, pageDocument, calendarFile } from './business-tools-render.js';

const $ = s => document.querySelector(s);
function requestUUID() { if (crypto.randomUUID) return crypto.randomUUID(); const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; }
let snapshot = null, selected = null, current = null, records = [], category = 'all', view = 'library', offset = 0, hasMore = false, dirty = false, busy = false, epoch = 0, listEpoch = 0, recordEpoch = 0, retry = null;
const actionLabels = { document: 'Download document', calculate: 'Calculate', draft: 'Prepare template draft', ai: 'Request AI draft', page: 'Generate page', calendar: 'Download calendar event', check: 'Check public page', stock: 'Adjust balance', supplier: 'Validate supplier CSV', csv: 'Clean CSV', reconcile: 'Reconcile CSVs', knowledge: 'Find an approved answer', connections: 'View connections', report: 'Prepare work summary' };
const state = (message, error = false, target = '#status') => { $(target).textContent = message; $(target).dataset.error = String(error); };
const empty = (title, copy = '') => `<div class="empty"><h3>${escape(title)}</h3><p>${escape(copy)}</p></div>`;
const dateLabel = value => value ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(new Date(value.length === 10 ? value + 'T01:00:00Z' : value)) : 'No due date';
function deny(error) {
  epoch++; listEpoch++; recordEpoch++; snapshot = null; selected = null; current = null; records = []; dirty = false; retry = null;
  $('#workspace').hidden = true; $('#access').hidden = false;
  $('#record-form').reset(); $('#stock-form').reset();
  ['#metrics', '#due-list', '#recent-list', '#record-list', '#dynamic-fields', '#record-history', '#tool-output', '#output-actions', '#module-heading', '#module-example', '#knowledge-results', '#tool-grid'].forEach(s => $(s).replaceChildren());
  $('#confirm-dialog').close();
  $('#access-title').textContent = error.status === 403 ? 'Use your verified owner account.' : 'Open your owner workspace.';
  $('#access-copy').textContent = error.status === 403 ? 'This account cannot access private business records. Switch to your BLVCK OAK owner account.' : 'Sign in with your verified BLVCK OAK owner email.';
  $('#sign-in').href = error.status === 403 ? '/partners.html' : '/partners.html?next=%2Fbusiness-tools.html';
  state('Private records are protected by owner verification.');
}
async function api(path = '', body) {
  const response = await fetch('/api/business-tools' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': snapshot?.csrf || '' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The toolkit could not connect. Try again shortly.');
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error || 'The action could not be completed.'); e.status = response.status; if ([401, 403].includes(e.status)) deny(e); throw e; }
  return data;
}
function error(error, target = '#record-status') { if (![401, 403].includes(error.status)) state(error.name === 'TimeoutError' ? 'The request timed out. Reload the record to check whether it completed. Retrying the unchanged action is protected against duplicates.' : error.message, true, target); }
async function post(body) {
  const fingerprint = JSON.stringify(body);
  if (!retry || retry.fingerprint !== fingerprint) retry = { fingerprint, requestId: requestUUID() };
  const result = await api('', { ...body, requestId: retry.requestId }); retry = null; return result;
}
async function confirmAction(title, copy, label = 'Continue') {
  if ($('#confirm-dialog').open) return false;
  $('#confirm-title').textContent = title; $('#confirm-copy').textContent = copy; $('#confirm-yes').textContent = label;
  const dialog = $('#confirm-dialog'); dialog.returnValue = ''; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}
$('#confirm-cancel').addEventListener('click', () => $('#confirm-dialog').close('no'));
$('#confirm-yes').addEventListener('click', () => $('#confirm-dialog').close('yes'));
async function mayLeave() { return !busy && (!dirty || await confirmAction('Leave unsaved changes?', 'Your current edits have not been saved.', 'Discard changes')); }
function setBusy(value) { busy = value; $('#record-fields').disabled = value; $('#stock-form').querySelectorAll('input,button').forEach(el => { el.disabled = value; }); document.querySelectorAll('#tool-actions button,#new-record,#refresh,#export-module,#export-all').forEach(el => { el.disabled = value; }); }
async function load() {
  const token = epoch; $('#refresh').disabled = true;
  try {
    const data = await api(); if (token !== epoch) return;
    snapshot = data; $('#access').hidden = true; $('#workspace').hidden = false;
    renderOverview(); renderLibrary(); renderConnections();
    state('Connected to your private business records · ' + snapshot.summary.total + ' saved');
    $('#updated').textContent = 'Updated ' + new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).format(new Date(data.generatedAt));
    return true;
  } catch (e) { error(e, '#status'); if (!snapshot && ![401, 403].includes(e.status)) { $('#access').hidden = false; $('#access-title').textContent = 'The toolkit could not load.'; $('#access-copy').textContent = e.message; } }
  finally { $('#refresh').disabled = false; }
}
function renderOverview() {
  const s = snapshot.summary;
  $('#metrics').innerHTML = [['Saved records', s.total, 'Across your tools'], ['Due & overdue', s.due, 'Ready for action'], ['Active task rules', s.activeRules, 'Internal tasks only'], ['Low stock', s.lowStock, 'At your threshold']].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  $('#due-list').innerHTML = snapshot.due.map(recordCard).join('') || empty('Nothing due here.', 'Give a record a due date to bring it into this queue.');
}
function recordCard(r) { return `<button type="button" class="record-card${current?.id === r.id ? ' selected' : ''}" data-record="${r.id}" data-service="${r.service}"><strong>${escape(r.title)}</strong><small>${escape(r.status)} · ${escape(dateLabel(r.dueDate))}</small></button>`; }
function renderCategories() { $('#categories').innerHTML = `<button type="button" data-category="all" class="${category === 'all' ? 'selected' : ''}">⊞ &nbsp; All departments <span>78</span></button>` + categories.map(c => `<button type="button" data-category="${c.id}" class="${category === c.id ? 'selected' : ''}">${c.symbol} &nbsp; ${escape(c.short)} <span>${tools.filter(t => t.category === c.id).length}</span></button>`).join(''); }
function renderLibrary() {
  if (!snapshot) return;
  renderCategories();
  const search = $('#tool-search').value.toLowerCase(), filter = $('#tool-filter').value;
  const visible = tools.filter(t => (category === 'all' || t.category === category) && `${t.title} ${t.description} ${t.now}`.toLowerCase().includes(search) && (filter !== 'used' || snapshot.counts.some(c => c.service === t.id && c.total)) && (filter !== 'existing' || t.link) && (filter !== 'calculators' || t.actions.some(a => ['calculate', 'supplier', 'csv', 'reconcile', 'stock', 'check'].includes(a))));
  $('#library-title').textContent = category === 'all' ? 'Your business toolkit.' : categories.find(c => c.id === category).name + '.';
  $('#tool-count').textContent = visible.length + ' tools & workspaces';
  $('#tool-grid').innerHTML = visible.map(t => { const count = snapshot.counts.find(c => c.service === t.id)?.total || 0; const symbol = categories.find(c => c.id === t.category).symbol; return `<button class="tool-card" type="button" data-tool="${t.id}"><span class="card-top"><span class="tool-icon" aria-hidden="true">${symbol}</span><span class="card-type">${t.link ? 'Linked workspace' : t.actions.length > 1 ? 'Workspace + tools' : 'Planning workspace'}</span></span><h3>${escape(t.title)}</h3><p>${escape(t.now)}</p><span class="card-bottom"><span>${count ? count + ' saved record' + (count === 1 ? '' : 's') : 'Ready for your first record'}</span><span aria-hidden="true">↗</span></span></button>`; }).join('') || empty('No matching tools.', 'Try a broader search or a different department.');
}
function renderConnections() {
  const connections = snapshot.connections || connectionStatus(() => '');
  $('#connection-count').textContent = connections.filter(c => !c.configured).length;
  $('#connections-grid').innerHTML = connections.map(c => `<article class="connection-card"><span class="tag${c.configured ? ' ready' : ''}">${escape(c.status)}</span><h3>${escape(c.name)}</h3><p>${escape(c.use)}</p><details><summary>Setup &amp; next steps</summary><p>${escape(c.setup)}</p>${c.id === 'ai' ? '<p>Hosting settings: OPENAI_API_KEY and OPENAI_MODEL. Keep the key secret.</p>' : ''}</details></article>`).join('');
}
async function showView(next, skipGuard = false) {
  if (!skipGuard && !(await mayLeave())) return;
  view = next; document.body.dataset.view = next; if (next !== 'module') { dirty = false; selected = null; current = null; listEpoch++; recordEpoch++; }
  for (const name of ['library', 'work', 'connections', 'module']) $('#' + name + '-view').hidden = name !== next;
  document.querySelectorAll('[data-view]').forEach(b => { if (b.dataset.view === next || next === 'module' && b.dataset.view === 'library') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (next === 'work') { const token = epoch; try { const data = await api('?list=1'); if (token === epoch && view === 'work') $('#recent-list').innerHTML = data.records.map(recordCard).join('') || empty('Your records will appear here.', 'Choose a tool and save your first piece of work.'); } catch (e) { error(e, '#status'); } }
}
function fieldMarkup(f) {
  const name = escape(f.key), label = escape(f.label);
  if (f.type === 'textarea') return `<label>${label}<textarea name="${name}" rows="${f.key === 'output' || f.key === 'csv' ? 6 : 4}" maxlength="${f.max || 12000}" placeholder="${escape(f.placeholder || '')}"></textarea></label>`;
  if (f.type === 'select') return `<label>${label}<select name="${name}"><option value="">Choose…</option>${f.options.map(o => `<option value="${escape(o)}">${escape(o)}</option>`).join('')}</select></label>`;
  return `<label>${label}<input name="${name}" type="${f.type}"${f.type === 'number' ? ` min="${f.min ?? 0}" max="${f.max ?? 100000000}" step="${f.integer ? 1 : f.step || 'any'}"` : ' maxlength="500"'}${f.type === 'date' ? ' min="2000-01-01" max="2100-12-31"' : ''}></label>`;
}
async function openModule(id, recordId, skipGuard = false) {
  if (!skipGuard && !(await mayLeave())) return;
  const tool = toolById.get(id); if (!tool || !snapshot) return;
  selected = tool; current = null; records = []; recordEpoch++; dirty = false; offset = 0; $('#record-search').value = '';
  await showView('module', true);
  $('#module-heading').innerHTML = `<div class="module-heading"><div><p class="eyebrow">${escape(categories.find(c => c.id === tool.category).name.toUpperCase())}</p><h2>${escape(tool.title)}</h2><p>${escape(tool.description)}</p></div>${tool.link ? `<a class="button" href="${escape(tool.link)}">${escape(tool.linkLabel)} ↗</a>` : ''}</div><div class="capability"><div><h3>AVAILABLE IN YOUR WORKSPACE</h3><p>${escape(tool.now)}</p></div><div><h3>${tool.later ? 'NEXT SETUP / SCOPE' : 'HOW TO START'}</h3><p>${escape(tool.later || 'Create a record, set a due date and save it. Use the tools below to calculate, prepare or export your work. No customer messages are sent by saving a record.')}</p></div></div>`;
  $('#module-example').innerHTML = `<p class="tag">ILLUSTRATIVE SERVICE EXAMPLE</p><h3>${escape(tool.input)}</h3><ol>${tool.stages.map(s => `<li>${escape(s)}</li>`).join('')}</ol><p>${escape(tool.output)}</p><p class="small">This describes the full service. The “Available in your workspace” panel above shows the implemented scope for your business.</p>`;
  $('#record-form').elements.status.innerHTML = tool.statuses.map(s => `<option>${escape(s)}</option>`).join('');
  $('#dynamic-fields').innerHTML = tool.fields.map(fieldMarkup).join('');
  $('#tool-actions').innerHTML = tool.actions.map(a => `<button class="button" type="button" data-action="${a}">${actionLabels[a]}${a === 'ai' && !snapshot.connections.find(c => c.id === 'ai')?.configured ? ' · setup needed' : ''}</button>`).join('');
  fillEditor(null);
  $('#module-view').scrollIntoView({ block: 'start' });
  await loadRecords(); if (recordId && selected?.id === id) await openRecord(recordId, true);
}
async function loadRecords() {
  if (!selected) return;
  const seq = ++listEpoch, token = epoch, id = selected.id;
  try { const data = await api('?list=1&service=' + id + '&offset=' + offset + '&search=' + encodeURIComponent($('#record-search').value)); if (seq !== listEpoch || token !== epoch || selected?.id !== id) return; records = data.records; hasMore = data.hasMore; renderRecords(); }
  catch (e) { if (seq === listEpoch) error(e); }
}
function renderRecords() { $('#record-list').innerHTML = records.map(recordCard).join('') || empty('A fresh workspace.', 'Your saved records will appear here.'); $('#previous-records').disabled = !offset; $('#next-records').disabled = !hasMore; $('#record-page').textContent = 'Page ' + (offset / 100 + 1); }
function fillEditor(record, events = []) {
  current = record; dirty = false; $('#record-form').reset();
  for (const key of ['title', 'status', 'dueDate']) $('#record-form').elements[key].value = record?.[key] || (key === 'status' ? selected.statuses[0] : '');
  for (const f of selected.fields) $('#record-form').elements[f.key].value = record?.data[f.key] ?? '';
  $('#record-kind').textContent = record ? 'SAVED RECORD · VERSION ' + record.version : 'NEW RECORD';
  $('#editor-title').textContent = record ? record.title : 'Start with the details.';
  $('#reload-record').hidden = !record; $('#balance').hidden = !selected.actions.includes('stock');
  $('#balance').textContent = `${record?.data.stock || 0} ${selected.id === 'loyalty' ? 'points' : 'in stock'}`;
  $('#output-panel').hidden = true; $('#tool-output').textContent = ''; $('#output-actions').replaceChildren(); $('#stock-panel').hidden = true; $('#knowledge-panel').hidden = true; $('#knowledge-results').replaceChildren();
  $('#stock-form').reset(); state('', false, '#record-status');
  $('#record-history').innerHTML = events.length ? events.map(e => `<p><strong>${escape(e.action.replaceAll('_', ' '))}</strong> · ${escape(dateLabel(e.created_at))}<br>${escape(Object.entries(e.detail || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))}</p>`).join('') : '<p class="small">Activity is recorded when you save or run a tool.</p>';
  if (record?.data._check) { const c = record.data._check; output('Latest saved page check', `HTTP ${c.status} · SEO checks ${c.score}/100\n${c.url}\nChecked ${c.checkedAt}\n${c.changed === null ? 'First baseline saved.' : c.changed ? 'HTML fingerprint changed since the last check. Dynamic page content can cause changes.' : 'HTML fingerprint unchanged.'}\n\n${c.fixes.join('\n')}`); }
  renderRecords();
}
async function openRecord(id, skipGuard = false) {
  if (!skipGuard && !(await mayLeave())) return;
  const token = epoch, sequence = ++recordEpoch, moduleId = selected?.id;
  try { const data = await api('?id=' + encodeURIComponent(id)); if (token !== epoch || sequence !== recordEpoch || selected?.id !== moduleId) return; fillEditor(data.record, data.events); }
  catch (e) { error(e); }
}
function formRecord() {
  const form = $('#record-form');
  const data = Object.fromEntries(selected.fields.map(f => [f.key, form.elements[f.key].value]));
  return { ...normaliseRecord({ service: selected.id, title: form.elements.title.value, status: form.elements.status.value, dueDate: form.elements.dueDate.value, data }), ...(current ? { id: current.id, version: current.version } : {}) };
}
function output(title, content, buttons = []) {
  $('#output-panel').hidden = false; $('#output-title').textContent = title; $('#tool-output').textContent = content; $('#output-actions').replaceChildren();
  for (const b of buttons) { const button = document.createElement('button'); button.className = 'button'; button.type = 'button'; button.textContent = b.label; button.addEventListener('click', b.run); $('#output-actions').append(button); }
}
function download(content, name, type = 'text/plain') {
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([content], { type })); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function filename(record, extension) { return 'blvck-oak-' + (record.title || selected.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '.' + extension; }
async function allRecords(service) {
  const found = []; const token = epoch;
  for (let start = 0; start < 10000; start += 100) { const data = await api('?list=1&offset=' + start + (service ? '&service=' + service : '')); if (token !== epoch) throw new Error('Sign-in changed. Export cancelled.'); found.push(...data.records); if (!data.hasMore) return found; }
  throw new Error('This export exceeds 10,000 records. Export individual tools instead.');
}
async function exportRecords(service) {
  if (busy) return; setBusy(true); state('Preparing your record export…');
  try { const rows = await allRecords(service); const keys = service ? toolById.get(service).fields.map(f => f.key) : [...new Set(rows.flatMap(r => Object.keys(r.data).filter(k => !k.startsWith('_'))))]; download(csvText([['id', 'tool', 'title', 'status', 'dueDate', 'updatedAt', ...keys], ...rows.map(r => [r.id, r.service, r.title, r.status, r.dueDate, r.updatedAt, ...keys.map(k => r.data[k])])]), 'blvck-oak-' + (service || 'business-tools') + '.csv', 'text/csv;charset=utf-8'); state(rows.length + ' saved records exported. Spreadsheet formulas are escaped.'); }
  catch (e) { error(e, '#status'); } finally { setBusy(false); }
}
async function runAction(action) {
  if (busy || !selected) return;
  try {
    if (action === 'connections') { await showView('connections'); return; }
    if (action === 'knowledge') { $('#knowledge-panel').hidden = !$('#knowledge-panel').hidden; return; }
    if (action === 'stock') { if (!current) throw new Error('Save this record before adjusting its balance.'); if (dirty) throw new Error('Save your edits before adjusting the balance.'); $('#stock-panel').hidden = !$('#stock-panel').hidden; return; }
    const record = formRecord();
    if (action === 'calculate') { const result = calculate(selected.id, record.data); output('Calculation for review', result.summary, result.dueDate ? [{ label: 'Use as due date', run: () => { $('#record-form').elements.dueDate.value = result.dueDate; dirty = true; state('Due date copied. Save the record to keep it.', false, '#record-status'); } }] : []); }
    else if (action === 'draft') {
      const draft = draftFor(selected.id, record); const target = $('#record-form').elements.output || $('#record-form').elements.message;
      output('Editable template · not AI generated', draft, target ? [{ label: 'Use in record', run: async () => { if (target.value && !(await confirmAction('Replace the working draft?', 'The current message/draft field will be replaced. Your other fields stay as entered.', 'Use template'))) return; target.value = draft; dirty = true; state('Draft copied into the editor. Review it, then save.', false, '#record-status'); } }] : []);
    }
    else if (action === 'document') { const html = recordDocument({ ...record, data: { ...record.data, ...(current?.data.stock !== undefined ? { stock: current.data.stock } : {}) } }); download(html, filename(record, 'html'), 'text/html'); state('Document downloaded. Open it in a browser to review or print to PDF.', false, '#record-status'); }
    else if (action === 'page') { const html = pageDocument(record); output('Your page is ready to review', 'A responsive HTML page has been generated from these fields. Download it and open it in a browser to preview. This action does not publish the page.', [{ label: 'Download page HTML', run: () => download(html, filename(record, 'html'), 'text/html') }]); }
    else if (action === 'calendar') { download(calendarFile(record), filename(record, 'ics'), 'text/calendar'); state('Calendar event downloaded. Import it into your calendar; no invitation has been sent.', false, '#record-status'); }
    else if (action === 'csv') { const result = cleanCsv(record.data.csv, record.data.dedupeColumn); output('Cleaned spreadsheet', result.summary, [{ label: 'Download cleaned CSV', run: () => download(result.csv, filename(record, 'csv'), 'text/csv;charset=utf-8') }]); }
    else if (action === 'reconcile') { const result = reconcile(record.data.invoices, record.data.payments); output('Reconciliation report', result.summary, [{ label: 'Download report CSV', run: () => download(csvText([['reference', 'result', 'invoice', 'payment'], ...result.rows]), filename(record, 'csv'), 'text/csv;charset=utf-8') }]); }
    else if (action === 'supplier') {
      const rows = supplierRows(record.data.csv); output('Supplier import preview', `${rows.length} valid product rows.\n\n` + rows.map(r => `${r.sku} · ${r.title} · cost ${r.cost} / price ${r.price}`).join('\n'), [{ label: 'Import private product records', run: async () => {
        if (busy) return; if (!current || dirty) { state('Save this import record before importing its products.', true, '#record-status'); return; }
        if (!(await confirmAction('Import these products?', `${rows.length} rows will be checked against your private product register. Existing SKUs are skipped. No products will be published.`, 'Import products'))) return;
        setBusy(true); try { const result = await post({ action: 'import_supplier', id: current.id, version: current.version }); state(result.message, false, '#record-status'); await load(); } catch (e) { error(e); } finally { setBusy(false); }
      } }]);
    }
    else if (action === 'report') { const s = snapshot.summary; output('Business-tool snapshot', `${s.total} saved records\n${s.open} open records\n${s.due} due / overdue\n${s.activeRules} active internal task rules\n${s.lowStock} stock records at or below threshold\n\nBy tool:\n` + snapshot.counts.map(c => `${toolById.get(c.service)?.title || c.service}: ${c.total} saved, ${c.open} open`).join('\n') + '\n\nThis snapshot covers the business toolkit. Customer leads, revenue and traffic are in the linked customer/analytics workspaces.'); }
    else if (action === 'check' || action === 'ai') {
      if (!current || dirty) throw new Error('Save this record before running the connected tool.');
      if (action === 'ai') {
        if (!snapshot.connections.find(c => c.id === 'ai')?.configured) { await showView('connections'); return; }
        if (!(await confirmAction('Request an AI draft?', 'The text in this saved record will be sent to your configured AI provider. Provider usage charges may apply. Review the returned draft before using it.', 'Generate draft'))) return;
      }
      setBusy(true); state(action === 'check' ? 'Checking the public page…' : 'Preparing an AI draft…', false, '#record-status');
      const result = await api('', { action: action === 'check' ? 'check' : 'ai_draft', id: current.id, version: current.version });
      if (action === 'check') { fillEditor(result.record); state('Page check saved. The result reflects this single request.', false, '#record-status'); }
      else output('AI draft · review before use', result.output, [{ label: 'Use in working draft', run: async () => { const target = $('#record-form').elements.output; if (target.value && !(await confirmAction('Replace the working draft?', 'The current output field will be replaced by this AI draft.', 'Use AI draft'))) return; target.value = result.output; dirty = true; state(result.note, false, '#record-status'); } }]);
    }
  } catch (e) { error(e); } finally { if (busy) setBusy(false); }
}
$('#record-form').addEventListener('input', () => { dirty = true; });
$('#record-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  try { const record = formRecord(); if (record.service === 'workflow-builder' && record.status === 'Active' && current?.status !== 'Active' && !(await confirmAction('Activate this internal task rule?', 'On the next scheduled run after its due date, this rule will create a task in ' + record.data.target + '. It will repeat ' + record.data.frequency.toLowerCase() + '. You can pause it from this record.', 'Activate and save'))) return; setBusy(true); const result = await post({ action: 'save', record }); fillEditor(result.record); state('Record saved privately. No message was sent or content published.', false, '#record-status'); await loadRecords(); await load(); }
  catch (e) { error(e); } finally { setBusy(false); }
});
$('#stock-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !current) return;
  setBusy(true); try { const form = event.currentTarget; const result = await post({ action: 'adjust', id: current.id, delta: Number(form.elements.delta.value), reason: form.elements.reason.value }); fillEditor(result.record); state('Balance adjustment recorded with its reason.', false, '#record-status'); await load(); }
  catch (e) { error(e); } finally { setBusy(false); }
});
$('#knowledge-search').addEventListener('click', async () => {
  if (busy) return; setBusy(true); const token = epoch;
  try { const rows = [...await allRecords('knowledge-chat'), ...await allRecords('receptionist')]; if (token !== epoch) return; const matches = searchKnowledge(rows, $('#knowledge-query').value); $('#knowledge-results').innerHTML = matches.map(({ record: r }) => `<article class="knowledge-result"><h4>${escape(r.data.question || r.title)}</h4><p>${escape(r.data.answer)}</p>${r.data.sourceUrl ? `<a href="${escape(r.data.sourceUrl)}" target="_blank" rel="noopener noreferrer">View saved source ↗</a>` : ''}</article>`).join('') || '<p class="small">No approved answer matched. Add or approve an answer, or refer the question to a person.</p>'; }
  catch (e) { error(e); } finally { setBusy(false); }
});
document.addEventListener('click', async event => {
  const tool = event.target.closest('[data-tool]'); if (tool) await openModule(tool.dataset.tool);
  const record = event.target.closest('[data-record]'); if (record) { if (selected?.id === record.dataset.service) await openRecord(record.dataset.record); else await openModule(record.dataset.service, record.dataset.record); }
  const cat = event.target.closest('[data-category]'); if (cat) { category = cat.dataset.category; renderLibrary(); }
  const tab = event.target.closest('[data-view]'); if (tab) await showView(tab.dataset.view);
  const action = event.target.closest('[data-action]'); if (action) await runAction(action.dataset.action);
});
$('#new-record').addEventListener('click', async () => { if (await mayLeave()) fillEditor(null); });
$('#reload-record').addEventListener('click', () => current && openRecord(current.id));
$('#back-library').addEventListener('click', () => showView('library'));
$('#tool-search').addEventListener('input', renderLibrary); $('#tool-filter').addEventListener('change', renderLibrary);
let searchTimer; $('#record-search').addEventListener('input', () => { clearTimeout(searchTimer); offset = 0; searchTimer = setTimeout(loadRecords, 250); });
$('#next-records').addEventListener('click', () => { offset += 100; loadRecords(); }); $('#previous-records').addEventListener('click', () => { offset = Math.max(0, offset - 100); loadRecords(); });
$('#refresh').addEventListener('click', async () => { if (busy) return; await load(); if (selected) await loadRecords(); else if (view === 'work') await showView('work'); });
$('#export-all').addEventListener('click', () => exportRecords()); $('#export-module').addEventListener('click', () => selected && exportRecords(selected.id));
$('#copy-output').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#tool-output').textContent); state('Result copied.', false, '#record-status'); } catch { state('Copy is unavailable. Select and copy the result text.', true, '#record-status'); } });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
await load();
