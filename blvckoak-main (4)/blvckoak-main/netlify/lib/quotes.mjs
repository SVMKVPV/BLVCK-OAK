import { randomBytes } from 'node:crypto';
import { PortalError, portalStore, secretToken, siteOrigin, validEmail } from './portal-auth.mjs';
import { payAsYouSellAccruedCents, publicPaymentArrangement, readPaymentPlan, validatePaymentArrangement } from './pay-as-you-sell.mjs';

export const CUSTOM_CHECKOUT_VERSION = 'black_oak_custom_v1';

export function audToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) throw new PortalError('Enter an AUD amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function cleanText(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new PortalError(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}

export function validateQuoteInput(body) {
  const totalCents = audToCents(body.total);
  const depositCents = audToCents(body.deposit || '0');
  if (totalCents < 10000 || totalCents > 10000000) throw new PortalError('Custom totals must be between A$100 and A$100,000.');
  if (depositCents > totalCents) throw new PortalError('The deposit cannot exceed the total.');
  if (depositCents > 0 && depositCents < 5000) throw new PortalError('The minimum deposit is A$50.');
  if (depositCents < totalCents && depositCents > 0 && totalCents - depositCents < 5000) throw new PortalError('The remaining balance must be at least A$50.');
  const customerEmail = String(body.customerEmail || '').trim().toLowerCase();
  if (!validEmail(customerEmail)) throw new PortalError('Enter the client’s email address.');
  return {
    service: cleanText(body.service, 'Service name', 3, 120),
    description: cleanText(body.description, 'Description', 20, 3000),
    customerName: cleanText(body.customerName, 'Client name', 2, 100), customerEmail,
    totalCents, depositCents, ...validatePaymentArrangement(body),
  };
}

export function createQuote(input, account, referralCode, isOwner = false) {
  return {
    id: randomBytes(16).toString('hex'), publicToken: secretToken(), revision: 1,
    ...validateQuoteInput(input), partnerId: account.id, partnerEmail: account.email,
    partnerName: account.name, referralCode, status: isOwner ? 'approved' : 'pending_approval',
    payments: [], checkout: null, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    ...(isOwner ? { approvedAt: new Date().toISOString(), approvedBy: account.id } : {}),
    commissionPolicy: 'owner_review_required',
  };
}

export const grossPaid = (quote) => quote.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
export const refunded = (quote) => quote.payments.reduce((sum, payment) => sum + (payment.refundedCents || 0), 0);

export function nextPayment(quote, now = Date.now()) {
  if (!['approved', 'deposit_paid'].includes(quote.status)) return null;
  const paid = grossPaid(quote);
  const plan = readPaymentPlan(quote);
  if (plan.type !== 'pay_as_you_sell' && !paid && Date.parse(quote.expiresAt) <= now) return null;
  const remaining = quote.totalCents - paid;
  if (remaining <= 0) return null;
  if (!paid && quote.depositCents > 0 && quote.depositCents < quote.totalCents) return { stage: 'deposit', amountCents: quote.depositCents };
  if (plan.type === 'pay_as_you_sell') {
    const due = Math.max(0, payAsYouSellAccruedCents(quote) - paid);
    return due > 0 ? { stage: 'sales_contribution', amountCents: Math.min(remaining, due) } : null;
  }
  return { stage: paid ? 'balance' : 'full', amountCents: remaining };
}

export function quoteLink(quote) {
  return `${siteOrigin()}/pay.html?quote=${quote.id}#${quote.publicToken}`;
}

export function publicQuote(quote) {
  const paidCents = grossPaid(quote);
  return {
    id: quote.id, service: quote.service, description: quote.description, customerName: quote.customerName,
    totalCents: quote.totalCents, depositCents: quote.depositCents, status: quote.status,
    paidCents, refundedCents: refunded(quote), nextPayment: nextPayment(quote),
    expiresAt: quote.expiresAt, createdAt: quote.createdAt,
    payments: quote.payments.map(({ stage, amountCents, paidAt, refundedCents = 0 }) => ({ stage, amountCents, paidAt, refundedCents })),
    ...publicPaymentArrangement(quote, paidCents),
  };
}

export function applyPaidSession(quote, session) {
  if (session.payment_status !== 'paid') return quote;
  if (quote.payments.some((payment) => payment.sessionId === session.id)) return quote;
  const attempt = quote.checkout;
  if (!attempt || session.metadata?.checkout_version !== CUSTOM_CHECKOUT_VERSION
    || session.metadata?.quote_id !== quote.id || session.metadata?.attempt_id !== attempt.id
    || Number(session.metadata?.quote_revision) !== quote.revision
    || session.metadata?.payment_stage !== attempt.stage || session.currency !== 'aud'
    || session.amount_total !== attempt.amountCents
    || (attempt.sessionId && attempt.sessionId !== session.id)
    || typeof session.payment_intent !== 'string'
    || grossPaid(quote) + session.amount_total > quote.totalCents) {
    throw new PortalError('Custom payment did not match its approved quote.', 409);
  }
  const review = quote.paymentReviews?.[session.payment_intent];
  const payment = { sessionId: session.id, paymentIntentId: session.payment_intent, amountCents: session.amount_total, stage: attempt.stage, paidAt: new Date().toISOString(), refundedCents: review?.refundedCents || 0, disputed: Boolean(review?.disputed) };
  return { ...quote, payments: [...quote.payments, payment], status: quote.status === 'payment_review' ? 'payment_review' : (grossPaid(quote) + payment.amountCents === quote.totalCents ? 'paid' : 'deposit_paid'), checkout: null, updatedAt: new Date().toISOString() };
}

export async function settleQuotePayment(session, store = portalStore()) {
  const id = session.metadata?.quote_id;
  if (!/^[a-f0-9]{32}$/.test(id || '')) throw new PortalError('Invalid custom payment metadata.', 400);
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
    if (!entry?.data) throw new PortalError('Quote not found.', 404);
    const updated = applyPaidSession(entry.data, session);
    if (updated !== entry.data) {
      const result = await store.setJSON(`quote/${id}`, updated, { onlyIfMatch: entry.etag });
      if (!result.modified) continue;
    }
    if (session.payment_status === 'paid' && typeof session.payment_intent === 'string') {
      await store.set(`quote-payment/${session.payment_intent}`, id, { onlyIfNew: true });
    }
    return updated;
  }
  throw new PortalError('Payment update is busy. Retry safely.', 409);
}

export async function markQuotePaymentReview(charge, reason, store = portalStore(), fallbackId = '') {
  const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) return null;
  const id = await store.get(`quote-payment/${paymentIntent}`, { type: 'text' }) || fallbackId;
  if (!/^[a-f0-9]{32}$/.test(id || '')) return null;
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
    if (!entry?.data) return null;
    const previousReview = entry.data.paymentReviews?.[paymentIntent] || {};
    const review = { refundedCents: Math.max(previousReview.refundedCents || 0, charge.amount_refunded || 0), disputed: Boolean(previousReview.disputed || charge.disputed || reason === 'dispute') };
    const quote = { ...entry.data, status: 'payment_review', reviewReason: reason, paymentReviews: { ...entry.data.paymentReviews, [paymentIntent]: review }, updatedAt: new Date().toISOString(), payments: entry.data.payments.map((payment) => payment.paymentIntentId === paymentIntent ? { ...payment, ...review } : payment) };
    const result = await store.setJSON(`quote/${id}`, quote, { onlyIfMatch: entry.etag });
    if (result.modified) return quote;
  }
  throw new PortalError('Quote review update is busy.', 409);
}
