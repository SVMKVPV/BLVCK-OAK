// Custom subscription agreements: a quote whose payment option is a recurring
// Stripe subscription instead of a one-off project price. The client reviews a
// written agreement on their private quote page, signs it by typing their name,
// and only then is Stripe Subscription Checkout opened.
import { PortalError, hash, secretToken, siteOrigin } from './portal-auth.mjs';

export const SUBSCRIPTION_PLAN_TYPE = 'subscription';
export const SUBSCRIPTION_VERSION = 'black_oak_subscription_v1';
export const SUBSCRIPTION_STATUSES = Object.freeze(['offered', 'checkout_pending', 'active', 'past_due', 'cancelled']);

export const SUBSCRIPTION_INTERVALS = Object.freeze({
  week: Object.freeze({ interval: 'week', count: 1, label: 'week', adverb: 'weekly' }),
  fortnight: Object.freeze({ interval: 'week', count: 2, label: 'fortnight', adverb: 'fortnightly' }),
  month: Object.freeze({ interval: 'month', count: 1, label: 'month', adverb: 'monthly' }),
  quarter: Object.freeze({ interval: 'month', count: 3, label: 'quarter', adverb: 'quarterly' }),
  year: Object.freeze({ interval: 'year', count: 1, label: 'year', adverb: 'yearly' }),
});

const MIN_AMOUNT = 1000; // A$10 per billing period
const MAX_AMOUNT = 5000000; // A$50,000 per billing period
const MIN_SETUP = 5000; // A$50 when a setup fee is charged
const MAX_SETUP = 10000000; // A$100,000
const MAX_INVOICE_RECORDS = 60;

function cents(value, label, minimum, maximum) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) throw new PortalError(`Enter a valid ${label} in AUD with at most two decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (amount < minimum || amount > maximum) throw new PortalError(`The ${label} must be between A$${(minimum / 100).toLocaleString('en-AU')} and A$${(maximum / 100).toLocaleString('en-AU')}.`);
  return amount;
}

function wholeNumber(value, label, minimum, maximum) {
  const text = String(value ?? '').trim() || '0';
  if (!/^\d{1,4}$/.test(text) || Number(text) < minimum || Number(text) > maximum) throw new PortalError(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  return Number(text);
}

const money = (amountCents) => `A$${(amountCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function validateSubscriptionPlan(input) {
  const intervalKey = String(input.subscriptionInterval || '');
  if (!Object.hasOwn(SUBSCRIPTION_INTERVALS, intervalKey)) throw new PortalError('Choose how often the subscription is billed.');
  const setupText = String(input.subscriptionSetupFee ?? '').trim();
  const setupFeeCents = !setupText || /^0+(?:\.0{1,2})?$/.test(setupText) ? 0 : cents(setupText, 'setup fee', MIN_SETUP, MAX_SETUP);
  const terms = String(input.subscriptionTerms ?? '').replace(/\r\n?/g, '\n').trim();
  if (terms.length > 4000) throw new PortalError('Additional agreement terms must be 4,000 characters or fewer.');
  return {
    type: SUBSCRIPTION_PLAN_TYPE,
    version: SUBSCRIPTION_VERSION,
    interval: intervalKey,
    amountCents: cents(input.subscriptionAmount, 'subscription amount', MIN_AMOUNT, MAX_AMOUNT),
    setupFeeCents,
    minimumTermCycles: wholeNumber(input.subscriptionMinimumTerm, 'Minimum term', 0, 60),
    noticeDays: wholeNumber(input.subscriptionNoticeDays, 'Cancellation notice', 0, 90),
    terms,
    status: 'offered',
    checkout: null,
  };
}

export function readSubscriptionPlan(quote) {
  const plan = quote?.paymentPlan;
  if (plan?.type !== SUBSCRIPTION_PLAN_TYPE || !Object.hasOwn(SUBSCRIPTION_INTERVALS, plan.interval)) return null;
  if (!Number.isInteger(plan.amountCents) || plan.amountCents < MIN_AMOUNT || plan.amountCents > MAX_AMOUNT) return null;
  if (!Number.isInteger(plan.setupFeeCents) || (plan.setupFeeCents !== 0 && (plan.setupFeeCents < MIN_SETUP || plan.setupFeeCents > MAX_SETUP))) return null;
  return {
    type: SUBSCRIPTION_PLAN_TYPE,
    version: SUBSCRIPTION_VERSION,
    interval: plan.interval,
    amountCents: plan.amountCents,
    setupFeeCents: plan.setupFeeCents,
    minimumTermCycles: Number.isInteger(plan.minimumTermCycles) ? plan.minimumTermCycles : 0,
    noticeDays: Number.isInteger(plan.noticeDays) ? plan.noticeDays : 0,
    terms: typeof plan.terms === 'string' ? plan.terms : '',
    status: SUBSCRIPTION_STATUSES.includes(plan.status) ? plan.status : 'offered',
    checkout: plan.checkout && typeof plan.checkout === 'object' ? plan.checkout : null,
    ...(typeof plan.subscriptionId === 'string' ? { subscriptionId: plan.subscriptionId } : {}),
    ...(plan.acceptance && typeof plan.acceptance === 'object' ? { acceptance: plan.acceptance } : {}),
    ...(plan.activatedAt ? { activatedAt: plan.activatedAt } : {}),
    ...(plan.cancelledAt ? { cancelledAt: plan.cancelledAt } : {}),
    invoices: Array.isArray(plan.invoices) ? plan.invoices.filter((item) => typeof item?.invoiceId === 'string' && Number.isInteger(item.amountCents)) : [],
  };
}

export function isSubscriptionQuote(quote) {
  return quote?.paymentPlan?.type === SUBSCRIPTION_PLAN_TYPE;
}

export function billingSummary(plan) {
  const interval = SUBSCRIPTION_INTERVALS[plan.interval];
  return `${money(plan.amountCents)} per ${interval.label}${plan.setupFeeCents ? ` + ${money(plan.setupFeeCents)} one-off setup fee` : ''}`;
}

// The agreement text is generated on the server from approved values only, so
// what the client reads is exactly what is hashed and recorded on acceptance.
export function subscriptionAgreementText(quote) {
  const plan = readSubscriptionPlan(quote);
  if (!plan) throw new PortalError('This quote does not include a subscription agreement.', 409);
  const interval = SUBSCRIPTION_INTERVALS[plan.interval];
  const firstCharge = plan.amountCents + plan.setupFeeCents;
  const sections = [
    'SUBSCRIPTION AGREEMENT',
    'BLVCK OAK · ACN 701 878 775 · ABN 57 799 643 567',
    `Agreement reference: ${quote.id.slice(0, 12).toUpperCase()}-R${quote.revision}`,
    `Client: ${quote.customerName} (${quote.customerEmail})`,
    `Service: ${quote.service}`,
    '',
    `1. Services. Black Oak will provide the following services for as long as this subscription is active:\n${quote.description}`,
    `2. Fees. ${money(plan.amountCents)} (AUD, including any applicable GST) is charged ${interval.adverb} in advance by card through Stripe, starting on the day you accept this agreement.${plan.setupFeeCents ? ` A one-off setup fee of ${money(plan.setupFeeCents)} is charged with the first payment, so the first charge is ${money(firstCharge)}.` : ''}`,
    `3. Term. ${plan.minimumTermCycles ? `There is a minimum term of ${plan.minimumTermCycles} ${interval.label}${plan.minimumTermCycles === 1 ? '' : 's'}. After the minimum term, the subscription continues ${interval.adverb} until cancelled.` : `There is no minimum term. The subscription continues ${interval.adverb} until cancelled.`}`,
    `4. Cancellation. ${plan.noticeDays ? `Either party may cancel by giving ${plural(plan.noticeDays, 'day')} written notice.` : 'Either party may cancel by written notice at any time.'}${plan.minimumTermCycles ? ' A cancellation that takes effect before the minimum term ends does not reduce fees for the minimum term, unless Black Oak agrees otherwise in writing.' : ''} Cancellation takes effect at the end of the billing period in which the notice period ends, and no further charges are made after that.`,
    '5. Changes. Any change to the price, billing frequency or services requires a new written agreement that you accept.',
    '6. Payments. If a payment fails, Stripe may retry it and Black Oak may pause the services until the account is up to date.',
    '7. Refunds and your rights. Fees already paid are not refundable except as set out in the Black Oak refund policy or as required by law. Nothing in this agreement excludes your rights under the Australian Consumer Law.',
    ...(plan.terms ? [`8. Additional agreed terms:\n${plan.terms}`] : []),
    `${plan.terms ? '9' : '8'}. This agreement sits alongside the Black Oak service terms (${siteOrigin()}/terms.html), refund policy (${siteOrigin()}/refunds.html) and privacy policy (${siteOrigin()}/privacy.html). If they conflict, this agreement applies to this subscription.`,
    '',
    `By typing your full name and accepting, you agree to this subscription agreement and authorise Black Oak to charge the card you enter on Stripe ${money(plan.amountCents)} ${interval.adverb}${plan.setupFeeCents ? ` (plus the ${money(plan.setupFeeCents)} setup fee with the first payment)` : ''} until the subscription is cancelled.`,
  ];
  return sections.join('\n');
}

export const agreementHash = (quote) => hash(subscriptionAgreementText(quote));

export function publicSubscription(quote) {
  const plan = readSubscriptionPlan(quote);
  if (!plan) return { type: SUBSCRIPTION_PLAN_TYPE, invalid: true };
  const interval = SUBSCRIPTION_INTERVALS[plan.interval];
  return {
    type: SUBSCRIPTION_PLAN_TYPE,
    interval: plan.interval,
    intervalLabel: interval.label,
    intervalAdverb: interval.adverb,
    amountCents: plan.amountCents,
    setupFeeCents: plan.setupFeeCents,
    firstChargeCents: plan.amountCents + plan.setupFeeCents,
    minimumTermCycles: plan.minimumTermCycles,
    noticeDays: plan.noticeDays,
    terms: plan.terms,
    status: plan.status,
    summary: billingSummary(plan),
    agreementText: subscriptionAgreementText(quote),
    agreementHash: agreementHash(quote),
    ...(plan.acceptance ? { acceptedBy: plan.acceptance.name, acceptedAt: plan.acceptance.acceptedAt } : {}),
    ...(plan.activatedAt ? { activatedAt: plan.activatedAt } : {}),
    invoicesPaid: plan.invoices.length,
    collectedCents: plan.invoices.reduce((sum, item) => sum + item.amountCents, 0),
    lastPaidAt: plan.invoices.at(-1)?.paidAt || null,
  };
}

function returnLink(quote, result) {
  const url = new URL(`${siteOrigin()}/pay.html?quote=${quote.id}#${quote.publicToken}`);
  url.searchParams.set('subscription', result);
  return url.toString();
}

export function subscriptionCheckoutParameters(quote, attempt) {
  const plan = readSubscriptionPlan(quote);
  if (!plan) throw new PortalError('This quote does not include a subscription agreement.', 409);
  const interval = SUBSCRIPTION_INTERVALS[plan.interval];
  const metadata = {
    checkout_version: SUBSCRIPTION_VERSION, quote_id: quote.id, quote_revision: String(quote.revision),
    attempt_id: attempt.id, agreement_hash: attempt.agreementHash, partner_code: quote.referralCode || '',
    commission_policy: 'owner_review_required',
  };
  const lineItems = [{
    quantity: 1,
    price_data: {
      currency: 'aud', unit_amount: plan.amountCents,
      recurring: { interval: interval.interval, interval_count: interval.count },
      product_data: { name: `${quote.service} — ${interval.adverb} subscription`, description: quote.description.slice(0, 480) },
    },
  }];
  if (plan.setupFeeCents) {
    lineItems.push({ quantity: 1, price_data: { currency: 'aud', unit_amount: plan.setupFeeCents, product_data: { name: `${quote.service} — one-off setup fee` } } });
  }
  return {
    mode: 'subscription', customer_email: quote.customerEmail,
    integration_identifier: 'blvckoak_subscription_agreement',
    billing_address_collection: 'required', client_reference_id: quote.id, metadata,
    subscription_data: { metadata, description: `Subscription agreement ${quote.id.slice(0, 12).toUpperCase()}-R${quote.revision}` },
    success_url: returnLink(quote, 'returned'),
    cancel_url: returnLink(quote, 'cancelled'),
    line_items: lineItems,
  };
}

function assertAcceptance(quote, plan, acceptance) {
  const name = String(acceptance?.acceptedName ?? '').replace(/\s+/g, ' ').trim();
  if (acceptance?.accepted !== true) throw new PortalError('Tick the box to confirm you accept the subscription agreement.');
  if (name.length < 2 || name.length > 100) throw new PortalError('Type your full name to sign the agreement.');
  const currentHash = agreementHash(quote);
  if (acceptance.agreementHash !== currentHash) throw new PortalError('This agreement has changed since you opened it. Refresh the page and review it again.', 409);
  if (Date.parse(quote.expiresAt) <= Date.now() && plan.status === 'offered') throw new PortalError('This subscription offer has expired. Contact Black Oak for a new agreement.', 409);
  return { name, agreementHash: currentHash };
}

export async function openSubscriptionCheckout(quoteId, acceptance, stripe, store) {
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) throw new PortalError('Quote not found.', 404);
    const plan = readSubscriptionPlan(quote);
    if (!plan) throw new PortalError('This quote does not include a subscription agreement.', 409);
    if (plan.status === 'active' || plan.status === 'past_due' || quote.status === 'subscribed') throw new PortalError('This subscription has already been accepted.', 409);
    if (quote.status !== 'approved') throw new PortalError('This subscription agreement is not open for acceptance.', 409);
    if (!plan.checkout) {
      const signed = assertAcceptance(quote, plan, acceptance);
      const acceptedAt = new Date().toISOString();
      const attempt = { id: secretToken(), createdAt: Date.now(), sessionId: null, agreementHash: signed.agreementHash };
      const updated = {
        ...quote,
        paymentPlan: { ...plan, status: 'checkout_pending', checkout: attempt, acceptance: { name: signed.name, acceptedAt, agreementHash: signed.agreementHash, agreementText: subscriptionAgreementText(quote), quoteRevision: quote.revision } },
        updatedAt: acceptedAt,
      };
      const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
      continue;
    }
    const attempt = plan.checkout;
    let session;
    if (attempt.sessionId) session = await stripe.checkout.sessions.retrieve(attempt.sessionId);
    else {
      // Never replace an uncertain attempt with a new idempotency key: it could already be complete.
      if (Date.now() - attempt.createdAt > 23 * 60 * 60_000) throw new PortalError('This subscription checkout needs a Black Oak review before retrying.', 409);
      session = await stripe.checkout.sessions.create(subscriptionCheckoutParameters(quote, attempt), { idempotencyKey: `bo-subscription-${quoteId}-${attempt.id}` });
      const saved = await store.setJSON(`quote/${quoteId}`, { ...quote, paymentPlan: { ...plan, checkout: { ...attempt, sessionId: session.id } } }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
    }
    if (session.status === 'complete') return { awaitingConfirmation: true };
    if (session.status === 'expired') {
      await clearAttempt(quoteId, attempt.id, store);
      continue;
    }
    if (session.status !== 'open' || !session.url) throw new PortalError('Subscription checkout is processing. Please wait for confirmation.', 409);
    return { url: session.url };
  }
  throw new PortalError('Subscription checkout is being prepared. Try again shortly.', 409);
}

async function clearAttempt(quoteId, attemptId, store) {
  const latest = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
  const plan = readSubscriptionPlan(latest?.data);
  if (!plan || plan.checkout?.id !== attemptId) return latest?.data || null;
  const { acceptance, ...rest } = plan;
  const updated = { ...latest.data, paymentPlan: { ...rest, status: 'offered', checkout: null }, updatedAt: new Date().toISOString() };
  const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: latest.etag });
  return saved.modified ? updated : latest.data;
}

export async function settleSubscriptionCheckout(session, store) {
  if (session?.metadata?.checkout_version !== SUBSCRIPTION_VERSION || session.mode !== 'subscription' || session.status !== 'complete' || typeof session.subscription !== 'string') return null;
  const quoteId = session.metadata.quote_id;
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) throw new PortalError('Invalid subscription checkout.', 409);
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) throw new PortalError('Subscription quote not found.', 404);
    const plan = readSubscriptionPlan(quote);
    if (!plan) throw new PortalError('Subscription checkout did not match a subscription quote.', 409);
    if (plan.subscriptionId === session.subscription) return quote;
    if (plan.checkout?.id !== session.metadata.attempt_id || Number(session.metadata.quote_revision) !== quote.revision
      || session.metadata.agreement_hash !== plan.acceptance?.agreementHash || (plan.checkout.sessionId && plan.checkout.sessionId !== session.id)) {
      throw new PortalError('Subscription checkout did not match the accepted agreement.', 409);
    }
    const now = new Date().toISOString();
    const updated = { ...quote, status: 'subscribed', paymentPlan: { ...plan, status: 'active', subscriptionId: session.subscription, checkout: null, activatedAt: now }, updatedAt: now };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (!saved.modified) continue;
    await store.set(`subscription-agreement/${session.subscription}`, quote.id, { onlyIfNew: true });
    return updated;
  }
  throw new PortalError('Subscription confirmation is busy. Retry safely.', 409);
}

export async function releaseFailedSubscriptionCheckout(session, store) {
  if (session?.metadata?.checkout_version !== SUBSCRIPTION_VERSION || session.payment_status !== 'unpaid') return null;
  const quoteId = session.metadata.quote_id;
  if (!/^[a-f0-9]{32}$/.test(quoteId || '') || !session.metadata.attempt_id) return null;
  const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
  const plan = readSubscriptionPlan(entry?.data);
  if (!plan?.checkout || plan.checkout.sessionId !== session.id) return entry?.data || null;
  return clearAttempt(quoteId, session.metadata.attempt_id, store);
}

export async function reconcileSubscriptionCheckout(quote, stripe, store) {
  const plan = readSubscriptionPlan(quote);
  if (!plan?.checkout?.sessionId) return quote;
  const session = await stripe.checkout.sessions.retrieve(plan.checkout.sessionId);
  if (session.status === 'complete') return await settleSubscriptionCheckout(session, store) || quote;
  if (session.status === 'expired') return await clearAttempt(quote.id, plan.checkout.id, store) || quote;
  return quote;
}

// Owner cancellation of an offer that has not been accepted yet.
export async function expireOpenSubscriptionCheckout(quote, stripe) {
  const plan = readSubscriptionPlan(quote);
  if (!plan?.checkout) return;
  if (!plan.checkout.sessionId) throw new PortalError('Subscription checkout is in progress or uncertain. Try again shortly.', 409);
  const session = await stripe.checkout.sessions.retrieve(plan.checkout.sessionId);
  if (session.status === 'complete') throw new PortalError('The client has already started this subscription. Cancel it in Stripe instead.', 409);
  if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
}

async function quoteForSubscription(subscriptionId, store) {
  if (typeof subscriptionId !== 'string' || !subscriptionId) return null;
  const quoteId = await store.get(`subscription-agreement/${subscriptionId}`, { type: 'text' });
  return /^[a-f0-9]{32}$/.test(quoteId || '') ? quoteId : null;
}

export async function updateSubscriptionAgreement(subscription, store) {
  const quoteId = await quoteForSubscription(subscription?.id, store);
  if (!quoteId) return null;
  const status = ['active', 'trialing'].includes(subscription.status) ? 'active'
    : ['past_due', 'unpaid', 'incomplete', 'paused'].includes(subscription.status) ? 'past_due' : 'cancelled';
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const plan = readSubscriptionPlan(entry?.data);
    if (!plan) return null;
    if (plan.status === status) return entry.data;
    const now = new Date().toISOString();
    const updated = { ...entry.data, paymentPlan: { ...plan, status, ...(status === 'cancelled' ? { cancelledAt: now } : {}) }, updatedAt: now };
    const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Subscription status update is busy. Retry safely.', 409);
}

function invoiceSubscriptionId(invoice) {
  if (typeof invoice?.subscription === 'string') return invoice.subscription;
  const fromParent = invoice?.parent?.subscription_details?.subscription;
  return typeof fromParent === 'string' ? fromParent : fromParent?.id || null;
}

// Records each paid subscription invoice so the dashboard can show what has been collected.
export async function recordSubscriptionInvoice(invoice, store) {
  const quoteId = await quoteForSubscription(invoiceSubscriptionId(invoice), store);
  if (!quoteId || typeof invoice.id !== 'string' || invoice.currency !== 'aud' || !Number.isInteger(invoice.amount_paid) || invoice.amount_paid <= 0) return null;
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const plan = readSubscriptionPlan(entry?.data);
    if (!plan) return null;
    if (plan.invoices.some((item) => item.invoiceId === invoice.id)) return entry.data;
    const paidAt = new Date((invoice.status_transitions?.paid_at || Math.floor(Date.now() / 1000)) * 1000).toISOString();
    const invoices = [...plan.invoices, { invoiceId: invoice.id, amountCents: invoice.amount_paid, paidAt }].slice(-MAX_INVOICE_RECORDS);
    const updated = { ...entry.data, paymentPlan: { ...plan, invoices, ...(plan.status === 'past_due' ? { status: 'active' } : {}) }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Subscription invoice update is busy. Retry safely.', 409);
}
