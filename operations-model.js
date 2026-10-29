// Shared, deterministic business rules. No customer data or credentials live here.
export const TIME_ZONE = 'Australia/Sydney';
export const STAGES = Object.freeze({ new: 'New', contacted: 'Contacted', qualified: 'Qualified', booked: 'Booked', won: 'Won', lost: 'Closed / lost' });
export const CHECKLIST = Object.freeze([
  { id: 'scope', title: 'Confirm scope, price and payment terms' },
  { id: 'access', title: 'Arrange secure access to the required tools' },
  { id: 'assets', title: 'Collect the brief, brand assets and content' },
  { id: 'kickoff', title: 'Agree milestones and the kickoff date' },
  { id: 'testing', title: 'Test the agreed customer workflows' },
  { id: 'handover', title: 'Complete handover and record the launch date' },
  { id: 'checkin', title: 'Complete the 30-day customer check-in' },
]);
const DAY = 86400000;
const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && value >= '2000-01-01' && value <= '2100-12-31';
}
export function sydneyDate(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export function addDays(date, count) {
  return new Date(Date.parse(date + 'T00:00:00Z') + count * DAY).toISOString().slice(0, 10);
}
function validStamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; }
export function readAutomation(lead) {
  const value = lead.automation || {};
  return {
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    nextAction: text(value.nextAction, 180),
    dueDate: validDate(value.dueDate) ? value.dueDate : '',
    launchDate: validDate(value.launchDate) ? value.launchDate : '',
    followUpPaused: value.followUpPaused === true || lead.type === 'manual',
    firstContactAt: validStamp(value.firstContactAt),
    lastContactAt: validStamp(value.lastContactAt),
    checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, value.checklist?.[item.id] === true])),
  };
}
export function leadWorkflow(lead, now = Date.now()) {
  const automation = readAutomation(lead);
  const today = sydneyDate(now);
  const stamp = validStamp(lead.statusChangedAt) || validStamp(lead.createdAt);
  const stageDay = stamp ? sydneyDate(stamp) : today;
  let title = '', dueDate = '', kind = 'sales';
  if (lead.status === 'new') {
    title = lead.type === 'booking' ? 'Confirm the requested consultation' : lead.type === 'audit' ? 'Review the audit and prepare a personal response' : 'Review the enquiry and reply';
    dueDate = addDays(stageDay, 1);
  } else if (lead.status === 'contacted') {
    title = 'Check for a reply and decide the next step';
    dueDate = addDays(automation.lastContactAt ? sydneyDate(automation.lastContactAt) : stageDay, 3);
  } else if (lead.status === 'qualified') {
    title = 'Prepare the scope and written quote'; dueDate = addDays(stageDay, 1);
  } else if (lead.status === 'booked') {
    title = 'Prepare for the consultation'; dueDate = validDate(lead.preferredDate) ? lead.preferredDate : addDays(stageDay, 1);
  } else if (lead.status === 'won') {
    kind = 'delivery';
    const next = CHECKLIST.filter(item => item.id !== 'checkin').find(item => !automation.checklist[item.id]);
    if (next) { title = next.title; dueDate = addDays(stageDay, 1); }
    else if (!automation.launchDate) { title = 'Record the launch date for the customer check-in'; dueDate = today; }
    else if (!automation.checklist.checkin) { title = 'Check in with the customer after launch'; dueDate = addDays(automation.launchDate, 30); kind = 'retention'; }
  }
  if (lead.status !== 'lost' && (automation.nextAction || automation.dueDate)) {
    title = automation.nextAction || title || 'Review this customer';
    dueDate = automation.dueDate || dueDate || today;
  }
  return {
    ...automation, title, dueDate, kind,
    automatic: !automation.nextAction && !automation.dueDate,
    urgency: !title ? 'none' : dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'upcoming',
    checklistDone: CHECKLIST.filter(item => automation.checklist[item.id]).length,
  };
}
export function followUpEligible(lead, now = Date.now()) {
  const age = now - Date.parse(lead.createdAt);
  return lead.status === 'new' && !readAutomation(lead).followUpPaused && !lead.followUpSentAt && Number.isFinite(age) && age >= DAY && age <= 7 * DAY;
}
export function operationsSnapshot(leads, now = Date.now()) {
  const rows = leads.map(lead => ({ ...lead, automation: readAutomation(lead), workflow: leadWorkflow(lead, now) }));
  const queue = rows.filter(lead => lead.workflow.title).sort((a, b) => a.workflow.dueDate.localeCompare(b.workflow.dueDate) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const counts = Object.fromEntries(Object.keys(STAGES).map(stage => [stage, rows.filter(lead => lead.status === stage).length]));
  const summary = {
    total: rows.length, open: rows.filter(lead => !['won', 'lost'].includes(lead.status)).length,
    needsReply: counts.new, won: counts.won,
    overdue: queue.filter(lead => lead.workflow.urgency === 'overdue').length,
    dueToday: queue.filter(lead => lead.workflow.urgency === 'today').length,
    receivedSevenDays: rows.filter(lead => Date.parse(lead.createdAt) >= now - 7 * DAY && Date.parse(lead.createdAt) <= now).length,
    loggedContacts: rows.filter(lead => lead.automation.firstContactAt).length,
  };
  return { generatedAt: new Date(now).toISOString(), today: sydneyDate(now), timeZone: TIME_ZONE, summary, stages: counts, leads: rows, queue: queue.map(lead => lead.id), limit: 250 };
}
export const DRAFT_TYPES = Object.freeze({ reply: 'First response', followup: 'Follow-up', proposal: 'Scope / proposal', onboarding: 'Customer onboarding', checkin: 'Customer check-in' });
export function customerDraft(lead, type = 'reply') {
  const name = text(lead.name, 100) || 'there';
  const service = text(lead.service, 120) || 'your project';
  const business = text(lead.company, 120) || 'your business';
  const sign = '\n\nSam | BLVCK OAK\nhttps://blvckoak.com.au';
  const intro = `Hi ${name},\n\n`;
  const drafts = {
    reply: { subject: `Your BLVCK OAK enquiry — ${service}`, body: intro + `Thanks for getting in touch about ${service}. To help shape the right solution for ${business}, could you tell me:\n\n• What is the main result you want?\n• What tools or process do you use today?\n• Do you have a timeframe and budget in mind?\n\nI’ll review your requirements and confirm the scope and next step. If a call is easier, you can request one at https://blvckoak.com.au/book.html.` + sign },
    followup: { subject: 'Following up on your BLVCK OAK enquiry', body: intro + `Just checking whether you had any questions about ${service}, or anything you would like clarified before the next step.\n\nIf your plans or timing have changed, let me know and I’ll update my notes.` + sign },
    proposal: { subject: `Draft project scope — ${service}`, body: `DRAFT FOR OWNER REVIEW\n\nClient: ${name}\nBusiness: ${business}\nProject: ${service}\n\nCLIENT REQUIREMENTS\n${text(lead.message, 2100) || 'Confirm requirements with the client.'}\n\nSCOPE TO AGREE\n• Outcome and success criteria\n• Deliverables and supported integrations\n• Access, content and client responsibilities\n• Review points, testing and handover\n\nCOMMERCIAL TERMS TO COMPLETE\nFinal price, GST treatment, milestones, payment terms, provider fees, exclusions and ongoing support must be confirmed before this is issued.\n\nCreate the reviewed quote in the existing Quotes & payments workspace. This draft does not create a payment link or an agreement.` },
    onboarding: { subject: `Getting started — ${service}`, body: intro + `I’m preparing the next steps for ${service}. Please gather your business brief, brand assets and any content we have agreed to use.\n\nWe’ll confirm the scope, payment terms, milestones and kickoff date together. For access to your tools, please use secure invitations rather than emailing passwords.\n\nLet me know who should review the work and approve each milestone.` + sign },
    checkin: { subject: 'How is everything working for you?', body: intro + `I wanted to check how ${service} is working for ${business}. Is anything causing friction, or is there one thing you would like to improve?\n\nReply with any feedback and I’ll help work out the next step.` + sign },
  };
  return drafts[type] || drafts.reply;
}
export function operationsReport(snapshot) {
  const { summary: s } = snapshot;
  return `BLVCK OAK — OPERATIONS SNAPSHOT\nGenerated: ${snapshot.generatedAt}\nDates: Australia/Sydney\nCoverage: latest ${snapshot.leads.length} leads (maximum ${snapshot.limit}). Snapshot counts are not a historical conversion funnel.\n\nOpen opportunities: ${s.open}\nNew / awaiting review: ${s.needsReply}\nOverdue next actions: ${s.overdue}\nDue today: ${s.dueToday}\nMarked won: ${s.won}\nReceived in the last seven days: ${s.receivedSevenDays}\nLeads with a human contact explicitly logged: ${s.loggedContacts}\n\nPIPELINE\n${Object.entries(snapshot.stages).map(([stage, count]) => `${STAGES[stage]}: ${count}`).join('\n')}\n\nNEXT ACTIONS\n${snapshot.queue.map(id => { const lead = snapshot.leads.find(item => item.id === id); return `${lead.workflow.dueDate} | ${lead.name} | ${lead.workflow.title}`; }).join('\n') || 'No pending next actions.'}\n\nFollow-up drafts are prepared for review. Inbox replies are not synced automatically; log contact and update status after responding. Payment confirmation remains in the existing Stripe-backed workspace.`;
}
export function operationsCsv(snapshot) {
  const cell = value => { const content = String(value ?? ''); return '"' + (/^\s*[=+@-]|^[\t\r\n]/.test(content) ? "'" : '') + content.replaceAll('"', '""') + '"'; };
  const rows = [['Name', 'Email', 'Business', 'Stage', 'Source', 'Next action', 'Due date (Sydney)', 'Last contact', 'Launch date'], ...snapshot.leads.map(lead => [lead.name, lead.email, lead.company, STAGES[lead.status], lead.type, lead.workflow.title, lead.workflow.dueDate, lead.automation.lastContactAt, lead.automation.launchDate])];
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}
