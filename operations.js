import { CHECKLIST, STAGES, customerDraft, leadWorkflow, operationsCsv, operationsReport, sydneyDate } from './operations-model.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formatDate = value => value ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(new Date(value.length === 10 ? `${value}T01:00:00Z` : value)) : 'Not recorded';
const requestId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
let snapshot = null, currentLead = null, loadVersion = 0, pending = false, newRequest = '', newValues = '';
let leadDirty = false, draftDirty = false;

function status(selector, message, error = false) {
  $(selector).textContent = message; $(selector).dataset.error = String(error);
}
async function api(path = '', body) {
  const response = await fetch('/api/owner-operations' + path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': snapshot?.csrf || '' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The owner workspace could not connect. Refresh or try again shortly.');
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'The request could not be completed.'); error.status = response.status; throw error; }
  return data;
}
function denyAccess(error) {
  snapshot = null; currentLead = null; loadVersion++;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  ['#lead-form', '#new-lead-form'].forEach(selector => $(selector).reset());
  ['#draft-subject', '#draft-body'].forEach(selector => { $(selector).value = ''; });
  ['#metrics', '#action-queue', '#lead-list', '#stage-report', '#configuration', '#lead-title', '#lead-contact', '#original-enquiry', '#booking-details', '#suggested-action', '#suggested-date', '#followup-note', '#report-coverage'].forEach(selector => $(selector).replaceChildren());
  $('#email-draft').removeAttribute('href'); $('#create-quote').removeAttribute('href');
  $('#workspace').hidden = true; $('#access-panel').hidden = false;
  $('#access-title').textContent = error.status === 401 ? 'Sign in to your owner account.' : 'This desk belongs to the business owner.';
  $('#access-copy').textContent = error.status === 401 ? 'Use the verified email you use to administer BLVCK OAK. Sign-in will bring you back here.' : 'Your current account cannot access customer records. Sign in using the configured owner email.';
  $('#access-link').href = error.status === 401 ? '/partners.html?next=%2Foperations.html' : '/partners.html';
  $('#access-link').textContent = error.status === 401 ? 'Sign in to open your desk ↗' : 'Manage sign-in / switch account ↗';
  status('#desk-status', 'Customer records are protected by owner verification.');
}
function handleError(error, target = '#desk-status') {
  if ([401, 403].includes(error.status)) denyAccess(error);
  else status(target, error.name === 'TimeoutError' ? 'The connection timed out. Your changes may not have completed; reload the saved record before trying again.' : error.message, true);
}
async function load() {
  const version = ++loadVersion;
  $('#refresh').disabled = true;
  try {
    const data = await api();
    if (version !== loadVersion) return;
    snapshot = data;
    $('#access-panel').hidden = true; $('#workspace').hidden = false;
    render();
    status('#desk-status', `Connected to your BLVCK OAK records · ${data.leads.length} lead${data.leads.length === 1 ? '' : 's'} loaded`);
    return true;
  } catch (error) {
    if (version !== loadVersion) return;
    handleError(error);
    if (snapshot && ![401, 403].includes(error.status)) status('#desk-status', 'Refresh failed. Showing the last loaded records — try again before making changes.', true);
  } finally { $('#refresh').disabled = false; }
}
function metric(label, value, note, number) {
  return `<article class="metric"><div class="metric-label">${label}<span>${number}</span></div><strong>${value}</strong><small>${note}</small></article>`;
}
function render() {
  const s = snapshot.summary;
  $('#metrics').innerHTML = metric('Needs a first response', s.needsReply, 'New enquiries to review', '01') + metric('Actions due', s.overdue + s.dueToday, `${s.overdue} overdue · ${s.dueToday} today`, '02') + metric('Open opportunities', s.open, 'Across your active pipeline', '03') + metric('Customers marked won', s.won, 'Ready for delivery & care', '04');
  renderQueue(); renderLeads(); renderReport();
  $('#configuration').innerHTML = `<span class="connection ${snapshot.configuration.email ? '' : 'missing'}">Email · ${snapshot.configuration.email ? 'configuration present' : 'setup required'}</span><span class="connection ${snapshot.configuration.payments ? '' : 'missing'}">Payments · ${snapshot.configuration.payments ? 'configuration present' : 'setup required'}</span>`;
  $('#last-updated').textContent = 'Updated ' + new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(snapshot.generatedAt));
}
function empty(title, copy) { return `<div class="empty-state"><h3>${title}</h3><p>${copy}</p></div>`; }
function renderQueue() {
  if (!snapshot) return;
  const filter = $('#queue-filter').value;
  const leads = snapshot.queue.map(id => snapshot.leads.find(lead => lead.id === id)).filter(lead => filter === 'all' || (filter === 'due' ? ['overdue', 'today'].includes(lead.workflow.urgency) : ['delivery', 'retention'].includes(lead.workflow.kind)));
  $('#queue-count').textContent = `${leads.length} next action${leads.length === 1 ? '' : 's'}`;
  $('#action-queue').innerHTML = leads.map(lead => `<button type="button" class="queue-card ${escape(lead.workflow.urgency)}" data-lead="${lead.id}"><span class="queue-date">${escape(formatDate(lead.workflow.dueDate).replace(/ \d{4}$/, ''))}<small>${lead.workflow.urgency === 'overdue' ? 'Overdue' : lead.workflow.urgency === 'today' ? 'Today' : 'Upcoming'}</small></span><span><strong>${escape(lead.workflow.title)}</strong><p>${escape(lead.name)}${lead.company ? ' · ' + escape(lead.company) : ''} · ${escape(STAGES[lead.status])}</p></span><span class="arrow" aria-hidden="true">↗</span></button>`).join('') || empty(snapshot.leads.length ? 'You’re clear in this view.' : 'Your next opportunity starts here.', snapshot.leads.length ? 'Choose “All next actions” to see upcoming work, or open the pipeline to review a customer.' : 'Website enquiries appear automatically. You can also add an enquiry from a call, email or conversation.');
}
function renderLeads() {
  if (!snapshot) return;
  const query = $('#lead-search').value.trim().toLowerCase(), stage = $('#lead-stage').value;
  const leads = snapshot.leads.filter(lead => (stage === 'all' || stage === lead.status) && (!query || [lead.name, lead.email, lead.company, lead.service].join(' ').toLowerCase().includes(query)));
  $('#lead-count').textContent = `${leads.length} of ${snapshot.leads.length} loaded leads`;
  $('#lead-list').innerHTML = leads.map(lead => `<button type="button" class="lead-card" data-lead="${lead.id}"><span><strong>${escape(lead.name)}</strong><p>${escape(lead.company || lead.email)}</p></span><span class="lead-service"><strong>${escape(lead.service || 'Project enquiry')}</strong><p>${escape(lead.type)} · ${escape(formatDate(lead.createdAt))}</p></span><span class="stage-badge ${escape(lead.status)}">${escape(STAGES[lead.status])}</span></button>`).join('') || empty('No leads in this view.', 'Try a different search or stage, or add a real enquiry to your pipeline.');
}
function renderReport() {
  const total = Math.max(1, snapshot.leads.length);
  $('#stage-report').innerHTML = Object.entries(snapshot.stages).map(([stage, count]) => `<div class="report-stage"><span>${STAGES[stage]}</span><progress class="report-track" max="${total}" value="${count}" aria-label="${STAGES[stage]}"></progress><strong>${count}</strong></div>`).join('');
  $('#report-coverage').textContent = `${snapshot.summary.receivedSevenDays} leads received in the last seven days. Human contact explicitly logged for ${snapshot.summary.loggedContacts} lead${snapshot.summary.loggedContacts === 1 ? '' : 's'}. Coverage: latest ${snapshot.leads.length} records, maximum ${snapshot.limit}.`;
}
function view(name) {
  document.querySelectorAll('[data-tab]').forEach(button => { const selected = button.dataset.tab === name; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  document.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== 'panel-' + name; });
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => view(button.dataset.tab)));
document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => { view(button.dataset.openView); $('#tab-' + button.dataset.openView).focus(); }));
$('.desk-tabs').addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...document.querySelectorAll('[data-tab]')];
  const index = buttons.indexOf(document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
  view(buttons[next].dataset.tab); buttons[next].focus();
});
$('#queue-filter').addEventListener('change', renderQueue);
$('#lead-search').addEventListener('input', renderLeads); $('#lead-stage').addEventListener('change', renderLeads);
$('#refresh').addEventListener('click', load);

function populateLead(lead, preserveDraft = false) {
  const keepDraft = preserveDraft && currentLead?.id === lead.id && draftDirty;
  currentLead = lead;
  leadDirty = false;
  const form = $('#lead-form'), a = lead.automation;
  $('#lead-title').textContent = lead.name; $('#lead-contact').textContent = [lead.company, lead.email, lead.phone].filter(Boolean).join(' · ');
  $('#lead-source').textContent = `${lead.type} / received ${formatDate(lead.createdAt)}`;
  $('#original-enquiry').textContent = lead.message || 'No enquiry details recorded.';
  $('#booking-details').textContent = lead.preferredDate ? `Requested consultation: ${formatDate(lead.preferredDate)} at ${lead.preferredTime || 'time to confirm'} (Sydney). This is a request, not a confirmed appointment.` : '';
  form.elements.status.value = lead.status; form.elements.ownerNote.value = lead.ownerNote || '';
  form.elements.nextAction.value = a.nextAction; form.elements.dueDate.value = a.dueDate;
  form.elements.launchDate.value = a.launchDate; form.elements.launchDate.max = sydneyDate();
  form.elements.followUpPaused.checked = a.followUpPaused; form.elements.followUpPaused.disabled = lead.type === 'manual';
  $('#onboarding-checklist').innerHTML = CHECKLIST.map(item => `<label class="checkbox"><input type="checkbox" name="check-${item.id}" ${a.checklist[item.id] ? 'checked' : ''}><span>${item.title}</span></label>`).join('');
  $('#onboarding-details').open = lead.status === 'won';
  $('#followup-note').textContent = lead.type === 'manual' ? 'Manual entries never enter the automatic email follow-up. Use a reviewed draft to contact this person.' : `${lead.followUpSentAt ? 'The one-time enquiry follow-up was recorded as sent on ' + formatDate(lead.followUpSentAt) + '.' : 'The existing scheduler can send one service-related follow-up to new web enquiries after 24 hours.'} Inbox replies are not synced. Log contact or pause this setting when you respond.`;
  $('#create-quote').href = '/partners.html?lead=' + encodeURIComponent(lead.id) + '#quote-editor';
  $('#log-contact').disabled = lead.status === 'lost';
  if (!keepDraft) $('#draft-type').value = lead.status === 'won' ? 'onboarding' : lead.status === 'qualified' ? 'proposal' : lead.status === 'contacted' ? 'followup' : 'reply';
  status('#detail-status', ''); status('#draft-status', ''); updateSuggestion();
  if (!keepDraft) renderDraft();
}
function updateSuggestion() {
  if (!currentLead) return;
  const form = $('#lead-form');
  const workflow = leadWorkflow({ ...currentLead, status: form.elements.status.value, ...(currentLead.status !== form.elements.status.value ? { statusChangedAt: new Date().toISOString() } : {}), automation: { ...currentLead.automation, nextAction: '', dueDate: '', launchDate: form.elements.launchDate.value, checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, form.elements['check-' + item.id].checked])) } });
  $('#suggested-action').textContent = workflow.title || 'No pending automatic action.';
  $('#suggested-date').textContent = workflow.dueDate ? `Suggested date: ${formatDate(workflow.dueDate)}` : 'Closed or completed workflow.';
}
async function openLead(id) {
  if (pending || !snapshot) return;
  pending = true;
  try {
    const data = await api('?lead=' + encodeURIComponent(id));
    if (!snapshot) return;
    snapshot.csrf = data.csrf; populateLead(data.lead);
    if (!$('#lead-dialog').open) $('#lead-dialog').showModal();
  } catch (error) { handleError(error, $('#lead-dialog').open ? '#detail-status' : '#desk-status'); }
  finally { pending = false; }
}
document.addEventListener('click', event => { const button = event.target.closest('[data-lead]'); if (button) openLead(button.dataset.lead); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { if (!pending) $('#' + button.dataset.close).close(); }));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); }));
$('#reload-lead').addEventListener('click', () => currentLead && openLead(currentLead.id));
$('#lead-form').addEventListener('change', updateSuggestion);
$('#lead-form').addEventListener('input', () => { leadDirty = true; });
$('#lead-form').addEventListener('change', () => { leadDirty = true; });
function detailBusy(value) {
  pending = value; $('#lead-fields').disabled = value; $('#log-contact').disabled = value || currentLead?.status === 'lost'; $('#reload-lead').disabled = value;
}
async function saveAction(body) {
  if (pending || !currentLead || !snapshot) return;
  detailBusy(true);
  status('#detail-status', 'Saving…');
  try {
    const data = await api('', { ...body, id: currentLead.id, revision: currentLead.automation.revision });
    populateLead(data.lead, true);
    status('#detail-status', body.action === 'log_contact' ? 'Contact recorded. Automatic enquiry follow-up is paused.' : 'Saved to your shared customer record.');
    await load();
  } catch (error) { handleError(error, '#detail-status'); }
  finally { detailBusy(false); }
}
$('#lead-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  saveAction({ action: 'save_lead', status: form.elements.status.value, ownerNote: form.elements.ownerNote.value, nextAction: form.elements.nextAction.value, dueDate: form.elements.dueDate.value, launchDate: form.elements.launchDate.value, followUpPaused: form.elements.followUpPaused.checked, checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, form.elements['check-' + item.id].checked])) });
});
$('#log-contact').addEventListener('click', () => {
  if (leadDirty) { status('#detail-status', 'Save your customer record edits before logging contact.', true); return; }
  saveAction({ action: 'log_contact' });
});
function renderDraft() {
  if (!currentLead) return;
  const draft = customerDraft(currentLead, $('#draft-type').value);
  draftDirty = false;
  $('#draft-subject').value = draft.subject; $('#draft-body').value = draft.body; status('#draft-status', ''); emailLink();
}
function emailLink() {
  if (!currentLead) return;
  $('#email-draft').href = `mailto:${encodeURIComponent(currentLead.email)}?subject=${encodeURIComponent($('#draft-subject').value.replace(/[\r\n]/g, ' '))}&body=${encodeURIComponent($('#draft-body').value)}`;
}
$('#draft-type').addEventListener('change', renderDraft);
$('#draft-subject').addEventListener('input', emailLink); $('#draft-body').addEventListener('input', emailLink);
$('#draft-subject').addEventListener('input', () => { draftDirty = true; }); $('#draft-body').addEventListener('input', () => { draftDirty = true; });
const draftText = () => `Subject: ${$('#draft-subject').value}\n\n${$('#draft-body').value}`;
$('#copy-draft').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(draftText()); status('#draft-status', 'Draft copied. Review it before sending.'); }
  catch { $('#draft-body').focus(); $('#draft-body').select(); status('#draft-status', 'Clipboard access is unavailable. The message is selected for you to copy, or download the draft.'); }
});
function download(content, name, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#download-draft').addEventListener('click', () => currentLead && download(draftText(), `BLVCK-OAK-${$('#draft-type').value}-${sydneyDate()}.txt`));
$('#export-report').addEventListener('click', () => snapshot && download(operationsReport(snapshot), `BLVCK-OAK-Operations-${snapshot.today}.txt`));
$('#export-csv').addEventListener('click', () => snapshot && download(operationsCsv(snapshot), `BLVCK-OAK-Pipeline-${snapshot.today}.csv`, 'text/csv;charset=utf-8'));
document.querySelectorAll('[data-add-lead]').forEach(button => button.addEventListener('click', () => {
  if (!snapshot) return;
  $('#new-lead-form').reset(); newRequest = requestId(); newValues = '';
  status('#new-lead-status', ''); $('#new-lead-dialog').showModal();
}));
$('#new-lead-form').addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !snapshot) return;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const serialized = JSON.stringify(values);
  if (newValues !== serialized) { newRequest = requestId(); newValues = serialized; }
  pending = true; $('#new-lead-fields').disabled = true;
  status('#new-lead-status', 'Saving the enquiry…');
  let createdId;
  try {
    const data = await api('', { action: 'create_lead', requestId: newRequest, ...values });
    $('#new-lead-dialog').close(); $('#new-lead-form').reset();
    await load(); createdId = data.lead.id;
    status('#desk-status', data.message);
  } catch (error) { handleError(error, '#new-lead-status'); }
  finally { pending = false; $('#new-lead-fields').disabled = false; }
  if (createdId && snapshot) await openLead(createdId);
});
setInterval(() => { if (!document.hidden && !pending && !document.querySelector('dialog[open]') && snapshot) load(); }, 60000);
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
load();
