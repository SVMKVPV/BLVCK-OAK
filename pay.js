'use strict';
const $ = (selector) => document.querySelector(selector);
const money = (cents) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
const parameters = new URLSearchParams(location.search);
const quoteId = parameters.get('quote') || '';
const privateToken = location.hash.slice(1);
let quote = null;
$('[data-progress-link]').href = `/progress.html?project=${encodeURIComponent(quoteId)}#${privateToken}`;

function status(message, error = false) {
  $('[data-payment-status]').textContent = message;
  $('[data-payment-status]').classList.toggle('error', error);
}
async function request(action) {
  const response = await fetch('/api/quote-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: quoteId, token: privateToken }), cache: 'no-store' });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The payment service is not connected on this copy of the website. Contact Black Oak before paying.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load this quote.');
  return result;
}

function renderInstalments(currentQuote) {
  const plan = currentQuote.paymentPlan;
  const selected = plan.type === 'instalments_15';
  $('[data-instalment-plan]').hidden = !selected;
  if (!selected) return;
  $('[data-instalment-count]').textContent = `${plan.paidInstalments} of 15 payments confirmed · ${plan.remainingInstalments} remaining`;
  $('[data-instalment-progress]').value = plan.paidInstalments;
  $('[data-instalment-progress]').setAttribute('aria-label', `${plan.paidInstalments} of 15 payments confirmed`);
  const schedule = $('[data-instalment-schedule]'); schedule.replaceChildren();
  (plan.schedule || []).forEach((part) => {
    const next = currentQuote.nextPayment?.instalmentNumber === part.number;
    const item = document.createElement('li'); item.className = part.paid ? 'is-paid' : next ? 'is-next' : '';
    const number = document.createElement('span'); number.textContent = `Part ${part.number}`;
    const amount = document.createElement('strong'); amount.textContent = money(part.amountCents);
    const state = document.createElement('small'); state.textContent = part.paid ? 'Paid' : next ? 'Next payment' : 'Remaining';
    item.append(number, amount, state); schedule.append(item);
  });
}

async function loadQuote() {
  if (!/^[a-f0-9]{32}$/.test(quoteId) || !/^[A-Za-z0-9_-]{43}$/.test(privateToken)) {
    status('This private link is incomplete. Ask Black Oak or your referral partner for the full approved payment link.', true); return;
  }
  try {
    const result = await request('view'); quote = result.quote;
    document.title = quote.service + ' — Black Oak private quote';
    $('[data-client-quote]').hidden = false;
    $('[data-quote-title]').textContent = quote.service;
    $('[data-client-name]').textContent = 'Prepared for ' + quote.customerName;
    $('[data-client-description]').textContent = quote.description;
    const payAsYouSell = quote.paymentPlan.type === 'pay_as_you_sell';
    const instalments = quote.paymentPlan.type === 'instalments_15';
    renderInstalments(quote);
    $('[data-sales-plan]').hidden = !payAsYouSell;
    if (payAsYouSell) {
      const method = quote.paymentPlan.method;
      const detail = method.type === 'percentage' ? `${method.percent}% of every successful AUD sale` : method.type === 'fixed_per_sale' ? `${money(method.amountCents)} from every successful AUD sale` : `${money(method.amountCents)} after every ${method.salesPerPayment} successful ${method.salesPerPayment === 1 ? 'sale' : 'sales'}`;
      $('[data-sales-method]').textContent = `${detail} becomes payable toward the agreed website total. Collection stops automatically when that total has been paid.`;
      $('[data-sales-connected]').textContent = quote.paymentPlan.trackingComplete ? 'Ended automatically when paid' : quote.paymentPlan.connected ? 'Connected and tracking' : 'Not connected';
      $('[data-sales-count]').textContent = String(quote.paymentPlan.salesCount);
      $('[data-sales-gross]').textContent = money(quote.paymentPlan.grossSalesCents);
      $('[data-sales-accrued]').textContent = money(quote.paymentPlan.accruedCents);
      $('[data-connect-sales]').hidden = quote.paymentPlan.connected || quote.status === 'paid';
      $('[data-connect-sales]').disabled = false;
    }
    $('[data-maintenance-plan]').hidden = !quote.maintenance.enabled;
    if (quote.maintenance.enabled) {
      const maintenanceState = quote.maintenance.status === 'active' ? 'is active' : quote.maintenance.status === 'past_due' ? 'needs payment attention' : quote.maintenance.status === 'cancelled' ? 'has been cancelled' : 'is offered separately and starts only after you accept it';
      $('[data-maintenance-copy]').textContent = `${money(quote.maintenance.monthlyCents)} per month. This ${maintenanceState}; it is not counted toward the website project balance.`;
      $('[data-maintenance-button]').hidden = quote.status !== 'paid' || quote.maintenance.status === 'active';
      $('[data-maintenance-button]').disabled = false;
      $('[data-maintenance-button]').firstChild.textContent = quote.maintenance.status === 'cancelled' ? 'Restart monthly maintenance ' : 'Accept monthly maintenance ';
      $('[data-maintenance-note]').textContent = quote.status === 'paid' ? 'Continuing opens Stripe Subscription Checkout. Completing it is your separate acceptance of the monthly maintenance charge.' : 'This option becomes available after the agreed website total is paid.';
    }
    const paymentPolicy = instalments
      ? 'Only the scope and total shown here are approved. The one-off project total is split into 15 manually initiated payments. There is no additional deposit, interest or payment-plan fee. Pay each part through this private link at the time agreed with Black Oak.'
      : payAsYouSell
        ? 'Only the scope and total shown here are approved. Pay as You Sell contributions stop automatically when the website project total has been paid.'
        : 'Only the scope and total shown here are approved. The remaining balance uses this same private link, with timing agreed with Black Oak.';
    $('[data-payment-policy]').textContent = paymentPolicy + (quote.maintenance.enabled ? ' Monthly maintenance is separate and applies only if you accept the maintenance offer.' : ' There are no recurring maintenance charges.');
    $('[data-client-total]').textContent = money(quote.totalCents);
    $('[data-client-paid]').textContent = money(quote.paidCents);
    $('[data-client-balance]').textContent = money(instalments ? quote.paymentPlan.balanceCents : Math.max(0, quote.totalCents - quote.paidCents));
    $('[data-refund-row]').hidden = !quote.refundedCents;
    $('[data-client-refunded]').textContent = money(quote.refundedCents);
    const labels = { approved: 'Approved proposal', deposit_paid: 'Deposit received', paid: 'Paid in full', cancelled: 'Quote cancelled', payment_review: 'Payments paused for review' };
    $('[data-client-state]').textContent = instalments && quote.status === 'deposit_paid' ? 'Part paid' : labels[quote.status] || quote.status;
    $('[data-client-state]').className = 'status-pill ' + quote.status;
    $('[data-pay-button]').hidden = !quote.nextPayment;
    $('[data-pay-button]').disabled = false;
    $('[data-client-due]').textContent = quote.nextPayment ? money(quote.nextPayment.amountCents) : '—';
    const nextInstalment = instalments && quote.nextPayment?.instalmentNumber;
    $('[data-due-label]').textContent = nextInstalment ? `Instalment ${nextInstalment} of 15` : quote.nextPayment?.stage === 'deposit' ? 'Deposit due now' : quote.nextPayment?.stage === 'balance' ? 'Remaining balance' : quote.nextPayment?.stage === 'sales_contribution' ? 'Accrued from sales' : instalments ? 'No instalment payable' : 'Due now';
    $('[data-pay-button]').firstChild.textContent = nextInstalment ? `Pay instalment ${nextInstalment} of 15 — ${money(quote.nextPayment.amountCents).replace('$', 'A$')} ` : quote.nextPayment?.stage === 'deposit' ? 'Pay deposit securely ' : quote.nextPayment?.stage === 'balance' ? 'Pay remaining balance ' : quote.nextPayment?.stage === 'sales_contribution' ? 'Pay sales contribution ' : 'Pay in full securely ';
    const history = $('[data-payment-history]'); history.replaceChildren();
    if (!quote.payments.length) {
      const item = document.createElement('p'); item.className = 'muted'; item.textContent = 'No payment has been confirmed yet.'; history.append(item);
    }
    quote.payments.forEach((payment) => {
      const item = document.createElement('div'); item.className = 'payment-entry';
      const instalment = String(payment.stage).match(/^instalment_([1-9]|1[0-5])$/);
      const stage = instalment ? `Instalment ${instalment[1]} of 15` : payment.stage;
      item.textContent = money(payment.amountCents) + ' · ' + stage + ' · ' + new Date(payment.paidAt).toLocaleDateString('en-AU') + (payment.refundedCents ? ' · Refunded ' + money(payment.refundedCents) : '');
      history.append(item);
    });
    if (quote.status === 'paid' && parameters.get('maintenance') === 'returned' && quote.maintenance.status === 'active') status('Your website balance is paid and monthly maintenance is now active.');
    else if (quote.status === 'paid' && parameters.get('maintenance') === 'cancelled') status('Your website balance is paid. Monthly maintenance was not started.');
    else if (quote.status === 'paid') status('Payment confirmed. Your agreed website total is paid in full.');
    else if (quote.status === 'payment_review') status('Payments are paused following a refund or dispute. Contact Black Oak to confirm the next step.', true);
    else if (quote.status === 'cancelled') status('This quote has been cancelled and can no longer accept payment. Contact Black Oak if you need a replacement.', true);
    else if (parameters.get('sales') === 'connected') status('Stripe sales tracking is connected. Future successful AUD sales will update this page automatically.');
    else if (parameters.get('sales') === 'failed') status('Stripe could not be connected. Try again or contact Black Oak.', true);
    else if (payAsYouSell && !quote.paymentPlan.connected) status('Connect your Stripe account to begin automatic Pay as You Sell tracking.');
    else if (payAsYouSell && !quote.nextPayment) status('Stripe sales tracking is active. No new sales contribution is due yet.');
    else if (!quote.nextPayment) status('This proposal has expired. Contact Black Oak for a new approved quote.', true);
    else if (quote.nextPayment.stage === 'sales_contribution') status('Stripe recorded eligible sales. The calculated contribution shown here is now payable.');
    else if (parameters.get('payment') === 'returned') status('This page shows confirmed payments only. If your latest payment is not listed yet, refresh shortly.');
    else if (instalments) status(`Your next payment is instalment ${quote.nextPayment.instalmentNumber} of 15. Pay each part through this private link at the agreed time.`);
    else status('Review your approved scope and price. You will enter card details only on Stripe.');
  } catch (error) { status(error.message, true); }
}
$('[data-pay-button]').addEventListener('click', async () => {
  $('[data-pay-button]').disabled = true;
  status('Opening secure Stripe checkout…');
  try {
    const result = await request('checkout');
    if (result.awaitingConfirmation) {
      await loadQuote(); status('Stripe has received this payment. We are waiting for its signed confirmation; do not pay again.');
      $('[data-pay-button]').disabled = true;
    } else if (result.url && new URL(result.url).hostname === 'checkout.stripe.com') location.assign(result.url);
    else throw new Error('The checkout address could not be verified. Contact Black Oak.');
  } catch (error) { status(error.message, true); $('[data-pay-button]').disabled = false; }
});
$('[data-connect-sales]').addEventListener('click', async () => {
  const button = $('[data-connect-sales]'); button.disabled = true;
  status('Opening Stripe to connect read-only sales tracking…');
  try {
    const result = await request('connect_sales_start');
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.hostname !== 'connect.stripe.com') throw new Error('The Stripe connection address could not be verified.');
    location.assign(url.toString());
  } catch (error) { status(error.message, true); button.disabled = false; }
});
$('[data-maintenance-button]').addEventListener('click', async () => {
  const button = $('[data-maintenance-button]'); button.disabled = true;
  status('Opening Stripe to confirm monthly maintenance…');
  try {
    const result = await request('maintenance_checkout');
    if (result.awaitingConfirmation) { await loadQuote(); status('Stripe is confirming your maintenance subscription. Do not submit it again.'); }
    else {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('The Stripe subscription address could not be verified.');
      location.assign(url.toString());
    }
  } catch (error) { status(error.message, true); button.disabled = false; }
});
$('[data-reload-quote]').addEventListener('click', loadQuote);
loadQuote();
setInterval(() => { if (!document.hidden && quote?.paymentPlan.type === 'pay_as_you_sell') loadQuote(); }, 15000);
