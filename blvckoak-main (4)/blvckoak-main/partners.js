'use strict';
const $ = (selector) => document.querySelector(selector);
const money = (cents) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { pending_approval: 'Awaiting approval', approved: 'Approved', deposit_paid: 'Deposit paid', paid: 'Paid in full', declined: 'Declined', cancelled: 'Cancelled', payment_review: 'Owner review required' };
let authMode = 'login';
let challenge = '';
let dashboard = null;
let reviewQuote = null;
let progressQuote = null;
let portfolioQuote = null;
let quoteRequestId = crypto.randomUUID();

function status(selector, text, error = false) {
  const target = $(selector);
  target.textContent = text;
  target.classList.toggle('error', error);
}

async function api(path, body, csrf) {
  const options = body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } };
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The partner service is not connected on this copy of the site. Deploy the complete Netlify source and configure email first.');
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function setMode(mode) {
  authMode = mode;
  $('[data-signup-name]').hidden = mode !== 'signup';
  $('[data-signup-name] input').required = mode === 'signup';
  $('[data-signup-terms]').hidden = mode !== 'signup';
  $('[data-signup-terms] input').required = mode === 'signup';
  $('[data-auth-submit]').firstChild.textContent = mode === 'signup' ? 'Create account & send code ' : 'Send sign-in code ';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.authMode === mode)));
  status('[data-auth-status]', '');
}
document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.authMode)));
$('[data-auth-reset]').addEventListener('click', () => {
  challenge = '';
  $('[data-auth-start]').hidden = false;
  $('[data-auth-verify]').hidden = true;
  $('[data-auth-verify]').reset();
  status('[data-auth-status]', '');
});

$('[data-auth-start]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  status('[data-auth-status]', 'Sending your private sign-in code…');
  try {
    const result = await api('/api/partners/auth', { action: 'start', mode: authMode, name: values.get('name'), email: values.get('email'), website: values.get('website'), acceptedTerms: values.get('terms') === 'on' });
    challenge = result.challenge;
    form.hidden = true;
    $('[data-auth-verify]').hidden = false;
    $('[data-auth-verify] input').focus();
    status('[data-auth-status]', result.message);
  } catch (error) { status('[data-auth-status]', error.message, true); }
  finally { button.disabled = false; }
});

$('[data-auth-verify]').addEventListener('submit', async (event) => {
  event.preventDefault();
  // Keep the form reference: event.currentTarget is cleared after dispatch.
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/partners/auth', { action: 'verify', challenge, code: new FormData(form).get('code') });
    challenge = '';
    form.reset();
    status('[data-auth-status]', '');
    await loadDashboard();
  } catch (error) { status('[data-auth-status]', error.message, true); }
  finally { button.disabled = false; }
});

function renderQuotes() {
  const list = $('[data-quote-list]');
  const filter = $('[data-quote-filter]').value;
  const quotes = dashboard.quotes.filter((quote) => filter === 'all' || quote.status === filter);
  list.replaceChildren();
  if (!quotes.length) {
    const empty = document.createElement('p'); empty.className = 'muted';
    empty.textContent = 'No quotes here yet. Describe a client project to create the first one.';
    list.append(empty); return;
  }
  quotes.forEach((quote) => {
    const article = document.createElement('article');
    article.className = 'quote-record';
    article.innerHTML = '<header><h3>' + escape(quote.service) + '</h3><span class="status-pill ' + escape(quote.status) + '">' + escape(labels[quote.status] || quote.status) + '</span></header>' +
      '<p>' + escape(quote.customerName) + ' · ' + escape(quote.customerEmail) + (dashboard.isOwner ? '<br>Partner: ' + escape(quote.partnerName) + ' · ' + escape(quote.referralCode) : '') + '</p>' +
      '<details><summary>Service description</summary><p>' + escape(quote.description) + '</p></details>' +
      (quote.paymentPlan.type === 'pay_as_you_sell' ? '<p class="record-plan"><strong>Pay as You Sell</strong> · ' + escape(quote.paymentPlan.method.label) + '<br>' + (quote.paymentPlan.connected || quote.paymentPlan.trackingComplete ? escape(quote.paymentPlan.salesCount) + ' Stripe sales recorded · ' + money(quote.paymentPlan.contributionCents) + ' accrued' + (quote.paymentPlan.trackingComplete ? ' · tracking ended when paid' : '') : 'Waiting for the client to connect Stripe') + '</p>' : '') +
      (quote.maintenance.enabled ? '<p class="record-plan"><strong>Maintenance offered</strong> · ' + money(quote.maintenance.monthlyCents) + ' per month · ' + escape(quote.maintenance.status.replaceAll('_', ' ')) + '</p>' : '') +
      '<div class="record-numbers"><span>Total<strong>' + money(quote.totalCents) + '</strong></span><span>Deposit<strong>' + money(quote.depositCents) + '</strong></span><span>Paid<strong>' + money(quote.paidCents) + '</strong></span>' + (quote.progressLink ? '<span>Project progress<strong>' + escape(quote.progress.percentage) + '%</strong></span>' : '') + '</div>' +
      (dashboard.isOwner && quote.portfolio?.published ? '<p class="portfolio-published-status"><strong>Published in portfolio</strong> · ' + escape(quote.portfolio.title) + '</p>' : '') +
      (quote.reviewNote ? '<p>Owner note: ' + escape(quote.reviewNote) + '</p>' : '');
    const actions = document.createElement('div'); actions.className = 'record-actions';
    if (quote.paymentLink) {
      const copy = document.createElement('button'); copy.className = 'quiet-button'; copy.type = 'button'; copy.textContent = 'Copy payment link';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(quote.paymentLink); copy.textContent = 'Copied'; }
        catch { status('[data-global-status]', 'Clipboard unavailable. Open the payment page and copy its complete address.', true); }
      });
      const open = document.createElement('a'); open.className = 'quiet-button'; open.href = quote.paymentLink; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'View client page ↗';
      actions.append(copy, open);
    }
    if (quote.progressLink) {
      const copyProgress = document.createElement('button'); copyProgress.className = 'quiet-button'; copyProgress.type = 'button'; copyProgress.textContent = 'Copy progress link';
      copyProgress.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(quote.progressLink); copyProgress.textContent = 'Copied'; }
        catch { status('[data-global-status]', 'Clipboard unavailable. Open the progress page and copy its complete address.', true); }
      });
      const openProgress = document.createElement('a'); openProgress.className = 'quiet-button'; openProgress.href = quote.progressLink; openProgress.target = '_blank'; openProgress.rel = 'noopener noreferrer'; openProgress.textContent = 'View progress page ↗';
      actions.append(copyProgress, openProgress);
    }
    if (dashboard.isOwner && ['approved', 'deposit_paid', 'paid', 'payment_review'].includes(quote.status)) {
      const manage = document.createElement('button'); manage.className = 'quiet-button progress-manage-button'; manage.type = 'button'; manage.textContent = 'Manage progress';
      manage.addEventListener('click', () => editProgress(quote)); actions.append(manage);
    }
    if (dashboard.isOwner && quote.progress.stage === 'completed' && quote.progress.percentage === 100) {
      const managePortfolio = document.createElement('button'); managePortfolio.className = 'quiet-button portfolio-manage-button'; managePortfolio.type = 'button'; managePortfolio.textContent = quote.portfolio?.published ? 'Edit portfolio listing' : 'Add to portfolio';
      managePortfolio.addEventListener('click', () => editPortfolio(quote)); actions.append(managePortfolio);
    }
    if (dashboard.isOwner && quote.status === 'pending_approval') {
      const review = document.createElement('button'); review.className = 'quiet-button'; review.type = 'button'; review.textContent = 'Review & approve';
      review.addEventListener('click', () => editQuote(quote)); actions.append(review);
    }
    if (dashboard.isOwner && quote.status === 'approved' && !quote.paidCents) {
      const cancel = document.createElement('button'); cancel.className = 'quiet-button'; cancel.type = 'button'; cancel.textContent = 'Cancel unpaid quote';
      cancel.addEventListener('click', async () => {
        if (!window.confirm('Cancel this unpaid quote and disable its payment link?')) return;
        cancel.disabled = true;
        try { await api('/api/partners', { action: 'cancel_quote', id: quote.id }, dashboard.csrf); await loadDashboard(); }
        catch (error) { status('[data-global-status]', error.message, true); cancel.disabled = false; }
      });
      actions.append(cancel);
    }
    if (quote.status === 'payment_review') {
      const note = document.createElement('p'); note.textContent = 'Further payments are paused after a refund or dispute. Reconcile this job in Stripe and contact Black Oak.'; actions.append(note);
    }
    article.append(actions); list.append(article);
  });
}

function locationError(error) {
  if (error?.code === 1) return 'Location access was blocked. Allow location for this site in your browser, then try again.';
  if (error?.code === 2) return 'Your location is unavailable right now. Check location services and try again.';
  if (error?.code === 3) return 'Finding your location took too long. Move somewhere with a clearer signal and try again.';
  return 'This browser could not share your location.';
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser does not support location access.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  });
}

function renderLeads(leads) {
  const list = $('[data-lead-results]');
  list.replaceChildren();
  if (!leads.length) {
    const empty = document.createElement('p'); empty.className = 'lead-empty';
    empty.textContent = 'No matching businesses without a listed website were found in these first results. Try a different category or a wider distance.';
    list.append(empty); return;
  }
  leads.forEach((lead) => {
    const article = document.createElement('article'); article.className = 'lead-record';
    const heading = document.createElement('header');
    const title = document.createElement('h3'); title.textContent = lead.name;
    const badge = document.createElement('span'); badge.className = 'status-pill'; badge.textContent = 'No website listed';
    heading.append(title, badge);
    const details = document.createElement('p');
    const rating = lead.rating === null ? '' : ` · ${lead.rating.toFixed(1)}★${lead.ratingCount === null ? '' : ` (${lead.ratingCount})`}`;
    details.textContent = `${lead.type}${rating}${lead.address ? `\n${lead.address}` : ''}`;
    const actions = document.createElement('div'); actions.className = 'record-actions';
    const maps = document.createElement('a'); maps.className = 'quiet-button'; maps.href = lead.mapsUrl; maps.target = '_blank'; maps.rel = 'noopener noreferrer'; maps.textContent = 'Open in Google Maps ↗';
    actions.append(maps);
    if (lead.phone) {
      const call = document.createElement('a'); call.className = 'quiet-button'; call.href = `tel:${lead.phone.replace(/[^+\d]/g, '')}`; call.textContent = `Call ${lead.phone}`; actions.append(call);
    }
    const copy = document.createElement('button'); copy.className = 'quiet-button'; copy.type = 'button'; copy.textContent = 'Copy lead';
    copy.addEventListener('click', async () => {
      const text = [lead.name, lead.type, lead.address, lead.phone, lead.mapsUrl].filter(Boolean).join('\n');
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { status('[data-lead-status]', 'Clipboard unavailable. Open the listing and copy its details.', true); }
    });
    actions.append(copy); article.append(heading, details, actions); list.append(article);
  });
}

$('[data-lead-search]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('[data-lead-submit]'); button.disabled = true;
  status('[data-lead-status]', 'Waiting for your location permission…');
  try {
    const position = await currentPosition();
    status('[data-lead-status]', 'Checking nearby business listings…');
    const values = new FormData(form);
    const result = await api('/api/businesses/nearby', {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      radius: Number(values.get('radius')),
      category: values.get('category'),
    }, dashboard.csrf);
    renderLeads(result.leads);
    const count = result.leads.length;
    status('[data-lead-status]', `${count} potential ${count === 1 ? 'lead' : 'leads'} found. ${result.remainingSearches} searches remaining today.`);
  } catch (error) {
    status('[data-lead-status]', 'code' in error ? locationError(error) : error.message, true);
  } finally { button.disabled = false; }
});

async function loadDashboard() {
  try {
    dashboard = await api('/api/partners');
    $('[data-auth-panel]').hidden = true; $('[data-dashboard]').hidden = false; $('[data-signout]').hidden = false;
    $('[data-workspace-title]').textContent = dashboard.isOwner ? 'Your clients. Your control.' : 'Welcome, ' + dashboard.account.name.split(' ')[0] + '.';
    $('[data-role-tag]').textContent = dashboard.isOwner ? 'Owner workspace' : 'Partner workspace';
    $('[data-partner-code]').textContent = dashboard.referral.code;
    $('[data-payout-status]').textContent = dashboard.referral.payoutReady ? 'Standard package rewards enabled' : 'Finish Stripe verification to activate package referrals';
    $('[data-onboard]').textContent = dashboard.referral.payoutReady ? 'Review Stripe onboarding' : 'Set up Stripe payouts';
    $('[data-quote-count]').textContent = dashboard.quotes.length;
    $('[data-pending-count]').textContent = dashboard.quotes.filter((quote) => quote.status === 'pending_approval').length;
    $('[data-paid-total]').textContent = money(dashboard.quotes.reduce((sum, quote) => sum + quote.paidCents - quote.payments.reduce((value, payment) => value + (payment.refundedCents || 0), 0), 0));
    $('[data-list-title]').textContent = dashboard.isOwner ? 'All client quotes' : 'Your quotes';
    if (!reviewQuote) resetEditor();
    if (progressQuote) closeProgressEditor();
    if (portfolioQuote) closePortfolioEditor();
    renderQuotes();
    status('[data-global-status]', dashboard.isOwner ? 'You can review quotes, see every payment and publish live client progress.' : 'Create a quote below. Approved payment and progress links can be shared with your client.');
  } catch (error) {
    if (error.status === 401) {
      dashboard = null; $('[data-auth-panel]').hidden = false; $('[data-dashboard]').hidden = true; $('[data-signout]').hidden = true;
      $('[data-auth-start]').hidden = false; $('[data-auth-verify]').hidden = true;
      status('[data-global-status]', 'Sign in or create your partner account to continue.');
    } else { status('[data-global-status]', error.message, true); }
  }
}

function calculatePreview() {
  const form = $('[data-quote-form]');
  const total = Math.max(0, Number(form.elements.total.value) || 0) * 100;
  const deposit = Math.max(0, Number(form.elements.deposit.value) || 0) * 100;
  const firstPayment = form.elements.paymentPlan.value === 'pay_as_you_sell' ? deposit : (deposit || total);
  $('[data-due-preview]').textContent = money(firstPayment);
  $('[data-balance-preview]').textContent = money(Math.max(0, total - firstPayment));
}
function updatePaymentFields() {
  const form = $('[data-quote-form]');
  const payAsYouSell = form.elements.paymentPlan.value === 'pay_as_you_sell';
  const method = form.elements.payAsYouSellMethod.value;
  $('[data-pay-as-you-sell-fields]').hidden = !payAsYouSell;
  $('[data-sales-percent]').hidden = !payAsYouSell || method !== 'percentage';
  $('[data-sales-amount]').hidden = !payAsYouSell || method === 'percentage';
  $('[data-sales-count]').hidden = !payAsYouSell || method !== 'sales_milestone';
  $('[data-maintenance-amount]').hidden = !form.elements.maintenanceEnabled.checked;
}
$('[data-quote-form]').addEventListener('input', () => { calculatePreview(); updatePaymentFields(); });
$('[data-quote-filter]').addEventListener('change', renderQuotes);
$('[data-refresh]').addEventListener('click', loadDashboard);

function closeProgressEditor() {
  progressQuote = null;
  $('[data-progress-form]').reset();
  $('[data-progress-editor]').hidden = true;
  status('[data-progress-form-status]', '');
}

function editProgress(quote) {
  progressQuote = quote;
  const form = $('[data-progress-form]');
  form.elements.stage.value = quote.progress.stage;
  form.elements.percentage.value = String(quote.progress.percentage);
  form.elements.summary.value = quote.progress.summary;
  form.elements.completedItems.value = quote.progress.completedItems.join('\n');
  form.elements.nextSteps.value = quote.progress.nextSteps.join('\n');
  $('[data-progress-project]').textContent = `${quote.service} for ${quote.customerName}`;
  $('[data-progress-editor]').hidden = false;
  status('[data-progress-form-status]', '');
  $('[data-progress-editor]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.summary.focus();
}

$('[data-close-progress]').addEventListener('click', closeProgressEditor);
$('[data-progress-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!progressQuote) return;
  const button = $('[data-save-progress]'); button.disabled = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  status('[data-progress-form-status]', 'Publishing this update to the client…');
  try {
    await api('/api/partners', { ...values, action: 'update_progress', id: progressQuote.id, progressRevision: progressQuote.progress.revision, percentage: Number(values.percentage) }, dashboard.csrf);
    closeProgressEditor(); await loadDashboard();
    status('[data-global-status]', 'Project progress published. The client page will receive it automatically.');
  } catch (error) { status('[data-progress-form-status]', error.message, true); }
  finally { button.disabled = false; }
});

function closePortfolioEditor() {
  portfolioQuote = null;
  $('[data-portfolio-form]').reset();
  $('[data-portfolio-editor]').hidden = true;
  status('[data-portfolio-form-status]', '');
}

function editPortfolio(quote) {
  portfolioQuote = quote;
  const form = $('[data-portfolio-form]');
  form.elements.title.value = quote.portfolio.title || quote.service;
  form.elements.category.value = quote.portfolio.category || 'Website design';
  form.elements.summary.value = quote.portfolio.summary || quote.progress.summary || '';
  form.elements.websiteUrl.value = quote.portfolio.websiteUrl || '';
  form.elements.published.checked = quote.portfolio.published;
  $('[data-portfolio-project]').textContent = `${quote.service} for ${quote.customerName}`;
  $('[data-portfolio-editor]').hidden = false;
  status('[data-portfolio-form-status]', '');
  $('[data-portfolio-editor]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.title.focus();
}

$('[data-close-portfolio]').addEventListener('click', closePortfolioEditor);
$('[data-portfolio-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!portfolioQuote) return;
  const button = $('[data-save-portfolio]'); button.disabled = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const published = event.currentTarget.elements.published.checked;
  status('[data-portfolio-form-status]', published ? 'Publishing this completed project…' : 'Saving this private portfolio draft…');
  try {
    await api('/api/partners', { ...values, published, action: 'update_portfolio', id: portfolioQuote.id, portfolioRevision: portfolioQuote.portfolio.revision }, dashboard.csrf);
    closePortfolioEditor(); await loadDashboard();
    status('[data-global-status]', published ? 'Portfolio listing published. It is now visible on the public Portfolio page.' : 'Portfolio draft saved and hidden from the public page.');
  } catch (error) { status('[data-portfolio-form-status]', error.message, true); }
  finally { button.disabled = false; }
});

function resetEditor() {
  reviewQuote = null; quoteRequestId = crypto.randomUUID();
  $('[data-quote-form]').reset(); $('[data-new-quote]').hidden = true; $('[data-decline]').hidden = true; $('[data-review-note]').hidden = true;
  $('[data-editor-title]').textContent = 'Create a client quote';
  $('[data-editor-note]').textContent = dashboard?.isOwner ? 'As owner, your quotes are approved immediately. Check the scope and complete price before creating a payable link.' : 'Draft the scope and pricing. Black Oak must approve it before the client can pay.';
  $('[data-save-quote]').firstChild.textContent = dashboard?.isOwner ? 'Create approved payment link ' : 'Submit for approval ';
  calculatePreview(); updatePaymentFields();
}
function editQuote(quote) {
  reviewQuote = quote;
  const form = $('[data-quote-form]');
  ['customerName', 'customerEmail', 'service', 'description'].forEach((field) => { form.elements[field].value = quote[field]; });
  form.elements.total.value = (quote.totalCents / 100).toFixed(2);
  form.elements.deposit.value = (quote.depositCents / 100).toFixed(2);
  form.elements.paymentPlan.value = quote.paymentPlan.type;
  if (quote.paymentPlan.type === 'pay_as_you_sell') {
    form.elements.payAsYouSellMethod.value = quote.paymentPlan.method.type;
    if (quote.paymentPlan.method.percent) form.elements.payAsYouSellPercent.value = String(quote.paymentPlan.method.percent);
    if (quote.paymentPlan.method.amountCents) form.elements.payAsYouSellAmount.value = (quote.paymentPlan.method.amountCents / 100).toFixed(2);
    if (quote.paymentPlan.method.salesPerPayment) form.elements.payAsYouSellSalesCount.value = String(quote.paymentPlan.method.salesPerPayment);
  }
  form.elements.maintenanceEnabled.checked = quote.maintenance.enabled;
  if (quote.maintenance.enabled) form.elements.maintenanceMonthly.value = (quote.maintenance.monthlyCents / 100).toFixed(2);
  form.elements.reviewNote.value = '';
  $('[data-editor-title]').textContent = 'Review partner quote';
  $('[data-editor-note]').textContent = 'Check or adjust the scope, total and deposit. Approval makes the client payment link usable.';
  $('[data-save-quote]').firstChild.textContent = 'Approve & activate link ';
  $('[data-new-quote]').hidden = false; $('[data-decline]').hidden = false; $('[data-review-note]').hidden = false;
  status('[data-quote-status]', ''); calculatePreview(); updatePaymentFields();
  form.elements.service.focus(); form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('[data-new-quote]').addEventListener('click', resetEditor);
$('[data-quote-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('[data-save-quote]'); button.disabled = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const body = { ...values, action: reviewQuote ? 'approve_quote' : 'create_quote', requestId: quoteRequestId, ...(reviewQuote ? { id: reviewQuote.id, revision: reviewQuote.revision } : {}) };
  status('[data-quote-status]', 'Saving your quote…');
  try {
    await api('/api/partners', body, dashboard.csrf);
    const approved = Boolean(reviewQuote || dashboard.isOwner);
    resetEditor(); await loadDashboard();
    status('[data-quote-status]', approved ? 'Approved. Copy the payment link from the quote card.' : 'Submitted. Black Oak can now review the scope, price and deposit.');
  } catch (error) { status('[data-quote-status]', error.message, true); }
  finally { button.disabled = false; }
});
$('[data-decline]').addEventListener('click', async () => {
  if (!reviewQuote) return;
  const button = $('[data-decline]'); button.disabled = true;
  try {
    await api('/api/partners', { action: 'decline_quote', id: reviewQuote.id, revision: reviewQuote.revision, reviewNote: $('[data-quote-form]').elements.reviewNote.value }, dashboard.csrf);
    resetEditor(); await loadDashboard(); status('[data-quote-status]', 'Quote declined. It cannot accept payments.');
  } catch (error) { status('[data-quote-status]', error.message, true); }
  finally { button.disabled = false; }
});
$('[data-onboard]').addEventListener('click', async () => {
  const button = $('[data-onboard]'); button.disabled = true;
  try { const result = await api('/api/partners', { action: 'onboard' }, dashboard.csrf); window.location.assign(result.url); }
  catch (error) { status('[data-global-status]', error.message, true); button.disabled = false; }
});
$('[data-copy-referral]').addEventListener('click', async () => {
  const link = new URL('/index.html', location.origin); link.searchParams.set('ref', dashboard.referral.code); link.searchParams.set('package', 'enterprise'); link.hash = 'packages';
  try { await navigator.clipboard.writeText(link.toString()); status('[data-global-status]', 'Enterprise referral link copied. Stripe payout verification must be complete before it can be used.'); }
  catch { status('[data-global-status]', 'Clipboard unavailable. Your referral code is ' + dashboard.referral.code, true); }
});
$('[data-signout]').addEventListener('click', async () => {
  try { await api('/api/partners', { action: 'logout' }, dashboard.csrf); dashboard = null; location.reload(); }
  catch (error) { status('[data-global-status]', error.message, true); }
});
if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup');
loadDashboard();
