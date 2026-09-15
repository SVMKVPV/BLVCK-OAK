import { emailShell, escapeHtml, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { json } from '../lib/referrals.mjs';
import { listSalesLeads, salesStore } from '../lib/sales-leads.mjs';

export const config = { schedule: '15 * * * *' };

export default async function handler() {
  const store = salesStore();
  const now = Date.now();
  const leads = await listSalesLeads(250, store);
  const due = leads.filter((lead) => lead.status === 'new' && !lead.followUpSentAt && now - new Date(lead.createdAt).getTime() >= 24 * 3600000 && now - new Date(lead.createdAt).getTime() <= 7 * 86400000).slice(0, 25);
  let sent = 0;
  for (const lead of due) {
    const entry = await store.getWithMetadata(`lead/${lead.id}`, { type: 'json' });
    if (!entry?.data || entry.data.followUpSentAt || entry.data.status !== 'new') continue;
    const bookingLink = `${String(process.env.SITE_URL || '').replace(/\/$/, '')}/book.html`;
    await sendEmail({
      to: lead.email,
      subject: 'Still want help with your website?',
      text: `Hi ${lead.name}, just checking in after your ${lead.type === 'audit' ? 'website audit' : 'enquiry'}. If you would like to talk through the next step, request a free consultation: ${bookingLink}`,
      html: emailShell('Ready for the next step?', `<p style="color:#b6b5ae;line-height:1.8">Hi ${escapeHtml(lead.name)}, just checking in after your ${lead.type === 'audit' ? 'website audit' : 'enquiry'}. If you would like to talk through the next step, you can request a free consultation.</p><p><a style="color:#f1d48c" href="${escapeHtml(bookingLink)}">Request a free consultation</a></p>`),
      idempotencyKey: `sales-followup-${lead.id}`,
    });
    const sentAt = new Date().toISOString();
    await store.setJSON(`lead/${lead.id}`, { ...entry.data, followUpSentAt: sentAt, updatedAt: sentAt }, { onlyIfMatch: entry.etag });
    sent += 1;
  }
  const ownerEmail = getOwnerEmail();
  if (sent && ownerEmail) await sendEmail({
    to: ownerEmail,
    subject: `${sent} Black Oak lead follow-up${sent === 1 ? '' : 's'} sent`,
    text: `${sent} automatic 24-hour lead follow-up${sent === 1 ? ' was' : 's were'} sent. Open the owner workspace to review the pipeline.`,
    html: emailShell('Lead follow-ups sent', `<p style="color:#b6b5ae;line-height:1.8">${sent} automatic 24-hour follow-up${sent === 1 ? ' was' : 's were'} sent. Open the owner workspace to review the pipeline.</p>`),
    idempotencyKey: `sales-followup-digest-${new Date().toISOString().slice(0, 13)}`,
  }).catch(() => {});
  return json({ processed: due.length, sent });
}
