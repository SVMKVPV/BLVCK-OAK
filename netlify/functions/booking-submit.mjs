import { publicFeatureAccess } from '../lib/feature-access.mjs';
import { emailShell, escapeHtml, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { PortalError, readBody } from '../lib/portal-auth.mjs';
import { enforcePublicQuota } from '../lib/public-rate-limit.mjs';
import { json } from '../lib/referrals.mjs';
import { createSalesLead } from '../lib/sales-leads.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sydneyClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function sydneyStamp(epoch) {
  const parts = Object.fromEntries(sydneyClock.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function validSydneyBookingTime(preferredDate, preferredTime, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !/^\d{2}:\d{2}$/.test(preferredTime)) return false;
  const [year, month, day] = preferredDate.split('-').map(Number);
  const [hour, minute] = preferredTime.split(':').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return false;
  if (hour < 8 || hour > 20 || minute < 0 || minute > 59) return false;
  const requested = `${preferredDate}T${preferredTime}`;
  return requested >= sydneyStamp(now) && requested <= sydneyStamp(now + 180 * 86_400_000);
}

export default async function handler(request, context) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const denied = publicFeatureAccess(request);
  if (denied) return denied;
  const limited = await enforcePublicQuota('booking', context);
  if (limited) return limited;
  try {
    const body = await readBody(request, 8192);
    if (body.website) return json({ error: 'Booking could not be sent.' }, 400);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
    const company = String(body.company || '').trim().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const preferredDate = String(body.preferredDate || '');
    const preferredTime = String(body.preferredTime || '');
    const message = String(body.message || '').trim().slice(0, 2000);
    if (name.length < 2 || !emailPattern.test(email)) return json({ error: 'Enter your name and a valid email address.' }, 400);
    if (!validSydneyBookingTime(preferredDate, preferredTime)) return json({ error: 'Choose a Sydney time between 8:00 am and 8:00 pm within the next six months.' }, 400);
    if (body.acceptedPrivacy !== true) return json({ error: 'Accept the privacy notice to continue.' }, 400);
    const lead = await createSalesLead({ type: 'booking', requestId: body.requestId, name, email, company, phone, service: 'Free consultation', message, preferredDate, preferredTime });
    const ownerEmail = getOwnerEmail();
    if (!ownerEmail) throw new Error('OWNER_EMAIL is not configured.');
    await sendEmail({
      to: ownerEmail,
      subject: `Consultation request — ${name}`,
      text: `${name}\n${email}\n${phone || 'No phone supplied'}\n${company || 'No company supplied'}\nPreferred: ${preferredDate} at ${preferredTime} Australia/Sydney\n\n${message}`,
      html: emailShell('New consultation request', `<p style="color:#b6b5ae;line-height:1.8"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(email)}<br>${escapeHtml(phone || 'No phone supplied')}<br>${escapeHtml(company || 'No company supplied')}</p><p style="color:#f1d48c">Preferred time: ${escapeHtml(preferredDate)} at ${escapeHtml(preferredTime)} Australia/Sydney</p><p style="color:#b6b5ae;white-space:pre-wrap">${escapeHtml(message || 'No additional note')}</p>`),
      idempotencyKey: `booking-owner-${lead.id}`,
    });
    await sendEmail({
      to: email,
      subject: 'Your Black Oak consultation request',
      text: `Hi ${name}, we received your request for ${preferredDate} at ${preferredTime} Australia/Sydney. We will confirm the time by email.`,
      html: emailShell('Consultation requested', `<p style="color:#b6b5ae;line-height:1.8">Hi ${escapeHtml(name)}, we received your request for <strong>${escapeHtml(preferredDate)} at ${escapeHtml(preferredTime)}</strong> Australia/Sydney. We will confirm the time by email.</p>`),
      idempotencyKey: `booking-customer-${lead.id}`,
    }).catch((error) => console.error('Booking acknowledgement failed:', error.name));
    return json({ message: 'Your consultation request is in. Check your email for confirmation.' }, 201);
  } catch (error) {
    console.error('Booking request failed:', error.name);
    if (error instanceof PortalError) return json({ error: error.message }, error.status);
    return json({ error: 'Booking is temporarily unavailable. Please use the contact form.' }, 503);
  }
}
