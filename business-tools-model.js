import { services, serviceById, categories } from './automation-catalog.js';
export { categories };

const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const text = (key, label, extra) => field(key, label, 'textarea', extra);
const number = (key, label, extra) => field(key, label, 'number', extra);
const select = (key, label, options) => field(key, label, 'select', { options });
const contact = [field('customer', 'Customer / organisation'), field('email', 'Contact email', 'email')];
const assignment = [field('assignee', 'Responsible person'), field('reference', 'Job / project reference')];
const brief = [text('brief', 'Brief / approved facts'), text('output', 'Working draft')];
const channel = select('channel', 'Channel', ['Website', 'Email', 'Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'Other']);
const url = (key, label) => field(key, label, 'url');
const money = (key, label) => number(key, label + ' (AUD)', { min: 0, step: '0.01' });
const message = [...contact, field('subject', 'Subject'), text('message', 'Message'), field('consent', 'Consent / reason for contact'), field('lastContact', 'Last contact', 'date')];
const page = [field('headline', 'Headline'), text('intro', 'Introduction'), text('sections', 'Sections — one heading | description per line'), text('links', 'Links — one label | https://address per line'), field('cta', 'Call to action'), url('ctaUrl', 'Call-to-action URL')];
const csv = (key, label, placeholder) => text(key, label, { placeholder, max: 30000 });
const task = [...assignment, text('brief', 'Instructions / scope'), text('checklist', 'Checklist — one task per line'), text('output', 'Progress / outcome')];
const product = [field('sku', 'SKU'), field('supplier', 'Supplier'), text('description', 'Product description'), money('cost', 'Unit cost'), money('price', 'Selling price'), url('assetUrl', 'Product / asset link')];
const dateTime = (key, label) => field(key, label + ' (Sydney local time)', 'datetime-local');
const amountRecord = [...contact, field('reference', 'Reference'), money('amount', 'Amount'), number('tax', 'Tax amount entered (AUD)', { min: 0, step: '0.01' }), field('transactionDate', 'Transaction date', 'date')];
const definitions = {};
function define(ids, fields, options = {}) {
  for (const id of ids.split(' ')) definitions[id] = { fields, statuses: ['Draft', 'In progress', 'Review', 'Done', 'Archived'], actions: ['document'], now: 'Save, organise and export your own records, with dates, status and a responsible person.', ...options };
}

define('crm pipeline follow-up onboarding', task, { link: '/operations.html', linkLabel: 'Open live customer desk', now: 'Use the existing shared lead records, next actions, contact drafts and delivery checklists. This workboard stores additional planning notes.', later: 'Inbox reply detection and customer file uploads need an additional integration.' });
define('instant-quote proposal', [...contact, ...brief], { link: '/automation.html#finder', linkLabel: 'Open guided estimates', now: 'Use the live service estimator and existing customer quote workspace. Save proposal briefs here.', later: 'Review the final scope and price in Quotes & payments before sharing with a customer.' });
define('booking', [...contact, dateTime('start', 'Start'), dateTime('end', 'End'), url('meeting', 'Meeting link'), text('brief', 'Appointment notes')], { actions: ['calendar', 'document'], link: '/book.html', linkLabel: 'Open booking enquiry form', now: 'Record appointments and download calendar events. Existing booking enquiries still arrive in your customer desk.', providers: ['calendar'], later: 'Live availability, calendar sync and automatic rescheduling need a calendar connection.' });
define('referrals partner-portal commissions', [...contact, money('sale', 'Eligible sale'), number('rate', 'Commission rate (%)', { min: 0, max: 100 }), text('brief', 'Eligibility / exclusions')], { actions: ['calculate', 'document'], link: '/partners.html', linkLabel: 'Open partner workspace', now: 'Use the current partner/referral system, or calculate a draft commission from an eligible sale and rate. A calculation does not create a payout.' });
define('reviews', [...message, url('reviewUrl', 'Public review link')], { actions: ['draft', 'document'], now: 'Prepare neutral review invitations, record the request date and track replies. Invitations are available to every customer, regardless of sentiment.', later: 'Send reviewed drafts through your email app. Automatic delivery and review ingestion are not connected.' });
define('reactivation checkout-recovery email-marketing payment-reminders', message, { actions: ['draft', 'document'], providers: ['email'], now: 'Prepare individual messages and track consent, reference and contact dates. Review and send in your email app.', later: 'Bulk campaigns, subscription preferences, payment-state sync and automated sends need a configured campaign workflow. Saving here never sends a message.' });
define('content-planner social-publishing', [channel, field('audience', 'Audience'), field('offer', 'Offer / topic'), text('brief', 'Approved facts / brand voice'), text('output', 'Caption'), url('assetUrl', 'Media asset link')], { actions: ['draft', 'ai', 'document'], now: 'Plan dated posts, prepare editable captions and track production status. Export a content calendar.', providers: ['ai', 'social'], later: 'AI drafting needs an AI key. Publishing and live delivery results need connected social accounts.' });
define('video-workflow blog-workflow ad-creative', [field('audience', 'Audience'), field('offer', 'Topic / offer'), ...brief, url('assetUrl', 'Approved media link')], { actions: ['draft', 'ai', 'document'], providers: ['ai'], now: 'Build editable scripts, shot lists, article outlines and ad-copy variations from a structured brief.', later: 'AI rewriting needs an AI key. Video rendering, image generation and publishing require their production tools.' });
define('landing-generator link-in-bio website-builder', page, { actions: ['page', 'document'], now: 'Generate and download a complete responsive HTML page from your approved text and links. Preview the same file before publishing.', later: 'Generated files are drafts. Hosting them under a new URL, custom forms and custom-domain publishing are separate release steps.' });
define('seo-monitoring competitor-monitoring website-monitoring', [url('website', 'Public page URL'), text('brief', 'What to watch'), text('output', 'Latest check / observations')], { actions: ['check', 'document'], now: 'Run a live public-page check, record SEO checks and compare the page fingerprint with the previous check. Set a dated task for the next review.', later: 'Checks run when you click. Search Console rankings, scheduled crawling and competitive intelligence feeds are not connected.' });
define('campaign-reporting', [field('campaign', 'Campaign'), money('spend', 'Spend'), number('impressions', 'Impressions', { min: 0, integer: true }), number('clicks', 'Clicks', { min: 0, integer: true }), number('leads', 'Leads', { min: 0, integer: true }), money('revenue', 'Attributed revenue'), text('brief', 'Source / attribution window')], { actions: ['calculate', 'document'], link: '/analytics.html', linkLabel: 'Open live website analytics', now: 'Calculate CTR, cost per lead and return on ad spend from entered totals; use your existing analytics for live website traffic.', later: 'Ad-platform spend and conversion imports need account connections.' });
define('brand-portal documents', [field('reference', 'Document / asset reference'), field('assignee', 'Owner'), url('assetUrl', 'Approved file link'), ...brief], { actions: ['draft', 'document'], now: 'Keep a private index of approved assets and reusable document drafts. Export formatted, printable documents.', later: 'Links retain the permissions of their original storage provider; file hosting and client sharing are not added by this index.' });
define('receptionist knowledge-chat', [field('question', 'Approved question'), text('answer', 'Approved answer'), url('sourceUrl', 'Source / supporting page'), text('keywords', 'Alternative phrases'), field('assignee', 'Escalation contact')], { actions: ['knowledge', 'document'], statuses: ['Draft', 'Approved', 'Archived'], now: 'Build and search your private approved question-and-answer library. The matcher quotes saved answers and shows their source.', later: 'A public website chat widget, lead capture and AI conversation routing need a separate public rollout. This private library is not exposed to visitors.' });
define('email-assistant translation document-ai', [field('language', 'Target language / output format'), text('brief', 'Instructions / approved context'), text('source', 'Source text — paste only what may be sent to your AI provider'), text('output', 'Reviewed output')], { actions: ['ai', 'document'], providers: ['ai'], now: 'Save source text and reviewed responses. After AI setup, request a draft translation, reply or structured text extraction.', later: 'AI generation needs a configured model and API key. Inbox sync, attachments, OCR and automatic sending are not connected.' });
define('tickets complaints shared-inbox', [...contact, ...assignment, select('priority', 'Priority', ['Normal', 'High', 'Urgent']), channel, text('brief', 'Request / complaint'), text('output', 'Response / resolution')], { actions: ['draft', 'document'], statuses: ['New', 'Assigned', 'Waiting', 'Resolved', 'Archived'], now: 'Track requests, responsibilities, deadlines and resolutions. Prepare a response for review.', providers: ['inbox'], later: 'Records are entered here. Incoming mailbox and social-channel messages need account connections; assignee names do not grant account access.' });
define('sms-reminders whatsapp voice-receptionist', [field('customer', 'Customer'), field('phone', 'Phone in international format'), field('consent', 'Consent / service context'), text('brief', 'Message / call-routing instructions'), text('output', 'Script / conversation notes')], { actions: ['draft', 'document'], providers: ['phone'], now: 'Prepare messages, call scripts and handoff instructions, then track your own communications.', later: 'Phone numbers, SMS delivery, WhatsApp approval, call handling and delivery callbacks require a communications-provider connection.' });
define('invoices', [...contact, field('reference', 'Invoice / job reference'), field('abn', 'Your ABN (if applicable)'), text('address', 'Billing address'), csv('items', 'Line items — description | quantity | unit price AUD | tax rate %', 'Website setup | 1 | 1200 | 0'), text('terms', 'Payment terms / approved payment link')], { actions: ['calculate', 'document'], now: 'Calculate itemised draft invoices using your entered prices and tax rates. Download a printable document.', link: '/partners.html', linkLabel: 'Open approved quotes & payments', later: 'Invoice status here is a manual record. Accounting sync, issuing tax invoices and payment confirmation stay in your accounting/payment system.' });
define('subscriptions memberships', [...contact, field('plan', 'Plan / membership'), money('amount', 'Agreed recurring amount'), select('frequency', 'Frequency', ['Monthly', 'Quarterly', 'Yearly']), field('renewal', 'Renewal date', 'date'), text('brief', 'Entitlements / cancellation terms')], { now: 'Maintain membership and subscription registers with renewal dates and agreed terms.', providers: ['payments'], later: 'This register does not charge customers or grant access. Recurring checkout, billing webhooks and member permissions require a connected billing rollout.' });
define('instalments', [...contact, money('total', 'Agreed total'), money('paid', 'Recorded paid amount'), number('parts', 'Remaining instalments', { min: 1, max: 100, integer: true }), text('brief', 'Payment reference / notes')], { actions: ['calculate', 'document'], link: '/partners.html', linkLabel: 'Open live payment plans', now: 'Use the existing 15-part payment plans, or calculate a planning balance from entered figures. Entered amounts are not payment confirmation.' });
define('expenses gst-tax', [...amountRecord, field('category', 'Expense / transaction category'), select('direction', 'Direction', ['Expense', 'Income']), url('receipt', 'Receipt / source link'), text('brief', 'Review notes')], { actions: ['calculate', 'document'], now: 'Record transactions and their explicitly entered tax component. Export totals for review with source links.', later: 'No tax classification is inferred. Bank feeds, receipt OCR and lodgement are not connected.' });
define('cashflow', [money('opening', 'Opening balance'), money('incoming', 'Expected incoming'), money('outgoing', 'Expected outgoing'), field('period', 'Forecast period'), text('brief', 'Assumptions / source')], { actions: ['calculate', 'document'], now: 'Calculate a cash-flow scenario from an opening balance and expected inflows/outflows. Save multiple scenarios.', later: 'Figures are entered assumptions, not synced bank balances.' });
define('reconciliation', [csv('invoices', 'Invoices CSV: reference,amount', 'reference,amount\nINV-001,1200.00'), csv('payments', 'Payments CSV: reference,amount', 'reference,amount\nINV-001,1200.00')], { actions: ['reconcile', 'document'], now: 'Match unique references and exact amounts from pasted CSVs. Flag duplicates, mismatches and unmatched entries for manual review.', later: 'The report does not alter invoices, bank records or payment statuses.' });
define('purchase-approvals approvals', [...assignment, field('requester', 'Requested by'), money('amount', 'Requested spend'), text('brief', 'Business reason / request'), text('output', 'Owner decision and reasoning')], { statuses: ['Requested', 'Review', 'Approved', 'Rejected', 'Archived'], now: 'Keep dated requests and your recorded decisions with an audit trail. Export the decision record.', later: 'These are owner-recorded approvals. Multi-user delegation and spending authority rules require team access setup.' });
define('renewals', [...assignment, field('supplier', 'Provider'), money('amount', 'Renewal cost'), field('expiry', 'Expiry date', 'date'), number('noticeDays', 'Notice period in days', { min: 0, max: 365, integer: true }), text('brief', 'Renewal / cancellation instructions')], { actions: ['calculate', 'document'], now: 'Track expiry and cancellation notice dates. Calculate the action deadline and add it to the work queue.' });
define('online-store marketplace', product, { link: '/marketplace.html', linkLabel: 'Open existing marketplace', now: 'Use your existing marketplace and keep a private product catalogue with costs, prices and approved assets.', providers: ['payments'], later: 'Records here do not automatically create public products or seller accounts. New product checkout and seller settlement require a store integration.' });
define('digital-delivery', [...contact, field('order', 'Verified order / payment reference'), url('assetUrl', 'Protected product location'), text('brief', 'Access rules / delivery instructions'), text('output', 'Delivery record')], { now: 'Keep a fulfilment register linking verified purchase references to delivery records.', providers: ['payments'], later: 'Automated paid downloads require a verified payment webhook, private file storage and expiring download links. Do not put unprotected paid-download URLs on public pages.' });
define('inventory warehouse', [field('sku', 'SKU'), field('location', 'Stock location'), number('reorder', 'Low-stock threshold', { min: 0, integer: true }), money('cost', 'Unit cost'), text('brief', 'Stock / handling notes')], { actions: ['stock', 'document'], now: 'Maintain a stock ledger with atomic adjustments, reasons and duplicate protection. Negative stock is rejected. Low-stock flags use your threshold.', later: 'Adjust stock explicitly. Orders, supplier feeds and scanners do not change stock automatically.' });
define('supplier-import', [field('supplier', 'Supplier'), csv('csv', 'Supplier CSV: sku,title,cost,price', 'sku,title,cost,price\nOAK-001,Sample product,10.00,25.00'), text('output', 'Validation / change review')], { actions: ['supplier', 'document'], now: 'Validate supplier CSVs, detect duplicate SKUs and review product rows before importing them into the private product register.', later: 'Imports do not publish products or change existing stock. Existing SKUs are skipped and reported.' });
define('pricing-rules', [money('cost', 'Unit cost'), number('margin', 'Target gross margin (%)', { min: 0, max: 99.99 }), money('floor', 'Minimum price'), money('ceiling', 'Maximum price (0 = no cap)'), text('brief', 'Pricing assumptions')], { actions: ['calculate', 'document'], now: 'Calculate a proposed price from cost and gross margin, with minimum and maximum limits. Conflicting limits are rejected.', later: 'Calculated prices are drafts; they are not pushed to a store.' });
define('fulfilment returns dispatch', [...contact, field('reference', 'Order / job reference'), field('assignee', 'Responsible person'), text('items', 'Items / quantities'), text('address', 'Address / destination'), url('tracking', 'Tracking / supporting link'), text('brief', 'Instructions / return reason'), text('output', 'Outcome')], { statuses: ['New', 'Review', 'Ready', 'In progress', 'Done', 'Archived'], now: 'Track orders, returns and dispatch with item lists, responsibilities and evidence. Generate printable pick lists and handoff notes.', later: 'Courier bookings, refunds and customer-facing returns forms need their integrations.' });
define('loyalty', [...contact, field('reference', 'Member reference'), text('brief', 'Agreed points / reward rules')], { actions: ['stock', 'document'], now: 'Maintain a points ledger with atomic additions/redemptions and reasons. Duplicate adjustments and negative balances are prevented.', later: 'Points changes are entered by you; purchase events and reward checkout are not connected.' });
define('job-management projects field-service maintenance safety recruitment training', task, { now: 'Manage jobs, projects, checklists, maintenance, incident follow-up, hiring tasks or training records with assignees and due dates. Export a printable work pack.', later: 'This is your private owner workboard. Staff logins, attachments, GPS tracking and specialist policy checks require additional setup.' });
define('rostering timesheets', [...assignment, dateTime('start', 'Start'), dateTime('end', 'End'), number('breakMinutes', 'Unpaid break (minutes)', { min: 0, max: 1440, integer: true }), money('hourlyRate', 'Planning hourly rate'), text('brief', 'Shift / work completed')], { actions: ['calculate', 'calendar', 'document'], now: 'Record shifts and timesheets, calculate wall-clock hours less breaks and a planning cost, then export records or calendar events.', later: 'Cost is a simple estimate, not award/payroll processing. Check daylight-saving transitions, overtime, leave and entitlements in payroll.' });
define('workflow-builder', [select('target', 'Create task in', ['projects', 'job-management', 'maintenance', 'training', 'renewals', 'content-planner', 'tickets']), select('frequency', 'Repeat', ['Once', 'Daily', 'Weekly', 'Monthly']), field('nextRun', 'Next run date (Sydney)', 'date'), field('assignee', 'Responsible person'), text('brief', 'Task instructions')], { statuses: ['Draft', 'Active', 'Paused', 'Done', 'Archived'], actions: ['document'], now: 'Activate a dated rule to create internal work items automatically. Runs are recorded once per rule/date. Pause a rule to stop future tasks.', later: 'Rules create internal records only. They do not send messages, charge customers or publish content. Monthly dates clamp to the last day of shorter months.' });
define('reports customer-analytics', [field('period', 'Reporting period'), text('brief', 'Questions / observations'), text('output', 'Report narrative')], { actions: ['report', 'document'], link: '/analytics.html', linkLabel: 'Open live website analytics', now: 'Summarise your saved business-tool records and export them. Existing analytics and the customer desk remain the source for traffic and lead reports.' });
define('spreadsheets', [csv('csv', 'CSV data', 'name,email,amount\nExample,person@example.test,100'), field('dedupeColumn', 'Deduplicate by column (optional)'), text('output', 'Cleanup report')], { actions: ['csv', 'document'], now: 'Parse quoted CSV, trim values, flag uneven rows, remove exact duplicates and optionally keep the first row per selected key. Download cleaned CSV with spreadsheet-formula protection.' });
define('integration-health', [field('provider', 'Provider / system'), url('dashboard', 'Provider dashboard URL'), text('brief', 'Expected behaviour / runbook'), text('output', 'Incident / resolution')], { actions: ['connections', 'document'], now: 'See which runtime credentials are present and keep an incident log. Presence checks are explicitly distinguished from successful connections.', later: 'Provider health, quotas and live API success require a test after connection.' });
define('client-portal', [...contact, ...task], { link: '/partners.html', linkLabel: 'Open existing project progress', now: 'Use existing quote-linked project progress for customers. Keep private handoff and access notes here.', later: 'New shared files, client editing and additional tenant permissions need a client-access rollout.' });
define('white-label', [field('client', 'Client / workspace name'), field('domain', 'Proposed domain'), field('brand', 'Brand name'), text('modules', 'Required tools / entitlements'), text('brief', 'Brand, access and billing requirements')], { now: 'Keep each proposed client rollout, branding brief, required modules and launch tasks in an organised register.', later: 'This register does not provision a SaaS tenant. Isolated tenant authentication, billing, custom domains and permissions require a separate deployment.' });

export const tools = services.map(service => {
  if (!definitions[service.id]) throw new Error('Missing business tool: ' + service.id);
  return { ...service, ...definitions[service.id] };
});
export const toolById = new Map(tools.map(tool => [tool.id, tool]));
export const providerDefinitions = [
  { id: 'email', name: 'Email', keys: ['RESEND_API_KEY', 'EMAIL_FROM'], use: 'Existing website email and customer notifications', setup: 'Verify the sending domain and sender in Resend. Campaign lists and unsubscribe handling must be configured before marketing automation.' },
  { id: 'payments', name: 'Payments', keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], use: 'Existing quotes, checkout and payment plans', setup: 'Use the existing Stripe workspace. New subscriptions, store events and paid-access rules need their own verified webhook mapping.' },
  { id: 'ai', name: 'AI drafting', keys: ['OPENAI_API_KEY', 'OPENAI_MODEL'], use: 'Optional text drafts, translation and extraction', setup: 'Add a project API key and a supported text model in the hosting environment, then redeploy. Only a draft you explicitly request is sent to this provider.' },
  { id: 'calendar', name: 'Calendars', keys: [], use: 'Calendar event downloads work now', setup: 'Choose a calendar account and availability rules. OAuth, token refresh and event sync still need implementation; calendar files can be imported now.' },
  { id: 'social', name: 'Social publishing', keys: [], use: 'Content planning and caption exports work now', setup: 'Choose the social accounts and approved publishing platform. Account authorisation and publishing callbacks still need implementation.' },
  { id: 'inbox', name: 'Shared inbox', keys: [], use: 'Manual request records and response drafts work now', setup: 'Choose the mailbox and channels. OAuth or incoming webhooks, routing and reply detection still need implementation.' },
  { id: 'phone', name: 'SMS, WhatsApp & voice', keys: [], use: 'Message drafts and communication logs work now', setup: 'Choose a provider and business phone number. Sender approval, consent, inbound routing and delivery callbacks still need implementation.' },
];
export function connectionStatus(env) { return providerDefinitions.map(p => ({ ...p, configured: p.keys.length > 0 && p.keys.every(key => Boolean(env(key))), status: p.keys.length ? (p.keys.every(key => Boolean(env(key))) ? 'Configuration present · not tested here' : 'Setup required') : 'Integration required' })); }
export function sydneyDate(now = Date.now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
export function validDate(value) { const time = Date.parse(value + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value; }
export function nextDate(value, frequency) {
  if (!validDate(value)) throw new Error('Choose a valid next run date.');
  if (frequency === 'Once') return null;
  const d = new Date(value + 'T12:00:00Z');
  if (frequency === 'Monthly') { const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, end)); }
  else d.setUTCDate(d.getUTCDate() + (frequency === 'Weekly' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}
export function normaliseRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a valid record.');
  const tool = toolById.get(input.service);
  if (!tool) throw new Error('Choose a known tool.');
  const title = String(input.title || '').trim();
  if (!title || title.length > 180) throw new Error('Enter a title of 1–180 characters.');
  if (!tool.statuses.includes(input.status)) throw new Error('Choose a valid status.');
  const dueDate = String(input.dueDate || '');
  if (dueDate && !validDate(dueDate)) throw new Error('Choose a valid due date.');
  const source = input.data;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Enter valid record fields.');
  const data = {};
  for (const f of tool.fields) {
    const v = source[f.key];
    if (v === undefined || v === null || v === '') { data[f.key] = ''; continue; }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < (f.min ?? -100000000) || n > (f.max ?? 100000000) || (f.integer && !Number.isInteger(n))) throw new Error('Enter a valid ' + f.label.toLowerCase() + '.');
      data[f.key] = n; continue;
    }
    if (typeof v !== 'string') throw new Error('Invalid ' + f.label + '.');
    const value = v.trim();
    if (value.length > (f.max || (f.type === 'textarea' ? 12000 : 500))) throw new Error(f.label + ' is too long.');
    if (f.type === 'select' && !f.options.includes(value)) throw new Error('Choose a valid ' + f.label + '.');
    if (f.type === 'date' && !validDate(value)) throw new Error('Enter a valid ' + f.label + '.');
    if (f.type === 'datetime-local' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value + 'Z')))) throw new Error('Enter a valid ' + f.label + '.');
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email.');
    if (f.type === 'url') { try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error(); } catch { throw new Error('Enter a complete http(s) address for ' + f.label + '.'); } }
    data[f.key] = value;
  }
  if (input.service === 'workflow-builder' && input.status === 'Active' && (!data.target || !data.frequency || !validDate(data.nextRun || '') || !data.brief)) throw new Error('Active rules need a target, repeat interval, next run date and task instructions.');
  if (JSON.stringify(data).length > 70000) throw new Error('This record is too large. Split it into smaller records.');
  return { service: tool.id, title, status: input.status, dueDate: dueDate || null, data };
}
export const aud = value => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value) || 0);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function calculate(service, d) {
  const n = key => Number(d[key]) || 0;
  if (service === 'invoices') {
    const lines = String(d.items || '').split('\n').filter(s => s.trim()).map((line, i) => {
      const [description, q, p, t, extra] = line.split('|').map(s => s.trim());
      const qty = Number(q), price = Number(p), taxRate = Number(t);
      if (!description || !q || !p || t === undefined || !t || extra !== undefined || !Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(taxRate) || qty <= 0 || qty > 1e6 || price < 0 || price > 1e8 || taxRate < 0 || taxRate > 100) throw new Error(`Line ${i + 1}: use description | quantity | unit price | tax rate (use 0 if none).`);
      const subtotal = Math.round(qty * Math.round(price * 100)); const tax = Math.round(subtotal * taxRate / 100);
      return { description, qty, price, taxRate, subtotal: subtotal / 100, tax: tax / 100, total: (subtotal + tax) / 100 };
    });
    if (!lines.length || lines.length > 100) throw new Error('Enter 1–100 invoice line items.');
    const subtotal = round(lines.reduce((s, l) => s + l.subtotal, 0)); const tax = round(lines.reduce((s, l) => s + l.tax, 0));
    return { lines, subtotal, tax, total: round(subtotal + tax), summary: `Subtotal ${aud(subtotal)}\nEntered tax ${aud(tax)}\nTotal ${aud(subtotal + tax)}\nDraft only. Tax rates and payment status require your review.` };
  }
  if (['referrals', 'partner-portal', 'commissions'].includes(service)) return { summary: `Draft commission: ${aud(round(n('sale') * n('rate') / 100))}\nEligible sale ${aud(n('sale'))} × ${n('rate')}%. No payout created.` };
  if (service === 'pricing-rules') {
    if (n('margin') >= 100 || n('margin') < 0 || (n('ceiling') > 0 && n('ceiling') < n('floor'))) throw new Error('Check the margin and price limits.');
    const target = round(n('cost') / (1 - n('margin') / 100)); const proposed = round(Math.min(n('ceiling') || Infinity, Math.max(n('floor'), target)));
    return { proposed, summary: `Target price ${aud(target)}\nProposed price ${aud(proposed)}\nActual gross margin ${proposed ? round((proposed - n('cost')) / proposed * 100) : 0}%${proposed < target ? '\nThe maximum price prevents your target margin.' : ''}` };
  }
  if (service === 'cashflow') return { summary: `Forecast closing balance: ${aud(n('opening') + n('incoming') - n('outgoing'))}\nOpening ${aud(n('opening'))} + incoming ${aud(n('incoming'))} − outgoing ${aud(n('outgoing'))}. Entered assumptions only.` };
  if (service === 'instalments') { if (n('parts') < 1 || n('paid') > n('total')) throw new Error('Check the payment total and remaining instalments.'); const remaining = round(n('total') - n('paid')); return { summary: `Recorded balance: ${aud(remaining)}\n${n('parts')} instalments of approximately ${aud(remaining / n('parts'))}. Reconcile the last payment for rounding. This does not change a live payment plan.` }; }
  if (['expenses', 'gst-tax'].includes(service)) { if (n('tax') > n('amount')) throw new Error('The entered tax component cannot exceed the gross amount.'); return { summary: `Gross ${aud(n('amount'))}\nEntered tax ${aud(n('tax'))}\nNet ${aud(n('amount') - n('tax'))}\nNo tax treatment or deductibility has been inferred.` }; }
  if (['timesheets', 'rostering'].includes(service)) { const minutes = (Date.parse(d.end + 'Z') - Date.parse(d.start + 'Z')) / 60000 - n('breakMinutes'); if (!d.start || !d.end || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440 * 7) throw new Error('Enter start/end times and a valid break. Maximum shift length is seven days.'); return { hours: round(minutes / 60), summary: `Wall-clock hours: ${round(minutes / 60)}\nPlanning cost: ${aud(minutes / 60 * n('hourlyRate'))}\nCheck daylight-saving transitions and payroll rules separately.` }; }
  if (service === 'campaign-reporting') return { summary: `CTR: ${n('impressions') ? round(n('clicks') / n('impressions') * 100) + '%' : 'Not available'}\nCost per lead: ${n('leads') ? aud(n('spend') / n('leads')) : 'Not available'}\nROAS: ${n('spend') ? round(n('revenue') / n('spend')) + '×' : 'Not available'}\nBased only on entered totals and attribution.` };
  if (service === 'renewals') { if (!validDate(d.expiry || '')) throw new Error('Enter a valid expiry date.'); const date = new Date(d.expiry + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - n('noticeDays')); return { dueDate: date.toISOString().slice(0, 10), summary: `Action by ${date.toISOString().slice(0, 10)}\n${n('noticeDays')} days before expiry on ${d.expiry}.` }; }
  throw new Error('This tool does not have a calculator.');
}

export function parseCsv(source) {
  if (typeof source !== 'string' || source.length > 100000) throw new Error('Use a CSV smaller than 100 KB.');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const push = () => { row.push(cell.trim()); cell = ''; closed = false; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; }
    else if (c === '"') { if (cell.trim() || closed) throw new Error('A CSV quote is misplaced.'); quoted = true; }
    else if (c === ',') push();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; push(); if (row.some(Boolean)) rows.push(row); row = []; }
    else { if (closed && c.trim()) throw new Error('Unexpected text after a quoted CSV cell.'); cell += c; }
  }
  if (quoted) throw new Error('A CSV quote is not closed.');
  push(); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 1 || rows.length > 501) throw new Error('Use a header and at most 500 data rows.');
  const headers = rows.shift().map(s => s.replace(/^\uFEFF/, ''));
  if (headers.some(h => !h) || new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error('CSV headers must be non-empty and unique.');
  const bad = rows.findIndex(r => r.length !== headers.length);
  if (bad >= 0) throw new Error(`CSV row ${bad + 2} has ${rows[bad].length} fields; expected ${headers.length}.`);
  return { headers, rows };
}
export function csvText(rows) { return rows.map(row => row.map(v => { let s = String(v ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n'); }
export function cleanCsv(source, key = '') {
  const { headers, rows } = parseCsv(source); const index = key ? headers.indexOf(key) : -1;
  if (key && index < 0) throw new Error('The deduplication column does not exist.');
  const seen = new Set(); const cleaned = rows.filter(row => { const id = index < 0 ? JSON.stringify(row) : row[index] ? row[index] : JSON.stringify(row); if (seen.has(id)) return false; seen.add(id); return true; });
  return { headers, rows: cleaned, csv: csvText([headers, ...cleaned]), summary: `${rows.length} rows read; ${cleaned.length} kept; ${rows.length - cleaned.length} duplicates removed. Values trimmed; exported formulas escaped.` };
}
export function supplierRows(source) {
  const { headers, rows } = parseCsv(source); const indexes = ['sku', 'title', 'cost', 'price'].map(h => headers.indexOf(h));
  if (indexes.includes(-1)) throw new Error('Supplier CSV needs sku,title,cost,price headers.');
  const seen = new Set();
  return rows.map((row, i) => { const [sku, title, cost, price] = indexes.map(k => row[k]); if (!sku || !title || !cost || !price || seen.has(sku.toLowerCase()) || !Number.isFinite(Number(cost)) || !Number.isFinite(Number(price)) || Number(cost) < 0 || Number(price) < 0 || Number(cost) > 1e8 || Number(price) > 1e8 || sku.length > 120 || title.length > 180) throw new Error(`Supplier row ${i + 2}: check SKU, title and positive prices; duplicate SKUs are not allowed.`); seen.add(sku.toLowerCase()); return { sku, title, cost: Number(cost), price: Number(price) }; });
}
export function reconcile(invoices, payments) {
  const parse = source => { const p = parseCsv(source); const ri = p.headers.indexOf('reference'), ai = p.headers.indexOf('amount'); if (ri < 0 || ai < 0) throw new Error('Both CSVs need reference,amount headers.'); return p.rows.map(r => { if (!r[ri] || !r[ai] || !Number.isFinite(Number(r[ai])) || Number(r[ai]) < 0) throw new Error('Check every reference and amount.'); return { reference: r[ri], cents: Math.round(Number(r[ai]) * 100) }; }); };
  const a = parse(invoices), b = parse(payments); const refs = [...new Set([...a, ...b].map(r => r.reference))];
  const rows = refs.map(ref => { const x = a.filter(r => r.reference === ref), y = b.filter(r => r.reference === ref); const status = x.length > 1 || y.length > 1 ? 'Ambiguous duplicate' : !x.length ? 'Payment without invoice' : !y.length ? 'Invoice without payment' : x[0].cents === y[0].cents ? 'Matched' : 'Amount mismatch'; return [ref, status, x.length === 1 ? aud(x[0].cents / 100) : '', y.length === 1 ? aud(y[0].cents / 100) : '']; });
  return { rows, summary: `${rows.filter(r => r[1] === 'Matched').length} matched; ${rows.filter(r => r[1] !== 'Matched').length} need review.\n` + rows.map(r => r.join(' · ')).join('\n') };
}
export function draftFor(service, record) {
  const d = record.data, name = d.customer || 'there', topic = d.offer || record.title, facts = d.brief || '[Add approved facts]';
  if (service === 'reviews') return `Hi ${name},\n\nThank you for choosing BLVCK OAK. We would welcome your honest feedback about your experience.\n\n${d.reviewUrl || '[Add your public review link]'}\n\nThank you,\nBLVCK OAK`;
  if (['tickets', 'complaints', 'shared-inbox'].includes(service)) return `Hi ${name},\n\nThank you for getting in touch about ${record.title}.\n\nWe have recorded your request. Our next step is [add the agreed next action], and we will update you by [add a realistic date].\n\n${d.output || '[Add a specific response after reviewing the request]'}\n\nBLVCK OAK`;
  if (service === 'video-workflow') return `VIDEO SCRIPT — ${topic}\nAudience: ${d.audience || '[Audience]'}\n\n0–3s · Hook: ${topic}\nShot: show the problem / result.\n\n3–15s · Demonstration: ${facts}\nShot: show the work or product in use.\n\n15–25s · Supporting detail: [verified example]\nShot: close-up / customer perspective.\n\n25–30s · Call to action: [next step and link]\n\nReview claims, media permissions and captions before production.`;
  if (service === 'blog-workflow') return `# ${topic}\n\nReader: ${d.audience || '[Reader]'}\n\n## The problem\n[Explain the customer's situation.]\n\n## What to consider\n${facts}\n\n## A practical example\n[Add a verified example; do not invent results.]\n\n## Next steps\n[Add an appropriate call to action.]\n\nEditorial review: facts, sources, spelling and final links.`;
  if (service === 'ad-creative') return `AD COPY DIRECTIONS — ${topic}\n\n1. Benefit-led\nHeadline: ${topic}\nCopy: ${facts}\nCTA: [next step]\n\n2. Problem-led\nHeadline: [customer problem]\nCopy: [explain how the offer helps]\nCTA: [next step]\n\n3. Process-led\nHeadline: [what happens next]\nCopy: [describe the actual service experience]\nCTA: [next step]\n\nReview offer terms and evidence for every claim.`;
  if (['content-planner', 'social-publishing'].includes(service)) return `${topic}\n\n${facts}\n\n[Add a useful takeaway or specific example.]\n\n[Add a clear next step and approved link.]\n\nAudience: ${d.audience || '[Audience]'} · Channel: ${d.channel || '[Channel]'}`;
  if (service === 'reactivation') return `Hi ${name},\n\nWe’re checking in to see whether you need any help with ${record.title}.\n\n[Add a relevant update or offer.]\n\nIf you would prefer not to receive these messages, reply and we’ll update your preferences.\n\nBLVCK OAK`;
  if (service === 'payment-reminders') return `Hi ${name},\n\nOur records show [invoice reference] for [amount] is due on [date]. Please check the payment reference below. If you have already paid or have a question, let us know so we can update the record.\n\n[Add verified invoice and secure payment link.]\n\nBLVCK OAK`;
  return `${record.title}\n\n${facts}\n\n${d.message || d.output || '[Add the final details and next step.]'}\n\nPrepared for review by BLVCK OAK.`;
}
export function searchKnowledge(records, query) {
  const words = String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!words.length) return [];
  return records.filter(r => ['receptionist', 'knowledge-chat'].includes(r.service) && r.status === 'Approved').map(r => ({ record: r, score: words.reduce((n, w) => n + (`${r.title} ${r.data.question} ${r.data.keywords} ${r.data.answer}`.toLowerCase().includes(w) ? 1 : 0), 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}
export function workSummary(records, now = Date.now()) {
  const today = sydneyDate(now), open = records.filter(r => !['Done', 'Archived', 'Resolved', 'Rejected'].includes(r.status));
  return { total: records.length, open: open.length, due: open.filter(r => r.dueDate && r.dueDate <= today).length, lowStock: records.filter(r => ['inventory', 'warehouse'].includes(r.service) && r.status !== 'Archived' && Number(r.data.stock || 0) <= Number(r.data.reorder || 0)).length, activeRules: records.filter(r => r.service === 'workflow-builder' && r.status === 'Active').length };
}
