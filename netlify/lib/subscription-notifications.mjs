import { emailShell, escapeHtml, getOwnerEmail, sendEmail } from './email.mjs';
import { quoteLink } from './quotes.mjs';
import { billingSummary, readSubscriptionPlan } from './subscriptions.mjs';

// Sent once when a client signs a subscription agreement and Stripe confirms it.
export async function notifySubscriptionStarted(quote) {
  const plan = readSubscriptionPlan(quote);
  if (!plan?.subscriptionId) return;
  const summary = billingSummary(plan);
  const signed = plan.acceptance ? `Signed by ${plan.acceptance.name} on ${new Date(plan.acceptance.acceptedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} (Sydney time).` : '';
  const link = quoteLink(quote);
  const messages = [
    { to: quote.customerEmail, type: 'customer', title: 'Your subscription is active' },
    { to: getOwnerEmail(), type: 'owner', title: 'New subscription agreement signed' },
    { to: quote.partnerEmail, type: 'partner', title: 'Your client started their subscription' },
  ].filter((item) => item.to);
  const results = await Promise.allSettled(messages.map(({ to, type, title }) => sendEmail({
    to,
    subject: `${title} — ${quote.service}`,
    text: `${quote.service}\nClient: ${quote.customerName}\nBilling: ${summary}\n${signed}\nA copy of the signed agreement is on the private agreement page: ${link}`,
    html: emailShell(title, `<p style="color:#b6b5ae;line-height:1.8"><strong>${escapeHtml(quote.service)}</strong><br>Client: ${escapeHtml(quote.customerName)}<br>Billing: ${escapeHtml(summary)}<br>${escapeHtml(signed)}</p><p><a style="color:#f1d48c" href="${escapeHtml(link)}">View the signed agreement and billing status</a></p>`),
    idempotencyKey: `subscription-started-${type}-${plan.subscriptionId}`,
  })));
  results.filter((item) => item.status === 'rejected').forEach((item) => console.error('Subscription notification failed:', item.reason?.name));
}
