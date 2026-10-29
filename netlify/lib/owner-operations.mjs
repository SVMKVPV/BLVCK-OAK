import { CHECKLIST, STAGES, readAutomation, validDate, sydneyDate } from '../../operations-model.js';
import { PortalError } from './portal-auth.mjs';
import { leadIdPattern, publicLead } from './sales-leads.mjs';

function bounded(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new PortalError(`Check ${label}.`);
  return value.trim();
}
function dateField(value, label) {
  if (value !== '' && !validDate(value)) throw new PortalError(`Choose a valid ${label}.`);
  return value;
}
export async function saveLeadOperations(store, body, accountId, now = Date.now()) {
  if (!leadIdPattern.test(body.id || '')) throw new PortalError('Invalid lead.');
  const entry = await store.getWithMetadata(`lead/${body.id}`, { type: 'json' });
  if (!entry?.data) throw new PortalError('Lead not found.', 404);
  const lead = entry.data, current = readAutomation(lead);
  if (!Number.isSafeInteger(body.revision) || body.revision !== current.revision) throw new PortalError('This lead changed in another view. Refresh before saving.', 409);
  const stamp = new Date(now).toISOString();
  let automation, status, ownerNote = lead.ownerNote || '';
  if (body.action === 'log_contact') {
    if (lead.status === 'lost') throw new PortalError('Reopen the lead before logging contact.');
    status = lead.status === 'new' ? 'contacted' : lead.status;
    automation = { ...current, firstContactAt: current.firstContactAt || stamp, lastContactAt: stamp, followUpPaused: true, nextAction: '', dueDate: '' };
  } else {
    if (!Object.hasOwn(STAGES, body.status)) throw new PortalError('Choose a valid lead status.');
    status = body.status;
    ownerNote = bounded(body.ownerNote, 1000, 'the private note');
    if (typeof body.followUpPaused !== 'boolean' || !body.checklist || typeof body.checklist !== 'object' || Array.isArray(body.checklist)) throw new PortalError('Check the workflow settings.');
    const launchDate = dateField(body.launchDate, 'launch date');
    if (launchDate && launchDate > sydneyDate(now)) throw new PortalError('Record the actual launch date after launch.');
    for (const item of CHECKLIST) if (typeof body.checklist[item.id] !== 'boolean') throw new PortalError('Check the onboarding checklist.');
    automation = {
      ...current, nextAction: bounded(body.nextAction, 180, 'the next action'), dueDate: dateField(body.dueDate, 'due date'),
      launchDate, followUpPaused: body.followUpPaused || lead.type === 'manual',
      checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, body.checklist[item.id]])),
    };
  }
  automation.revision = current.revision + 1;
  const updated = { ...lead, status, ownerNote, automation, updatedAt: stamp, updatedBy: accountId, ...(status !== lead.status ? { statusChangedAt: stamp } : {}) };
  const saved = await store.setJSON(`lead/${lead.id}`, updated, { onlyIfMatch: entry.etag });
  if (!saved.modified) throw new PortalError('This lead changed. Refresh before saving.', 409);
  return publicLead(updated);
}
