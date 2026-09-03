const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatAud(cents) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(cents) || 0) / 100);
}

export function getOwnerEmail() {
  return String(process.env.OWNER_EMAIL || '').trim();
}

export function getSupportEmail() {
  return String(process.env.SUPPORT_EMAIL || process.env.OWNER_EMAIL || '').trim();
}

export function emailShell(title, content) {
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#080909;color:#f0ede5;font-family:Arial,sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:40px 22px">
    <p style="margin:0 0 28px;color:#d4ae58;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">Black Oak Digital</p>
    <div style="padding:30px;border:1px solid #32332f;background:#111212">
      <h1 style="margin:0 0 18px;color:#f1d48c;font-family:Georgia,serif;font-size:30px;font-weight:500">${escapeHtml(title)}</h1>
      ${content}
    </div>
    <p style="margin:22px 0 0;color:#777871;font-size:12px;line-height:1.6">Card and bank details are handled only by Stripe. Black Oak will never ask you to email banking information or a password.</p>
  </div>
</body></html>`;
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and EMAIL_FROM must be configured.');

  const recipients = (Array.isArray(to) ? to : [to]).map((value) => String(value || '').trim()).filter(Boolean);
  if (!recipients.length) throw new Error('An email recipient is required.');

  const headers = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': 'black-oak-netlify/1.0',
  };
  if (idempotencyKey) headers['idempotency-key'] = String(idempotencyKey).slice(0, 256);

  const payload = { from, to: recipients, subject, html, text };
  const replyTo = getSupportEmail();
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email delivery failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  return response.json();
}

export function referralLinks(siteUrl, code) {
  return ['essential', 'professional', 'enterprise'].map((packageId) => {
    const url = new URL('/', siteUrl);
    url.searchParams.set('ref', code);
    url.searchParams.set('package', packageId);
    url.hash = 'packages';
    return { name: packageId[0].toUpperCase() + packageId.slice(1), url: url.toString() };
  });
}
