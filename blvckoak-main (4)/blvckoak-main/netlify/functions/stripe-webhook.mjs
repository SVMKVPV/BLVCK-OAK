import {
  CHECKOUT_VERSION,
  calculateEnterpriseReferralReward,
  calculateReward,
  emailKey,
  expectedPaidAmount,
  getPackage,
  getRewardHoldDays,
  getStripe,
  isReferralAccountEligible,
  isValidCode,
  json,
  normaliseCode,
  referralsStore,
  rewardsStore,
  sameEmail,
} from '../lib/referrals.mjs';
import { emailShell, escapeHtml, formatAud, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { CUSTOM_CHECKOUT_VERSION, markQuotePaymentReview, nextPayment, settleQuotePayment } from '../lib/quotes.mjs';
import { portalStore } from '../lib/portal-auth.mjs';
import { notifyQuotePayment } from '../lib/quote-notifications.mjs';
import { MAINTENANCE_VERSION, adjustConnectedSale, disconnectSalesAccount, recordConnectedSale, settleMaintenanceCheckout, stopCompletedSalesTracking, updateMaintenanceSubscription } from '../lib/pay-as-you-sell.mjs';

async function reviewCustomCharge(stripe, charge, reason) {
  const id = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!id) return;
  const intent = await stripe.paymentIntents.retrieve(id);
  if (intent.metadata?.checkout_version === CUSTOM_CHECKOUT_VERSION) {
    await markQuotePaymentReview(charge, reason, portalStore(), intent.metadata.quote_id);
  }
}

async function expireChangedSalesCheckout(stripe, quote, store) {
  if (!quote?.checkout?.sessionId || quote.checkout.stage !== 'sales_contribution') return;
  const currentDue = nextPayment(quote);
  if (currentDue?.amountCents === quote.checkout.amountCents) return;
  const session = await stripe.checkout.sessions.retrieve(quote.checkout.sessionId);
  if (session.status !== 'open') return;
  await stripe.checkout.sessions.expire(session.id);
  const entry = await store.getWithMetadata(`quote/${quote.id}`, { type: 'json' });
  if (entry?.data?.checkout?.id === quote.checkout.id) await store.setJSON(`quote/${quote.id}`, { ...entry.data, checkout: null }, { onlyIfMatch: entry.etag });
}

async function sendPurchaseNotifications(session) {
  if (session.payment_status !== 'paid' || !session.amount_total) return;

  const packageItem = getPackage(session.metadata?.package_id);
  if (!packageItem || session.metadata?.checkout_version !== CHECKOUT_VERSION) return;
  if (Number(session.metadata?.package_list_price_cents) !== packageItem.priceCents) return;

  const referralCode = normaliseCode(session.client_reference_id || '');
  const hasReferral = session.metadata?.referral_program === 'black_oak_verified_partner' && isValidCode(referralCode);
  if (session.metadata?.referral_program !== 'none' && !hasReferral) return;
  if (session.amount_total !== expectedPaidAmount(packageItem.id, hasReferral)) return;

  const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
  const ownerEmail = getOwnerEmail();
  const amount = formatAud(session.amount_total);
  const contactUrl = new URL('/contact.html', process.env.SITE_URL || 'https://blvckoak.netlify.app').toString();
  const notifications = [];

  if (customerEmail) {
    notifications.push(sendEmail({
      to: customerEmail,
      subject: `Payment received — Black Oak ${packageItem.name.replace('Black Oak ', '')}`,
      text: `We received your ${amount} payment for ${packageItem.name}. Black Oak will contact you with onboarding and kick-off details. Support: ${contactUrl}`,
      html: emailShell('Your build is reserved', `
        <p style="color:#b6b5ae;line-height:1.7">We received your <strong style="color:#f1d48c">${escapeHtml(amount)}</strong> payment for ${escapeHtml(packageItem.name)}.</p>
        <p style="color:#b6b5ae;line-height:1.7">Black Oak will contact you with onboarding and kick-off details. If anything in the order needs attention, use the <a href="${escapeHtml(contactUrl)}" style="color:#f1d48c">secure contact page</a>.</p>`),
      idempotencyKey: `purchase-customer-${session.id}`,
    }));
  }

  if (ownerEmail) {
    notifications.push(sendEmail({
      to: ownerEmail,
      subject: `New paid ${packageItem.id} project — ${amount}`,
      text: `A paid ${packageItem.name} checkout completed for ${amount}. Customer: ${customerEmail || 'See Stripe'}. Session: ${session.id}. Referral: ${hasReferral ? referralCode : 'none'}.`,
      html: emailShell('New paid project', `
        <p style="color:#b6b5ae;line-height:1.7"><strong>${escapeHtml(packageItem.name)}</strong> was paid in full for <strong style="color:#f1d48c">${escapeHtml(amount)}</strong>.</p>
        <p style="color:#b6b5ae;line-height:1.7">Customer: ${escapeHtml(customerEmail || 'See Stripe')}<br>Stripe session: ${escapeHtml(session.id)}<br>Referral: ${escapeHtml(hasReferral ? referralCode : 'none')}</p>`),
      idempotencyKey: `purchase-owner-${session.id}`,
    }));
  }

  const results = await Promise.allSettled(notifications);
  results.filter((result) => result.status === 'rejected').forEach((result) => console.error('Purchase email failed:', result.reason?.message));
}

function proportionalReward(originalRewardCents, grossPaidCents, remainingPaidCents) {
  if (remainingPaidCents <= 0 || grossPaidCents <= 0) return 0;
  return Math.max(0, Math.round(originalRewardCents * (remainingPaidCents / grossPaidCents)));
}

async function getSessionCharge(stripe, session) {
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
  if (!paymentIntentId) return { paymentIntentId: null, charge: null };
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : null;
  return { paymentIntentId, charge };
}

async function recordCompletedCheckout(stripe, session) {
  if (session.payment_status !== 'paid' || !session.amount_total) return;

  const code = normaliseCode(session.client_reference_id || '');
  if (!isValidCode(code)) return;

  const packageItem = getPackage(session.metadata?.package_id);
  const expectedRewardPolicy = packageItem?.id === 'enterprise' ? 'enterprise_list_price' : 'standard';
  const metadataValid = packageItem
    && session.metadata?.checkout_version === CHECKOUT_VERSION
    && session.metadata?.referral_program === 'black_oak_verified_partner'
    && normaliseCode(session.metadata?.referral_code || '') === code
    && session.metadata?.reward_policy === expectedRewardPolicy
    && Number(session.metadata?.package_list_price_cents) === packageItem.priceCents;
  if (!metadataValid) throw new Error(`Rejected untrusted referral checkout ${session.id}.`);

  const expectedPaidCents = expectedPaidAmount(packageItem.id, true);
  if (session.amount_total !== expectedPaidCents || String(session.currency).toLowerCase() !== 'aud') {
    throw new Error(`Rejected unexpected referral amount for ${session.id}.`);
  }

  const referral = await referralsStore().get(`code/${code}`, { type: 'json', consistency: 'strong' });
  if (!referral || referral.status === 'suspended' || referral.status === 'closed') return;

  const account = await stripe.accounts.retrieve(referral.stripeAccountId);
  if (!sameEmail(account.email, referral.email) || !isReferralAccountEligible(account)) return;

  const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
  if (!customerEmail || sameEmail(customerEmail, referral.email)) return;

  const { paymentIntentId, charge } = await getSessionCharge(stripe, session);
  if (!paymentIntentId || !charge || charge.currency !== 'aud' || charge.status !== 'succeeded') {
    throw new Error(`No settled AUD charge found for ${session.id}.`);
  }

  const grossPaidCents = session.amount_total;
  const remainingPaidCents = Math.max(0, charge.amount - charge.amount_refunded);
  const originalRewardCents = packageItem.id === 'enterprise'
    ? calculateEnterpriseReferralReward()
    : calculateReward(grossPaidCents);
  const rewardCents = proportionalReward(originalRewardCents, grossPaidCents, remainingPaidCents);
  const createdAtMs = Math.max(Date.now(), Number(session.created || 0) * 1000);
  const status = charge.disputed ? 'disputed' : rewardCents > 0 ? 'pending' : 'cancelled';

  const reward = {
    sessionId: session.id,
    paymentIntentId,
    sourceChargeId: charge.id,
    referralCode: code,
    packageId: packageItem.id,
    customerEmailHash: emailKey(customerEmail),
    amountPaidCents: remainingPaidCents,
    grossPaidCents,
    rewardCents,
    originalRewardCents,
    rewardPolicy: packageItem.id === 'enterprise' ? 'enterprise_list_price' : 'standard',
    currency: 'aud',
    status,
    eligibleAt: new Date(createdAtMs + getRewardHoldDays() * 86400000).toISOString(),
    createdAt: new Date(createdAtMs).toISOString(),
  };

  const store = rewardsStore();
  const saved = await store.setJSON(`reward/${session.id}`, reward, { onlyIfNew: true });
  if (saved.modified) {
    await store.set(`payment/${paymentIntentId}`, session.id, { onlyIfNew: true });
    await store.set(`charge/${charge.id}`, session.id, { onlyIfNew: true });
  }
  if (status === 'pending') await store.set(`pending/${session.id}`, session.id, { onlyIfNew: true });
}

async function findRewardByCharge(store, charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  const sessionId = await store.get(`charge/${charge.id}`, { type: 'text', consistency: 'strong' })
    || (paymentIntentId ? await store.get(`payment/${paymentIntentId}`, { type: 'text', consistency: 'strong' }) : null);
  if (!sessionId) return null;
  const entry = await store.getWithMetadata(`reward/${sessionId}`, { type: 'json', consistency: 'strong' });
  return entry?.data ? { sessionId, entry, reward: entry.data } : null;
}

async function adjustRefundedReward(stripe, charge) {
  const store = rewardsStore();
  const found = await findRewardByCharge(store, charge);
  if (!found) return;
  const { sessionId, entry, reward } = found;
  if (reward.status === 'processing') {
    throw new Error(`Reward payout is in progress for ${sessionId}; retry the refund event.`);
  }
  const remainingPaidCents = Math.max(0, charge.amount - charge.amount_refunded);
  const adjustedRewardCents = proportionalReward(
    reward.originalRewardCents || reward.rewardCents,
    reward.grossPaidCents || charge.amount,
    remainingPaidCents,
  );
  const reductionCents = Math.max(0, reward.rewardCents - adjustedRewardCents);

  if (reward.status === 'transferred' && reward.transferId && reductionCents > 0) {
    const reversal = await stripe.transfers.createReversal(
      reward.transferId,
      { amount: reductionCents, metadata: { reason: 'customer_refund', session_id: sessionId } },
      { idempotencyKey: `referral-refund-${charge.id}-${charge.amount_refunded}` },
    );
    reward.reversalIds = [...(reward.reversalIds || []), reversal.id];
  }

  reward.amountPaidCents = remainingPaidCents;
  reward.rewardCents = adjustedRewardCents;
  if (adjustedRewardCents === 0) reward.status = 'cancelled';
  reward.updatedAt = new Date().toISOString();
  await store.setJSON(`reward/${sessionId}`, reward, { onlyIfMatch: entry.etag });
  if (reward.status === 'pending') await store.set(`pending/${sessionId}`, sessionId, { onlyIfNew: true });
  else await store.delete(`pending/${sessionId}`);
}

async function suspendDisputedReward(stripe, dispute) {
  const charge = typeof dispute.charge === 'string' ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
  if (!charge) return;
  const store = rewardsStore();
  const found = await findRewardByCharge(store, charge);
  if (!found) return;
  const { sessionId, entry, reward } = found;
  if (reward.status === 'processing') {
    throw new Error(`Reward payout is in progress for ${sessionId}; retry the dispute event.`);
  }

  if (reward.status === 'transferred' && reward.transferId && reward.rewardCents > 0) {
    const reversal = await stripe.transfers.createReversal(
      reward.transferId,
      { amount: reward.rewardCents, metadata: { reason: 'customer_dispute', session_id: sessionId } },
      { idempotencyKey: `referral-dispute-${dispute.id}` },
    );
    reward.reversalIds = [...(reward.reversalIds || []), reversal.id];
  }

  reward.status = 'disputed';
  reward.disputeId = dispute.id;
  reward.updatedAt = new Date().toISOString();
  await store.setJSON(`reward/${sessionId}`, reward, { onlyIfMatch: entry.etag });
  await store.delete(`pending/${sessionId}`);
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const store = rewardsStore();
  let eventKey = null;
  try {
    const signature = request.headers.get('stripe-signature');
    const webhookSecrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
    if (!signature || !webhookSecrets.length) return json({ error: 'Webhook is not configured.' }, 503);

    const stripe = getStripe();
    const payload = await request.text();
    let event = null;
    for (const secret of webhookSecrets) {
      try { event = stripe.webhooks.constructEvent(payload, signature, secret); break; }
      catch (error) { if (error?.type !== 'StripeSignatureVerificationError' && error?.name !== 'StripeSignatureVerificationError') throw error; }
    }
    if (!event) throw new Error('Webhook signature verification failed.');
    eventKey = `event/${event.id}`;
    const reservation = await store.set(eventKey, `processing:${Date.now()}`, { onlyIfNew: true });
    if (!reservation.modified) {
      const previousKey = eventKey;
      eventKey = null;
      const prior = await store.getWithMetadata(previousKey, { type: 'text', consistency: 'strong' });
      if (prior?.data?.startsWith('processed:')) return json({ received: true, duplicate: true });
      const started = Number(prior?.data?.split(':')[1] || 0);
      if (!prior?.etag || Date.now() - started < 120000) return json({ error: 'This event is processing. Retry shortly.' }, 503);
      const reclaimed = await store.set(previousKey, `processing:${Date.now()}`, { onlyIfMatch: prior.etag });
      if (!reclaimed.modified) return json({ error: 'This event is processing. Retry shortly.' }, 503);
      eventKey = previousKey;
    }

    if (event.account && event.type === 'payment_intent.succeeded') {
      await recordConnectedSale(event.data.object, event.account, portalStore());
    } else if (event.account && event.type === 'charge.refunded') {
      const quote = await adjustConnectedSale(event.data.object, event.account, portalStore());
      await expireChangedSalesCheckout(stripe, quote, portalStore());
    } else if (event.account && event.type === 'charge.dispute.created') {
      const chargeId = typeof event.data.object.charge === 'string' ? event.data.object.charge : event.data.object.charge?.id;
      const charge = chargeId ? await stripe.charges.retrieve(chargeId, {}, { stripeAccount: event.account }) : null;
      if (charge) {
        const quote = await adjustConnectedSale(charge, event.account, portalStore(), true);
        await expireChangedSalesCheckout(stripe, quote, portalStore());
      }
    } else if (event.account && event.type === 'account.application.deauthorized') {
      await disconnectSalesAccount(event.account, portalStore());
    } else if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (event.data.object.metadata?.checkout_version === MAINTENANCE_VERSION) {
        await settleMaintenanceCheckout(event.data.object, portalStore());
      } else if (event.data.object.metadata?.checkout_version === CUSTOM_CHECKOUT_VERSION) {
        const quote = await settleQuotePayment(event.data.object);
        await notifyQuotePayment(quote, event.data.object);
        await stopCompletedSalesTracking(quote, stripe, portalStore());
      } else {
        await recordCompletedCheckout(stripe, event.data.object);
        await sendPurchaseNotifications(event.data.object);
      }
    } else if (['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      await updateMaintenanceSubscription(event.data.object, portalStore());
    } else if (event.type === 'charge.refunded') {
      await reviewCustomCharge(stripe, event.data.object, 'refund');
      await adjustRefundedReward(stripe, event.data.object);
    } else if (event.type === 'charge.dispute.created') {
      const charge = typeof event.data.object.charge === 'string' ? await stripe.charges.retrieve(event.data.object.charge) : event.data.object.charge;
      if (charge) await reviewCustomCharge(stripe, charge, 'dispute');
      await suspendDisputedReward(stripe, event.data.object);
    }

    await store.set(eventKey, `processed:${event.type}`);
    return json({ received: true });
  } catch (error) {
    if (eventKey) await store.delete(eventKey).catch(() => {});
    console.error('Stripe webhook failed:', error.message);
    return json({ error: 'Webhook verification or processing failed.' }, 400);
  }
}
