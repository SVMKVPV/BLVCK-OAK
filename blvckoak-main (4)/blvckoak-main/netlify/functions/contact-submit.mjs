import { emailShell, escapeHtml, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { json } from '../lib/referrals.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestIdPattern = /^[A-Za-z0-9-]{16,80}$/;
const serviceLabels = Object.freeze({
  'seo-search': 'SEO & Search Strategy',
  'digital-marketing': 'Digital Marketing',
  'workflow-ai': 'Workflow & AI Automation',
  'digital-branding': 'Digital Branding & Asset Kits',
  'consulting-coaching': 'High-Ticket Consulting / Coaching',
  'website-upgrades': 'Website Upgrades',
  'website-packages': 'Website packages',
  general: 'Not sure yet / Multiple services',
});

export const config = {
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['domain', 'ip'],
    windowSize: 60,
    windowLimit: 3,
  },
};

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 8192) return json({ error: 'Message is too large.' }, 413);

    const body = await request.json();
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
    const company = String(body.company || '').trim().slice(0, 120);
    const message = String(body.message || '').trim().slice(0, 3000);
    const requestId = String(body.requestId || '').trim();
    // Older cached forms have no service field; keep their enquiries working.
    const serviceId = body.service == null || body.service === '' ? 'general' : body.service;

    if (body.website) return json({ error: 'Message could not be sent.' }, 400);
    if (typeof serviceId !== 'string' || !Object.hasOwn(serviceLabels, serviceId)) {
      return json({ error: 'Choose a service from the list.' }, 400);
    }
    const service = serviceLabels[serviceId];
    if (name.length < 2) return json({ error: 'Enter your name.' }, 400);
    if (!emailPattern.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (message.length < 20) return json({ error: 'Tell us a little more about your project.' }, 400);
    if (!requestIdPattern.test(requestId)) return json({ error: 'Refresh the page and try again.' }, 400);
    if (body.acceptedPrivacy !== true) return json({ error: 'Accept the privacy notice to continue.' }, 400);

    const ownerEmail = getOwnerEmail();
    if (!ownerEmail) throw new Error('OWNER_EMAIL is not configured.');

    await sendEmail({
      to: ownerEmail,
      subject: `Black Oak enquiry: ${service} — ${name}`,
      text: `Service: ${service}\nName: ${name}\nEmail: ${email}\nCompany: ${company || 'Not supplied'}\n\n${message}`,
      html: emailShell('New project enquiry', `
        <p style="color:#b6b5ae;line-height:1.7"><strong>Service:</strong> ${escapeHtml(service)}<br><strong>Name:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Company:</strong> ${escapeHtml(company || 'Not supplied')}</p>
        <div style="margin-top:22px;padding:18px;border-left:3px solid #d4ae58;background:#171817;color:#d5d3cc;line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</div>`),
      idempotencyKey: `contact-owner-${requestId}`,
    });

    await sendEmail({
      to: email,
      subject: 'Black Oak received your enquiry',
      text: `Hi ${name}, your enquiry about ${service} reached Black Oak. We aim to respond within two business days.`,
      html: emailShell('Your message is with us', `<p style="color:#b6b5ae;line-height:1.7">Hi ${escapeHtml(name)}, your enquiry about ${escapeHtml(service)} reached Black Oak. We aim to respond within two business days.</p>`),
      idempotencyKey: `contact-customer-${requestId}`,
    }).catch((error) => console.error('Contact acknowledgement failed:', error.message));

    return json({ message: 'Your enquiry has been sent. We will reply within two business days.' }, 201);
  } catch (error) {
    console.error('Contact form failed:', error.message);
    return json({ error: 'The secure contact form is temporarily unavailable. Please try again later.' }, 503);
  }
}
