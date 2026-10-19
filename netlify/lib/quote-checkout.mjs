import { randomBytes } from 'node:crypto';
import { PortalError, portalStore } from './portal-auth.mjs';
import { notifyQuotePayment } from './quote-notifications.mjs';
import { CUSTOM_CHECKOUT_VERSION, audToCents, grossPaid, nextPayment, quoteLink, settleQuotePayment } from './quotes.mjs';
import { stopCompletedSalesTracking } from './pay-as-you-sell.mjs';
import { INSTALMENT_PLAN_TYPE, instalmentPaymentWithExtra, instalmentStageLabel, validateInstalmentAttempt } from './instalments.mjs';

export function checkoutParameters(quote, attempt) {
  validateInstalmentAttempt(quote, attempt);
  const link = new URL(quoteLink(quote));
  link.searchParams.set('payment', 'returned');
  const cancel = new URL(quoteLink(quote));
  cancel.searchParams.set('payment', 'cancelled');
  const metadata = { checkout_version: CUSTOM_CHECKOUT_VERSION, quote_id: quote.id, quote_revision: String(quote.revision), attempt_id: attempt.id, payment_stage: attempt.stage, partner_code: quote.referralCode, commission_policy: 'owner_review_required' };
  if (attempt.baseAmountCents !== undefined) {
    metadata.base_amount_cents = String(attempt.baseAmountCents);
    metadata.extra_amount_cents = String(attempt.extraAmountCents);
  }
  const extraLabel = attempt.extraAmountCents > 0 ? ` (includes A$${(attempt.extraAmountCents / 100).toFixed(2)} extra)` : '';
  return {
    mode: 'payment', customer_email: quote.customerEmail,
    integration_identifier: 'blvck_oak_custom_qndttcba',
    billing_address_collection: 'required', customer_creation: 'always',
    client_reference_id: quote.id, metadata, payment_intent_data: { metadata },
    success_url: link.toString(), cancel_url: cancel.toString(),
    line_items: [{ quantity: 1, price_data: { currency: 'aud', unit_amount: attempt.amountCents, product_data: { name: `${quote.service} — ${instalmentStageLabel(attempt.stage, attempt.instalmentEndNumber) || (attempt.stage === 'deposit' ? 'deposit' : attempt.stage === 'balance' ? 'remaining balance' : attempt.stage === 'sales_contribution' ? 'Pay as You Sell contribution' : 'full payment')}${extraLabel}`, description: quote.description.slice(0, 480) } } }],
  };
}

export async function releaseFailedQuoteCheckout(session, store = portalStore()) {
  if (session?.metadata?.checkout_version !== CUSTOM_CHECKOUT_VERSION || session.payment_status !== 'unpaid') return null;
  const quoteId = session.metadata.quote_id;
  const attemptId = session.metadata.attempt_id;
  if (!/^[a-f0-9]{32}$/.test(quoteId || '') || !attemptId || !session.id) return null;
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) return null;
    if (!quote.checkout) return quote;
    if (quote.checkout.id !== attemptId || quote.checkout.sessionId !== session.id) return quote;
    const updated = { ...quote, checkout: null, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Failed checkout recovery is busy. Retry safely.', 409);
}

export async function reconcileQuoteCheckout(quote, stripe, store, notify = notifyQuotePayment) {
  if (!quote.checkout?.sessionId) return quote;
  const session = await stripe.checkout.sessions.retrieve(quote.checkout.sessionId);
  if (session.payment_status !== 'paid') return quote;
  const updated = await settleQuotePayment(session, store);
  await notify(updated, session);
  return stopCompletedSalesTracking(updated, stripe, store);
}

async function clearExpiredAttempt(id, attempt, store) {
  const latest = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
  if (latest?.data?.checkout?.id === attempt.id) await store.setJSON(`quote/${id}`, { ...latest.data, checkout: null }, { onlyIfMatch: latest.etag });
}

export async function openQuoteCheckout(id, stripe, store, options = {}) {
  const extraCents = audToCents(options.extraAmount === undefined || options.extraAmount === '' ? '0' : options.extraAmount);
  let expectedPaidCents = options.expectedPaidCents;
  if (expectedPaidCents !== undefined && (!Number.isSafeInteger(expectedPaidCents) || expectedPaidCents < 0)) throw new PortalError('Refresh the quote to confirm the current balance.');
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) throw new PortalError('Quote not found.', 404);
    if (!['approved', 'deposit_paid'].includes(quote.status)) throw new PortalError('This quote is not accepting payments.', 409);
    const instalments = quote.paymentPlan?.type === INSTALMENT_PLAN_TYPE;
    if (!instalments && extraCents) throw new PortalError('Extra payments are available on the 15-part payment plan.');
    const desiredPayment = instalments ? instalmentPaymentWithExtra(quote, extraCents) : null;
    const paidCents = grossPaid(quote);
    // Pin the client's reviewed balance across retries. A concurrent settlement
    // must never silently turn this click into payment of another instalment.
    if (expectedPaidCents === undefined) expectedPaidCents = paidCents;
    if (paidCents !== expectedPaidCents) throw new PortalError('Your balance changed. Refresh the quote before paying again.', 409);
    if (!quote.checkout) {
      const payment = nextPayment(quote);
      if (!payment) throw new PortalError('This quote is paid, expired or needs an owner review.', 409);
      const attempt = { ...(desiredPayment || payment), id: randomBytes(16).toString('hex'), createdAt: Date.now() };
      const saved = await store.setJSON(`quote/${id}`, { ...quote, checkout: attempt }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
      continue;
    }
    const attempt = quote.checkout;
    validateInstalmentAttempt(quote, attempt);
    let session;
    if (attempt.sessionId) {
      session = await stripe.checkout.sessions.retrieve(attempt.sessionId);
    } else {
      // Never replace an uncertain attempt with a new idempotency key: it could already be paid.
      if (Date.now() - attempt.createdAt > 23 * 60 * 60_000) throw new PortalError('This checkout needs reconciliation by Black Oak before another payment.', 409);
      session = await stripe.checkout.sessions.create(checkoutParameters(quote, attempt), { idempotencyKey: `bo-custom-${id}-${attempt.id}` });
      const saved = await store.setJSON(`quote/${id}`, { ...quote, checkout: { ...attempt, sessionId: session.id } }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
    }
    if (session.payment_status === 'paid') {
      // The signed webhook or return-page reconciliation will record this payment.
      return { awaitingConfirmation: true };
    }
    if (session.status === 'expired') {
      await clearExpiredAttempt(id, attempt, store);
      continue;
    }
    if (session.status !== 'open' || !session.url) throw new PortalError('Payment is processing. Please wait for confirmation.', 409);
    if (desiredPayment && attempt.amountCents !== desiredPayment.amountCents) {
      if (!nextPayment(quote)) throw new PortalError('This quote has expired. Contact Black Oak before changing the payment.', 409);
      // Amounts and idempotency keys are immutable. Recover an uncertain create
      // above, then expire its open session before reserving a different amount.
      let expired;
      try { expired = await stripe.checkout.sessions.expire(session.id); }
      catch {
        expired = await stripe.checkout.sessions.retrieve(session.id);
      }
      if (expired.payment_status === 'paid') return { awaitingConfirmation: true };
      if (expired.status !== 'expired') throw new PortalError('The previous payment is still open or processing. Refresh and try again before changing its amount.', 409);
      await clearExpiredAttempt(id, attempt, store);
      continue;
    }
    return { url: session.url };
  }
  throw new PortalError('Checkout is being prepared. Try again in a moment.', 409);
}
