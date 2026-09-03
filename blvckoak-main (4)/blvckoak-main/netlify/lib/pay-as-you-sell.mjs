import { PortalError, hash, secretToken, siteOrigin } from './portal-auth.mjs';
import { getStripe, runtimeEnv } from './referrals.mjs';

export const PAY_AS_YOU_SELL_VERSION = 'black_oak_pay_as_you_sell_v1';
export const MAINTENANCE_VERSION = 'black_oak_maintenance_v1';

const methodLabels = Object.freeze({
  percentage: 'Percentage of every Stripe sale',
  fixed_per_sale: 'Fixed amount from every Stripe sale',
  sales_milestone: 'Fixed payment after a set number of sales',
});

function moneyToCents(value, label, minimum = 1, maximum = 10000000) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) throw new PortalError(`Enter a valid ${label} amount in AUD.`);
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < minimum || cents > maximum) throw new PortalError(`${label} must be between A$${(minimum / 100).toFixed(2)} and A$${(maximum / 100).toLocaleString('en-AU')}.`);
  return cents;
}

function checked(value) {
  return value === true || value === 'true' || value === 'on';
}

export function validatePaymentArrangement(input) {
  const requestedType = String(input.paymentPlan || 'standard');
  if (!['standard', 'pay_as_you_sell'].includes(requestedType)) throw new PortalError('Choose a valid payment option.');
  const type = requestedType;
  let paymentPlan = { type: 'standard', version: PAY_AS_YOU_SELL_VERSION };
  if (type === 'pay_as_you_sell') {
    const method = String(input.payAsYouSellMethod || '');
    if (!Object.hasOwn(methodLabels, method)) throw new PortalError('Choose how Stripe sales contribute to the project.');
    paymentPlan = {
      type,
      version: PAY_AS_YOU_SELL_VERSION,
      method,
      connectionStatus: 'not_connected',
      sales: [],
    };
    if (method === 'percentage') {
      const percent = Number(input.payAsYouSellPercent);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100 || Math.round(percent * 100) !== percent * 100) throw new PortalError('The sales contribution must be between 1% and 100%, with at most two decimal places.');
      paymentPlan.rateBps = Math.round(percent * 100);
    } else {
      paymentPlan.amountCents = moneyToCents(input.payAsYouSellAmount, 'sales contribution', 500, 10000000);
      if (method === 'sales_milestone') {
        const salesPerPayment = Number(input.payAsYouSellSalesCount);
        if (!Number.isInteger(salesPerPayment) || salesPerPayment < 1 || salesPerPayment > 1000) throw new PortalError('Choose between 1 and 1,000 sales for each fixed payment.');
        paymentPlan.salesPerPayment = salesPerPayment;
      }
    }
  }

  const maintenanceEnabled = checked(input.maintenanceEnabled);
  const maintenance = maintenanceEnabled ? {
    enabled: true,
    version: MAINTENANCE_VERSION,
    monthlyCents: moneyToCents(input.maintenanceMonthly, 'monthly maintenance', 2500, 1000000),
    status: 'offered',
  } : { enabled: false, version: MAINTENANCE_VERSION, status: 'not_offered' };
  return { paymentPlan, maintenance };
}

export function readPaymentPlan(quote) {
  const plan = quote?.paymentPlan;
  if (!plan || plan.type !== 'pay_as_you_sell' || !Object.hasOwn(methodLabels, plan.method)) return { type: 'standard', version: PAY_AS_YOU_SELL_VERSION };
  if (plan.method === 'percentage' && (!Number.isInteger(plan.rateBps) || plan.rateBps < 100 || plan.rateBps > 10000)) return { type: 'standard', version: PAY_AS_YOU_SELL_VERSION };
  if (plan.method !== 'percentage' && (!Number.isInteger(plan.amountCents) || plan.amountCents < 500 || plan.amountCents > 10000000)) return { type: 'standard', version: PAY_AS_YOU_SELL_VERSION };
  if (plan.method === 'sales_milestone' && (!Number.isInteger(plan.salesPerPayment) || plan.salesPerPayment < 1 || plan.salesPerPayment > 1000)) return { type: 'standard', version: PAY_AS_YOU_SELL_VERSION };
  return {
    ...plan,
    connectionStatus: plan.connectionStatus === 'connected' && /^acct_[A-Za-z0-9]+$/.test(plan.connectedStripeAccountId || '') ? 'connected' : plan.connectionStatus === 'completed' ? 'completed' : 'not_connected',
    sales: Array.isArray(plan.sales) ? plan.sales.filter((sale) => typeof sale?.paymentIntentId === 'string' && Number.isInteger(sale.netCents) && sale.netCents >= 0) : [],
  };
}

export function readMaintenance(quote) {
  const maintenance = quote?.maintenance;
  if (!maintenance?.enabled || !Number.isInteger(maintenance.monthlyCents) || maintenance.monthlyCents < 2500) return { enabled: false, version: MAINTENANCE_VERSION, status: 'not_offered' };
  return {
    enabled: true,
    version: MAINTENANCE_VERSION,
    monthlyCents: maintenance.monthlyCents,
    status: ['offered', 'checkout_pending', 'active', 'cancelled', 'past_due'].includes(maintenance.status) ? maintenance.status : 'offered',
    ...(typeof maintenance.subscriptionId === 'string' ? { subscriptionId: maintenance.subscriptionId } : {}),
    ...(maintenance.checkout && typeof maintenance.checkout === 'object' ? { checkout: maintenance.checkout } : {}),
  };
}

export function salesContributionCents(quote) {
  const plan = readPaymentPlan(quote);
  if (plan.type !== 'pay_as_you_sell') return 0;
  const sales = plan.sales.filter((sale) => sale.netCents > 0 && !sale.disputed);
  let contribution = 0;
  if (plan.method === 'percentage') contribution = sales.reduce((sum, sale) => sum + Math.round(sale.netCents * plan.rateBps / 10000), 0);
  if (plan.method === 'fixed_per_sale') contribution = sales.reduce((sum, sale) => sum + Math.min(sale.netCents, plan.amountCents), 0);
  if (plan.method === 'sales_milestone') contribution = Math.floor(sales.length / plan.salesPerPayment) * plan.amountCents;
  return Math.min(Math.max(0, quote.totalCents - quote.depositCents), contribution);
}

export function payAsYouSellAccruedCents(quote) {
  if (readPaymentPlan(quote).type !== 'pay_as_you_sell') return quote.totalCents;
  return Math.min(quote.totalCents, quote.depositCents + salesContributionCents(quote));
}

export function publicPaymentArrangement(quote, paidCents) {
  const plan = readPaymentPlan(quote);
  const maintenance = readMaintenance(quote);
  const publicMaintenance = maintenance.enabled ? { enabled: true, monthlyCents: maintenance.monthlyCents, status: maintenance.status } : { enabled: false, status: 'not_offered' };
  if (plan.type !== 'pay_as_you_sell') return { paymentPlan: { type: 'standard' }, maintenance: publicMaintenance };
  const sales = plan.sales.filter((sale) => !sale.disputed && sale.netCents > 0);
  const method = {
    type: plan.method,
    label: methodLabels[plan.method],
    ...(plan.rateBps ? { percent: plan.rateBps / 100 } : {}),
    ...(plan.amountCents ? { amountCents: plan.amountCents } : {}),
    ...(plan.salesPerPayment ? { salesPerPayment: plan.salesPerPayment } : {}),
  };
  const accruedCents = payAsYouSellAccruedCents(quote);
  return {
    paymentPlan: {
      type: 'pay_as_you_sell', method,
      connected: plan.connectionStatus === 'connected',
      trackingComplete: plan.connectionStatus === 'completed',
      salesCount: sales.length,
      grossSalesCents: sales.reduce((sum, sale) => sum + sale.netCents, 0),
      contributionCents: salesContributionCents(quote),
      accruedCents,
      dueCents: Math.max(0, accruedCents - paidCents),
      balanceCents: Math.max(0, quote.totalCents - paidCents),
    },
    maintenance: publicMaintenance,
  };
}

export async function createSalesConnectionUrl(quote, store) {
  if (readPaymentPlan(quote).type !== 'pay_as_you_sell') throw new PortalError('This quote does not use Pay as You Sell.', 409);
  if (!['approved', 'deposit_paid'].includes(quote.status)) throw new PortalError('This Pay as You Sell quote is not accepting a Stripe connection.', 409);
  if (readPaymentPlan(quote).connectionStatus === 'connected') throw new PortalError('Stripe sales are already connected.', 409);
  const clientId = runtimeEnv('STRIPE_CONNECT_CLIENT_ID');
  if (!/^ca_[A-Za-z0-9]+$/.test(clientId || '')) throw new PortalError('Stripe sales tracking is not configured yet. Contact Black Oak.', 503);
  const state = secretToken();
  await store.setJSON(`pay-as-you-sell-oauth/${hash(state)}`, { quoteId: quote.id, expiresAt: Date.now() + 10 * 60_000 }, { onlyIfNew: true });
  const url = new URL('https://connect.stripe.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'read_only');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', `${siteOrigin()}/api/stripe/connect/callback`);
  return url.toString();
}

export async function completeSalesConnection(code, state, store) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !/^ac_[A-Za-z0-9_-]+$/.test(code || '')) throw new PortalError('The Stripe connection response is incomplete.', 400);
  const stateKey = `pay-as-you-sell-oauth/${hash(state)}`;
  const stateEntry = await store.getWithMetadata(stateKey, { type: 'json' });
  const pending = stateEntry?.data;
  if (!pending || pending.used || pending.expiresAt <= Date.now()) throw new PortalError('This Stripe connection expired. Return to the quote and try again.', 400);
  const claimed = await store.setJSON(stateKey, { ...pending, used: true }, { onlyIfMatch: stateEntry.etag });
  if (!claimed.modified) throw new PortalError('This Stripe connection was already used.', 409);
  const entry = await store.getWithMetadata(`quote/${pending.quoteId}`, { type: 'json' });
  const quote = entry?.data;
  if (!quote || !['approved', 'deposit_paid'].includes(quote.status) || readPaymentPlan(quote).type !== 'pay_as_you_sell') throw new PortalError('This Pay as You Sell quote is unavailable.', 404);
  const response = await getStripe().oauth.token({ grant_type: 'authorization_code', code });
  const accountId = response.stripe_user_id;
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId || '') || response.scope !== 'read_only') throw new PortalError('Stripe did not grant the required read-only sales access.', 409);
  const accountKey = `pay-as-you-sell-account/${accountId}`;
  const existingQuoteId = await store.get(accountKey, { type: 'text' });
  if (existingQuoteId && existingQuoteId !== quote.id) throw new PortalError('That Stripe account is already linked to another active Pay as You Sell project.', 409);
  if (!existingQuoteId) {
    const reserved = await store.set(accountKey, quote.id, { onlyIfNew: true });
    if (!reserved.modified && await store.get(accountKey, { type: 'text' }) !== quote.id) throw new PortalError('That Stripe account was linked to another project.', 409);
  }
  const updated = { ...quote, paymentPlan: { ...readPaymentPlan(quote), connectedStripeAccountId: accountId, connectionStatus: 'connected', connectedAt: new Date().toISOString() } };
  const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
  if (!saved.modified) throw new PortalError('The quote changed while Stripe was connecting. Contact Black Oak.', 409);
  await store.delete(stateKey);
  return updated;
}

export async function recordConnectedSale(paymentIntent, connectedAccountId, store) {
  if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccountId || '') || paymentIntent?.status !== 'succeeded' || String(paymentIntent.currency).toLowerCase() !== 'aud') return null;
  const amount = Math.round(Number(paymentIntent.amount_received) || 0);
  if (amount <= 0 || !/^pi_[A-Za-z0-9]+$/.test(paymentIntent.id || '')) return null;
  const quoteId = await store.get(`pay-as-you-sell-account/${connectedAccountId}`, { type: 'text' });
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) return null;
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) return null;
    const plan = readPaymentPlan(quote);
    if (plan.type !== 'pay_as_you_sell' || plan.connectedStripeAccountId !== connectedAccountId || !['approved', 'deposit_paid'].includes(quote.status)) return quote;
    if (plan.sales.some((sale) => sale.paymentIntentId === paymentIntent.id)) return quote;
    const sale = { paymentIntentId: paymentIntent.id, grossCents: amount, netCents: amount, disputed: false, recordedAt: new Date(Math.max(0, Number(paymentIntent.created) * 1000) || Date.now()).toISOString() };
    const updated = { ...quote, paymentPlan: { ...plan, sales: [...plan.sales, sale], lastSaleAt: sale.recordedAt }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Stripe sale recording is busy. Retry safely.', 409);
}

export async function adjustConnectedSale(charge, connectedAccountId, store, disputed = false) {
  const paymentIntentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : '';
  if (!paymentIntentId || !/^acct_[A-Za-z0-9]+$/.test(connectedAccountId || '')) return null;
  const quoteId = await store.get(`pay-as-you-sell-account/${connectedAccountId}`, { type: 'text' });
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) return null;
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) return null;
    const plan = readPaymentPlan(quote);
    const index = plan.sales.findIndex((sale) => sale.paymentIntentId === paymentIntentId);
    if (index < 0 || quote.status === 'paid') return quote;
    const current = plan.sales[index];
    const netCents = disputed ? 0 : Math.max(0, Math.round(Number(charge.amount) || current.grossCents) - Math.round(Number(charge.amount_refunded) || 0));
    if (current.netCents === netCents && current.disputed === disputed) return quote;
    const sales = plan.sales.slice(); sales[index] = { ...current, netCents, disputed, adjustedAt: new Date().toISOString() };
    const updated = { ...quote, paymentPlan: { ...plan, sales }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Stripe sale adjustment is busy. Retry safely.', 409);
}

export async function disconnectSalesAccount(connectedAccountId, store) {
  const quoteId = await store.get(`pay-as-you-sell-account/${connectedAccountId}`, { type: 'text' });
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) return null;
  const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
  const quote = entry?.data;
  if (!quote) return null;
  const plan = readPaymentPlan(quote);
  const updated = { ...quote, paymentPlan: { ...plan, connectionStatus: 'not_connected', disconnectedAt: new Date().toISOString() } };
  const saved = await store.setJSON(`quote/${quoteId}`, updated, { onlyIfMatch: entry.etag });
  if (saved.modified) await store.delete(`pay-as-you-sell-account/${connectedAccountId}`);
  return saved.modified ? updated : null;
}

export async function stopCompletedSalesTracking(quote, stripe, store) {
  const plan = readPaymentPlan(quote);
  if (quote.status !== 'paid' || plan.type !== 'pay_as_you_sell' || !plan.connectedStripeAccountId || plan.connectionStatus === 'completed') return quote;
  const clientId = runtimeEnv('STRIPE_CONNECT_CLIENT_ID');
  if (!/^ca_[A-Za-z0-9]+$/.test(clientId || '')) return quote;
  try { await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: plan.connectedStripeAccountId }); }
  catch (error) { console.error('Stripe sales tracking disconnect delayed:', error?.name); return quote; }
  await store.delete(`pay-as-you-sell-account/${plan.connectedStripeAccountId}`);
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quote.id}`, { type: 'json' });
    if (!entry?.data) return quote;
    const latestPlan = readPaymentPlan(entry.data);
    if (latestPlan.connectionStatus === 'completed') return entry.data;
    const updated = { ...entry.data, paymentPlan: { ...latestPlan, connectionStatus: 'completed', trackingEndedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  return quote;
}

function maintenanceReturnLink(quote, result) {
  const url = new URL(`${siteOrigin()}/pay.html?quote=${quote.id}#${quote.publicToken}`);
  url.searchParams.set('maintenance', result);
  return url.toString();
}

export function maintenanceCheckoutParameters(quote, attempt) {
  const maintenance = readMaintenance(quote);
  if (!maintenance.enabled) throw new PortalError('Monthly maintenance was not included in this agreement.', 409);
  const metadata = { checkout_version: MAINTENANCE_VERSION, quote_id: quote.id, attempt_id: attempt.id };
  return {
    mode: 'subscription', payment_method_types: ['card'], customer_email: quote.customerEmail,
    billing_address_collection: 'required', client_reference_id: quote.id, metadata,
    subscription_data: { metadata },
    success_url: maintenanceReturnLink(quote, 'returned'),
    cancel_url: maintenanceReturnLink(quote, 'cancelled'),
    line_items: [{ quantity: 1, price_data: { currency: 'aud', unit_amount: maintenance.monthlyCents, recurring: { interval: 'month' }, product_data: { name: `${quote.service} — monthly website maintenance`, description: 'Ongoing website maintenance separately accepted after the project balance was paid.' } } }],
  };
}

export async function settleMaintenanceCheckout(session, store) {
  if (session?.metadata?.checkout_version !== MAINTENANCE_VERSION || session.mode !== 'subscription' || session.status !== 'complete' || typeof session.subscription !== 'string') return null;
  const quoteId = session.metadata.quote_id;
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) throw new PortalError('Invalid maintenance checkout.', 409);
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) throw new PortalError('Maintenance quote not found.', 404);
    const maintenance = readMaintenance(quote);
    if (maintenance.subscriptionId === session.subscription && maintenance.status === 'active') return quote;
    if (!maintenance.enabled || maintenance.checkout?.id !== session.metadata.attempt_id) throw new PortalError('Maintenance checkout did not match the agreed quote.', 409);
    const updated = { ...quote, maintenance: { ...maintenance, status: 'active', subscriptionId: session.subscription, checkout: null, acceptedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (!saved.modified) continue;
    await store.set(`maintenance-subscription/${session.subscription}`, quote.id, { onlyIfNew: true });
    return updated;
  }
  throw new PortalError('Maintenance confirmation is busy. Retry safely.', 409);
}

export async function reconcileMaintenanceCheckout(quote, stripe, store) {
  const maintenance = readMaintenance(quote);
  if (!maintenance.checkout?.sessionId) return quote;
  const session = await stripe.checkout.sessions.retrieve(maintenance.checkout.sessionId);
  return session.status === 'complete' ? await settleMaintenanceCheckout(session, store) || quote : quote;
}

export async function openMaintenanceCheckout(quoteId, stripe, store) {
  for (let tries = 0; tries < 6; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote || quote.status !== 'paid') throw new PortalError('Monthly maintenance can be accepted after the website balance is paid.', 409);
    const maintenance = readMaintenance(quote);
    if (!maintenance.enabled) throw new PortalError('Monthly maintenance was not offered for this project.', 409);
    if (maintenance.status === 'active') throw new PortalError('Monthly maintenance is already active.', 409);
    if (!maintenance.checkout) {
      const attempt = { id: secretToken(), createdAt: Date.now(), sessionId: null };
      const saved = await store.setJSON(`quote/${quoteId}`, { ...quote, maintenance: { ...maintenance, status: 'checkout_pending', checkout: attempt } }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
      continue;
    }
    const attempt = maintenance.checkout;
    let session;
    if (attempt.sessionId) session = await stripe.checkout.sessions.retrieve(attempt.sessionId);
    else {
      if (Date.now() - attempt.createdAt > 23 * 60 * 60_000) throw new PortalError('This maintenance checkout needs a Black Oak review before retrying.', 409);
      session = await stripe.checkout.sessions.create(maintenanceCheckoutParameters(quote, attempt), { idempotencyKey: `bo-maintenance-${quoteId}-${attempt.id}` });
      const saved = await store.setJSON(`quote/${quoteId}`, { ...quote, maintenance: { ...maintenance, checkout: { ...attempt, sessionId: session.id } } }, { onlyIfMatch: entry.etag });
      if (!saved.modified) continue;
    }
    if (session.status === 'complete') return { awaitingConfirmation: true };
    if (session.status === 'expired') {
      const latest = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
      if (latest?.data?.maintenance?.checkout?.id === attempt.id) await store.setJSON(`quote/${quoteId}`, { ...latest.data, maintenance: { ...readMaintenance(latest.data), status: 'offered', checkout: null } }, { onlyIfMatch: latest.etag });
      continue;
    }
    if (session.status !== 'open' || !session.url) throw new PortalError('Maintenance checkout is processing. Please wait for confirmation.', 409);
    return { url: session.url };
  }
  throw new PortalError('Maintenance checkout is being prepared. Try again shortly.', 409);
}

export async function updateMaintenanceSubscription(subscription, store) {
  if (!subscription?.id) return null;
  const quoteId = await store.get(`maintenance-subscription/${subscription.id}`, { type: 'text' });
  if (!/^[a-f0-9]{32}$/.test(quoteId || '')) return null;
  const status = ['active', 'trialing'].includes(subscription.status) ? 'active' : ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'].includes(subscription.status) ? 'past_due' : 'cancelled';
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(`quote/${quoteId}`, { type: 'json' });
    const quote = entry?.data;
    if (!quote) return null;
    const current = readMaintenance(quote);
    if (current.status === status) return quote;
    const updated = { ...quote, maintenance: { ...current, status, subscriptionId: subscription.id, updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
    if (saved.modified) return updated;
  }
  throw new PortalError('Maintenance status update is busy. Retry safely.', 409);
}
