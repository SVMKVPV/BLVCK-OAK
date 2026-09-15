import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { emailShell, escapeHtml, getOwnerEmail, sendEmail } from '../lib/email.mjs';
import { json } from '../lib/referrals.mjs';
import { createSalesLead } from '../lib/sales-leads.mjs';
import { isPrivateAddress, scoreWebsiteAudit } from '../lib/website-audit.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 3600, windowLimit: 5 } };

async function safeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a complete website address, including https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Enter a public http or https website address without sign-in details.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Enter a public website address.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('That address cannot be audited.');
  url.hash = '';
  return { url, address: addresses[0].address, family: addresses[0].family };
}

function requestPage(target) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.get(target.url, {
      headers: { 'user-agent': 'BlackOakWebsiteAudit/1.0', accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity' },
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      timeout: 10000,
    }, (response) => {
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) response.destroy(new Error('The website page is too large to audit.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, html: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('The website took too long to respond.')));
    request.on('error', reject);
  });
}

async function fetchPublicPage(initial) {
  let target = await safeUrl(initial);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await requestPage(target);
    const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      target = await safeUrl(new URL(location, target.url).href);
      continue;
    }
    const type = String(response.headers['content-type'] || '');
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('That address did not return a website page.');
    return { html: response.html, finalUrl: target.url.href, status: response.status };
  }
  throw new Error('The website redirected too many times.');
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const body = await request.json();
    if (body.companyWebsite) return json({ error: 'Audit could not be completed.' }, 400);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
    if (name.length < 2 || !emailPattern.test(email)) return json({ error: 'Enter your name and a valid email address.' }, 400);
    if (body.acceptedPrivacy !== true) return json({ error: 'Accept the privacy notice to continue.' }, 400);
    const page = await fetchPublicPage(body.websiteUrl);
    const report = scoreWebsiteAudit(page.html, page.finalUrl, page.status);
    const lead = await createSalesLead({ type: 'audit', requestId: body.requestId, name, email, company: body.company, websiteUrl: page.finalUrl, service: 'Free website audit', message: 'Requested an automated website audit.', auditScore: report.score, auditSummary: report.fixes });
    const ownerEmail = getOwnerEmail();
    if (ownerEmail) await sendEmail({
      to: ownerEmail,
      subject: `Website audit lead: ${name} — ${report.score}/100`,
      text: `${name}\n${email}\n${page.finalUrl}\nScore: ${report.score}/100\n\n${report.fixes.join('\n')}`,
      html: emailShell('New website audit lead', `<p style="color:#b6b5ae;line-height:1.8"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(email)}<br>${escapeHtml(page.finalUrl)}</p><p style="font-size:30px;color:#f1d48c">${report.score}/100</p><ul style="color:#b6b5ae">${report.fixes.map((fix) => `<li>${escapeHtml(fix)}</li>`).join('')}</ul>`),
      idempotencyKey: `audit-owner-${lead.id}`,
    }).catch((error) => console.error('Audit alert failed:', error.name));
    return json({ score: report.score, finalUrl: page.finalUrl, checks: report.checks, fixes: report.fixes }, 201);
  } catch (error) {
    console.error('Website audit failed:', error.name);
    const message = /Enter|address|website|redirect/i.test(error.message) ? error.message : 'The audit could not reach that website. Check the address and try again.';
    return json({ error: message }, 400);
  }
}
