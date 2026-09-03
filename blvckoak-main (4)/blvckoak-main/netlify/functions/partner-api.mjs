import { createOnboardingLink, getStripe, isReferralAccountEligible, json, referralsStore } from '../lib/referrals.mjs';
import { emailShell, escapeHtml, formatAud, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { PortalError, assertCsrf, clientError, ensureReferral, hash, portalStore, quoteIdPattern, readBody, requireAccount, sessionCookie, siteOrigin } from '../lib/portal-auth.mjs';
import { createQuote, grossPaid, quoteLink, validateQuoteInput } from '../lib/quotes.mjs';
import { applyProjectProgress, projectProgressLink, readProjectProgress } from '../lib/project-progress.mjs';
import { publicPaymentArrangement } from '../lib/pay-as-you-sell.mjs';
import { applyPortfolio, readPortfolio } from '../lib/portfolio.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 40 } };

async function notifyQuote(quote, approved = false) {
  const ownerEmail = getOwnerEmail();
  const to = approved ? quote.partnerEmail : ownerEmail;
  if (!to) return;
  const title = approved ? 'Your client quote is approved' : 'New custom quote to review';
  const url = approved ? quoteLink(quote) : `${siteOrigin()}/partners.html`;
  await sendEmail({ to, subject: `${title} — ${quote.service}`, text: `${quote.service}\n${quote.description}\nClient: ${quote.customerName} (${quote.customerEmail})\nTotal: ${formatAud(quote.totalCents)}\nDeposit: ${formatAud(quote.depositCents)}\n${url}`, html: emailShell(title, `<p style="color:#b6b5ae;line-height:1.8"><strong>${escapeHtml(quote.service)}</strong><br>Client: ${escapeHtml(quote.customerName)}<br>Total: ${formatAud(quote.totalCents)} · Deposit: ${formatAud(quote.depositCents)}</p><p style="color:#b6b5ae;white-space:pre-wrap">${escapeHtml(quote.description)}</p><p><a style="color:#f1d48c" href="${escapeHtml(url)}">${approved ? 'Open the client payment page' : 'Review in the owner dashboard'}</a></p>`), idempotencyKey: `quote-${approved ? 'approved' : 'submitted'}-${quote.id}-${quote.revision}` }).catch((error) => console.error('Quote notification failed:', error.name));
}

function dashboardQuote(quote, isOwner = false) {
  const { publicToken, checkout, projectProgress, paymentPlan, maintenance, portfolio, ...safe } = quote;
  const clientReady = !['pending_approval', 'declined'].includes(quote.status);
  const paidCents = grossPaid(quote);
  return {
    ...safe,
    paidCents,
    progress: readProjectProgress(quote),
    ...publicPaymentArrangement(quote, paidCents),
    ...(isOwner ? { portfolio: readPortfolio(quote) } : {}),
    paymentLink: ['approved', 'deposit_paid', 'paid'].includes(quote.status) ? quoteLink(quote) : null,
    progressLink: clientReady ? projectProgressLink(quote) : null,
  };
}

async function consumeQuoteQuota(store, auth) {
  const key = `quote-quota/${auth.account.id}/${new Date().toISOString().slice(0, 10)}`;
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(key, { type: 'json' });
    const count = entry?.data?.count || 0;
    if (count >= (auth.isOwner ? 100 : 20)) throw new PortalError('Daily quote limit reached. Contact Black Oak.', 429);
    const updated = await store.setJSON(key, { count: count + 1 }, entry?.etag ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (updated.modified) return;
  }
  throw new PortalError('Please try again shortly.', 409);
}

export default async function handler(request) {
  try {
    const store = portalStore();
    const auth = await requireAccount(request, store);
    if (request.method === 'GET') {
      const referral = await ensureReferral(auth.account);
      const prefix = auth.isOwner ? 'quote-index/' : `partner-quotes/${auth.account.id}/`;
      const { blobs } = await store.list({ prefix });
      const recent = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 100);
      const quotes = (await Promise.all(recent.map(async ({ key }) => {
        const id = key.split('/').at(-1);
        const quote = await store.get(`quote/${id}`, { type: 'json' });
        if (!quote || (!auth.isOwner && quote.partnerId !== auth.account.id)) return null;
        return dashboardQuote(quote, auth.isOwner);
      }))).filter(Boolean);
      let payoutReady = false;
      if (referral.stripeAccountId && process.env.STRIPE_SECRET_KEY) {
        payoutReady = await getStripe().accounts.retrieve(referral.stripeAccountId).then(isReferralAccountEligible).catch(() => false);
      }
      return json({ account: { name: auth.account.name, email: auth.account.email }, isOwner: auth.isOwner, csrf: auth.session.csrf, referral: { code: referral.code, payoutReady }, quotes, limit: 100 });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    assertCsrf(request, auth);
    const body = await readBody(request);
    if (body.action === 'logout') {
      await store.delete(auth.sessionKey);
      return json({ signedOut: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }
    if (body.action === 'onboard') {
      const stripe = getStripe();
      const referralStore = referralsStore();
      let referral = await ensureReferral(auth.account, referralStore);
      if (!referral.stripeAccountId) {
        const account = await stripe.accounts.create({ type: 'express', country: process.env.REFERRAL_COUNTRY || 'AU', email: auth.account.email, capabilities: { transfers: { requested: true } }, metadata: { referral_code: referral.code, referral_program: 'black_oak' }, business_profile: { product_description: 'Black Oak referral and marketing partner' } }, { idempotencyKey: `black-oak-referral-account-${referral.code}` });
        await stripe.accounts.update(account.id, { settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: process.env.REFERRAL_PAYOUT_DAY || 'friday' } } } });
        const entry = await referralStore.getWithMetadata(`code/${referral.code}`, { type: 'json' });
        const saved = await referralStore.setJSON(`code/${referral.code}`, { ...entry.data, stripeAccountId: account.id }, { onlyIfMatch: entry.etag });
        if (!saved.modified) throw new PortalError('Your payout profile is updating. Try again.', 409);
        referral = { ...entry.data, stripeAccountId: account.id };
      }
      const link = await createOnboardingLink(stripe, referral, request);
      return json({ url: link.url });
    }
    if (body.action === 'create_quote') {
      if (!/^[A-Za-z0-9-]{16,80}$/.test(body.requestId || '')) throw new PortalError('Refresh before creating another quote.');
      const id = hash(`${auth.account.id}:${body.requestId}`).slice(0, 32);
      let quote = await store.get(`quote/${id}`, { type: 'json' });
      if (!quote) {
        const referral = await ensureReferral(auth.account);
        quote = { ...createQuote(body, auth.account, referral.code, auth.isOwner), id };
        await consumeQuoteQuota(store, auth);
        await store.setJSON(`quote/${id}`, quote, { onlyIfNew: true });
        quote = await store.get(`quote/${id}`, { type: 'json' });
      }
      await store.set(`quote-index/${quote.createdAt}/${id}`, id, { onlyIfNew: true });
      await store.set(`partner-quotes/${auth.account.id}/${quote.createdAt}/${id}`, id, { onlyIfNew: true });
      await notifyQuote(quote, auth.isOwner);
      return json({ quote: dashboardQuote(quote, auth.isOwner) }, 201);
    }
    if (body.action === 'cancel_quote') {
      if (!auth.isOwner) throw new PortalError('Only the Black Oak owner can cancel a quote.', 403);
      if (!quoteIdPattern.test(body.id || '')) throw new PortalError('Invalid quote.');
      const entry = await store.getWithMetadata(`quote/${body.id}`, { type: 'json' });
      const quote = entry?.data;
      if (!quote || quote.status !== 'approved' || grossPaid(quote) > 0) throw new PortalError('Only an approved, unpaid quote can be cancelled here.', 409);
      if (quote.checkout) {
        if (!quote.checkout.sessionId) throw new PortalError('Checkout is in progress or uncertain. Reconcile it before cancellation.', 409);
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(quote.checkout.sessionId);
        if (session.payment_status === 'paid' || session.status === 'complete') throw new PortalError('A payment is processing or paid. Wait for confirmation and use Stripe for refunds.', 409);
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        else if (session.status !== 'expired') throw new PortalError('Payment state needs review before cancellation.', 409);
      }
      const updated = { ...quote, status: 'cancelled', checkout: null, cancelledAt: new Date().toISOString(), cancelledBy: auth.account.id };
      const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
      if (!saved.modified) throw new PortalError('The quote changed. Refresh before cancelling.', 409);
      if (quote.paymentPlan?.connectedStripeAccountId) await store.delete(`pay-as-you-sell-account/${quote.paymentPlan.connectedStripeAccountId}`);
      return json({ quote: dashboardQuote(updated, auth.isOwner) });
    }
    if (body.action === 'update_progress') {
      if (!auth.isOwner) throw new PortalError('Only the Black Oak owner can update client progress.', 403);
      if (!quoteIdPattern.test(body.id || '')) throw new PortalError('Invalid project.');
      const entry = await store.getWithMetadata(`quote/${body.id}`, { type: 'json' });
      const quote = entry?.data;
      if (!quote || !['approved', 'deposit_paid', 'paid', 'payment_review'].includes(quote.status)) throw new PortalError('Only an approved project can receive progress updates.', 409);
      const updated = applyProjectProgress(quote, body, auth.account.id);
      const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
      if (!saved.modified) throw new PortalError('This project changed. Refresh before saving progress.', 409);
      return json({ quote: dashboardQuote(updated, auth.isOwner) });
    }
    if (body.action === 'update_portfolio') {
      if (!auth.isOwner) throw new PortalError('Only the Black Oak owner can publish portfolio work.', 403);
      if (!quoteIdPattern.test(body.id || '')) throw new PortalError('Invalid project.');
      const entry = await store.getWithMetadata(`quote/${body.id}`, { type: 'json' });
      const quote = entry?.data;
      if (!quote || !['approved', 'deposit_paid', 'paid', 'payment_review'].includes(quote.status)) throw new PortalError('Only an approved project can be added to the portfolio.', 409);
      const updated = applyPortfolio(quote, body, auth.account.id);
      if (updated.portfolio.published) {
        const indexKey = `portfolio-index/${updated.portfolio.id}`;
        const indexedQuote = await store.get(indexKey, { type: 'text' });
        if (indexedQuote && indexedQuote !== quote.id) throw new PortalError('Could not reserve this portfolio listing. Refresh and try again.', 409);
        if (!indexedQuote) {
          const reserved = await store.set(indexKey, quote.id, { onlyIfNew: true });
          if (!reserved.modified && await store.get(indexKey, { type: 'text' }) !== quote.id) throw new PortalError('Could not reserve this portfolio listing. Refresh and try again.', 409);
        }
      }
      const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
      if (!saved.modified) throw new PortalError('This project changed. Refresh before saving the portfolio listing.', 409);
      return json({ quote: dashboardQuote(updated, true) });
    }
    if (['approve_quote', 'decline_quote'].includes(body.action)) {
      if (!auth.isOwner) throw new PortalError('Only the Black Oak owner can approve prices.', 403);
      if (!quoteIdPattern.test(body.id || '')) throw new PortalError('Invalid quote.');
      const entry = await store.getWithMetadata(`quote/${body.id}`, { type: 'json' });
      const quote = entry?.data;
      if (!quote || quote.status !== 'pending_approval' || quote.revision !== body.revision) throw new PortalError('This quote changed. Refresh before reviewing it.', 409);
      const approved = body.action === 'approve_quote';
      const updated = { ...quote, ...(approved ? validateQuoteInput(body) : {}), status: approved ? 'approved' : 'declined', revision: quote.revision + 1, reviewedAt: new Date().toISOString(), reviewedBy: auth.account.id, reviewNote: String(body.reviewNote || '').trim().slice(0, 500), ...(approved ? { approvedAt: new Date().toISOString(), approvedBy: auth.account.id, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() } : {}) };
      const saved = await store.setJSON(`quote/${quote.id}`, updated, { onlyIfMatch: entry.etag });
      if (!saved.modified) throw new PortalError('This quote changed. Please refresh.', 409);
      if (approved) await notifyQuote(updated, true);
      return json({ quote: dashboardQuote(updated, auth.isOwner) });
    }
    throw new PortalError('Unknown partner action.');
  } catch (error) {
    console.error('Partner dashboard request failed:', error.name);
    const result = clientError(error); return json({ error: result.error }, result.status);
  }
}
