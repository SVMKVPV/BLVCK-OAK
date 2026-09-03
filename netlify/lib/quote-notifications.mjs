import { emailShell, escapeHtml, formatAud, getOwnerEmail, sendEmail } from './email.mjs';
import { grossPaid, quoteLink } from './quotes.mjs';

export async function notifyQuotePayment(quote, session) {
  if (session.payment_status !== 'paid') return;
  const payment = quote.payments.find((item) => item.sessionId === session.id);
  if (!payment) return;
  const stageLabel = payment.stage === 'sales_contribution' ? 'Pay as You Sell contribution' : payment.stage.replaceAll('_', ' ');
  const remaining = Math.max(0, quote.totalCents - grossPaid(quote));
  const description = `${quote.service}\n${quote.description}\nClient: ${quote.customerName}\nPayment: ${formatAud(payment.amountCents)} (${stageLabel})\nRemaining: ${formatAud(remaining)}`;
  const owner = getOwnerEmail();
  const messages = [{ to: quote.customerEmail, type: 'customer' }, { to: owner, type: 'owner' }, { to: quote.partnerEmail, type: 'partner' }].filter((item) => item.to);
  const results = await Promise.allSettled(messages.map(({ to, type }) => sendEmail({
    to, subject: `Black Oak ${stageLabel} received — ${quote.service}`,
    text: `${description}\n${quoteLink(quote)}\nCustom quote commission is subject to a separate owner agreement.`,
    html: emailShell('Payment received', `<p style="color:#b6b5ae;line-height:1.8">${escapeHtml(quote.service)}<br>${formatAud(payment.amountCents)} received as ${escapeHtml(stageLabel)}.<br>Remaining: ${formatAud(remaining)}</p><p style="color:#b6b5ae;white-space:pre-wrap">${escapeHtml(quote.description)}</p><p><a style="color:#f1d48c" href="${escapeHtml(quoteLink(quote))}">View the quote and payment record</a></p>`),
    idempotencyKey: `custom-payment-${type}-${session.id}`,
  })));
  results.filter((item) => item.status === 'rejected').forEach((item) => console.error('Custom payment notification failed:', item.reason?.name));
}
