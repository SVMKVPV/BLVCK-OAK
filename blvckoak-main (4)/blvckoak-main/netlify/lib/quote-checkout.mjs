import { randomBytes } from 'node:crypto';
import { PortalError } from './portal-auth.mjs';
import { notifyQuotePayment } from './quote-notifications.mjs';
import { CUSTOM_CHECKOUT_VERSION, nextPayment, quoteLink, settleQuotePayment } from './quotes.mjs';
import { stopCompletedSalesTracking } from './pay-as-you-sell.mjs';

export function checkoutParameters(quote, attempt) {
  const link = new URL(quoteLink(quote));
  link.searchParams.set('payment', 'returned');
  const cancel = new URL(quoteLink(quote));
  cancel.searchParams.set('payment', 'cancelled');
  const metadata = { checkout_version: CUSTOM_CHECKOUT_VERSION, quote_id: quote.id, quote_revision: String(quote.revision), attempt_id: attempt.id, payment_stage: attempt.stage, partner_code: quote.referralCode, commission_policy: 'owner_review_required' };
  return {
    mode: 'payment', payment_method_types: ['card'], customer_email: quote.customerEmail,
    billing_address_collection: 'required', customer_creation: 'always',
    client_reference_id: quote.id, metadata, payment_intent_data: { metadata },
    success_url: link.toString(), cancel_url: cancel.toString(),
    line_items: [{ quantity: 1, price_data: { currency: 'aud', unit_amount: attempt.amountCents, product_data: { name: `${quote.service} — ${attempt.stage === 'deposit' ? 'deposit' : attempt.stage === 'balance' ? 'remaining balance' : attempt.stage === 'sales_contribution' ? 'Pay as You Sell contribution' : 'full payment'}`, description: quote.description.slice(0, 480) } } }],
  };
}

export async function reconcileQuoteCheckout(quote, stripe, store, notify = notifyQuotePayment) {
  if (!quote.checkout?.sessionId) return quote;
  const session = await stripe.checkout.sessions.retrieve(quote.checkout.sessionId);
  if (session.payment_status !== 'paid') return quote;
  const updated = await settleQuotePayment(session, store);
  await notify(updated, session);
  return stopCompletedSalesTracking(updated, stripe, store);
}

export async function openQuoteCheckout(id, stripe, store) {
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) throw new PortalError('Quote not found.', 404);
    if (!['approved', 'deposit_paid'].includes(quote.status)) throw new PortalError('This quote is not accepting payments.', 409);
    if (!quote.checkout) {
      const payment = nextPayment(quote);
      if (!payment) throw new PortalError('This quote is paid, expired or needs an owner review.', 409);
      const attempt = { ...payment, id: randomBytes(16).toString('hex'), createdAt: Date.now() };
      const saved = await store.setJSON(`quote/${id}`, { ...quote, checkout: attempt }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
      continue;
    }
    const attempt = quote.checkout;
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
      const latest = await store.getWithMetadata(`quote/${id}`, { type: 'json' });
      if (latest?.data?.checkout?.id === attempt.id) await store.setJSON(`quote/${id}`, { ...latest.data, checkout: null }, { onlyIfMatch: latest.etag });
      continue;
    }
    if (session.status !== 'open' || !session.url) throw new PortalError('Payment is processing. Please wait for confirmation.', 409);
    return { url: session.url };
  }
  throw new PortalError('Checkout is being prepared. Try again in a moment.', 409);
}
