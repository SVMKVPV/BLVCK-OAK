import { aud, calculate, toolById } from './business-tools-model.js';
export const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const style = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f2f0e9;color:#171917;font:16px/1.7 system-ui,sans-serif}main{max-width:920px;margin:40px auto;padding:48px;background:white;border-top:6px solid #bc9a51}.brand{font-size:12px;font-weight:800;letter-spacing:.2em}h1{font-family:Georgia,serif;font-size:clamp(36px,7vw,64px);line-height:1.1;font-weight:400}h2{font-size:20px;margin:30px 0 8px}.muted{color:#62665e}.tag{display:inline-block;background:#ede8d8;padding:5px 12px;border-radius:30px;font-size:12px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}a{color:#57451a}.cta{display:inline-block;margin:18px 0;padding:14px 24px;background:#171917;color:white;text-decoration:none;border-radius:6px}.links{display:grid;gap:10px}.links a{padding:14px 20px;border:1px solid #d9d8d0;border-radius:8px;text-decoration:none}.foot{font-size:12px;margin-top:40px;border-top:1px solid #ddd;padding-top:20px}@media(max-width:600px){main{margin:0;padding:26px}table{font-size:12px}td,th{padding:6px}}@media print{body{background:#fff}main{margin:0;padding:20px;border:0}.no-print{display:none}}`;
const shell = (title, body) => `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${style}</style></head><body><main>${body}</main></body></html>`;
function safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
export function recordDocument(record) {
  const tool = toolById.get(record.service);
  let content = `<p class="brand">BLVCK OAK / ${escape(tool.title)}</p><span class="tag">${record.service === 'invoices' ? 'DRAFT INVOICE · FOR REVIEW' : escape(record.status)}</span><h1>${escape(record.title)}</h1><p class="muted">${record.dueDate ? 'Due ' + escape(record.dueDate) + ' · ' : ''}Prepared ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney' }).format(new Date())}</p>`;
  for (const f of tool.fields) {
    if (!record.data[f.key] || f.key === 'items' && record.service === 'invoices') continue;
    content += `<h2>${escape(f.label)}</h2><pre>${escape(record.data[f.key])}</pre>`;
  }
  if (record.service === 'invoices') {
    const result = calculate(record.service, record.data);
    content += `<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Tax</th><th>Total</th></tr></thead><tbody>${result.lines.map(l => `<tr><td>${escape(l.description)}</td><td>${l.qty}</td><td>${aud(l.price)}</td><td>${l.taxRate}%</td><td>${aud(l.total)}</td></tr>`).join('')}</tbody></table><pre>${escape(result.summary)}</pre>`;
  } else if (tool.actions.includes('calculate')) { try { content += `<h2>Calculation</h2><pre>${escape(calculate(record.service, record.data).summary)}</pre>`; } catch { content += '<p>Calculation incomplete: review the input fields.</p>'; } }
  if (tool.actions.includes('stock')) content += `<h2>${record.service === 'loyalty' ? 'Points' : 'Stock'} balance</h2><p>${Number(record.data.stock || 0)}</p>`;
  return shell(record.title, content + '<p class="foot">Private working document. Review details before sharing. This record does not confirm payment, delivery or publication.</p>');
}
export function pageDocument(record) {
  const d = record.data;
  const sections = String(d.sections || '').split('\n').filter(Boolean).map(line => { const [heading, ...body] = line.split('|'); return `<section><h2>${escape(heading)}</h2><p>${escape(body.join('|'))}</p></section>`; }).join('');
  const links = String(d.links || '').split('\n').filter(Boolean).map(line => { const [label, ...parts] = line.split('|'); const link = safeUrl(parts.join('|').trim()); if (!link) throw new Error('Each link needs a label | complete http(s) URL.'); return `<a href="${escape(link)}" rel="noopener noreferrer">${escape(label)} ↗</a>`; }).join('');
  const cta = safeUrl(d.ctaUrl);
  return shell(d.headline || record.title, `<p class="brand">BLVCK OAK</p><h1>${escape(d.headline || record.title)}</h1><p class="muted">${escape(d.intro || '')}</p>${sections}<div class="links">${links}</div>${cta ? `<a class="cta" href="${escape(cta)}" rel="noopener noreferrer">${escape(d.cta || 'Find out more')} ↗</a>` : ''}<p class="foot">BLVCK OAK</p>`);
}
export function calendarFile(record) {
  const d = record.data;
  if (!d.start || !d.end || d.end <= d.start) throw new Error('Enter a valid start and end time first.');
  const clean = s => String(s || '').replaceAll('\\', '\\\\').replace(/\r?\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const stamp = date => date.replaceAll('-', '').replaceAll(':', '') + '00';
  // A VTIMEZONE makes Sydney daylight-saving behaviour explicit to calendar clients.
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BLVCK OAK//Business tools//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VTIMEZONE', 'TZID:Australia/Sydney', 'BEGIN:DAYLIGHT', 'DTSTART:20081005T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1100', 'TZNAME:AEDT', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:20080406T030000', 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU', 'TZOFFSETFROM:+1100', 'TZOFFSETTO:+1000', 'TZNAME:AEST', 'END:STANDARD', 'END:VTIMEZONE', 'BEGIN:VEVENT', `UID:${record.id || 'draft-' + Date.now()}@blvckoak.com.au`, 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), 'DTSTART;TZID=Australia/Sydney:' + stamp(d.start), 'DTEND;TZID=Australia/Sydney:' + stamp(d.end), 'SUMMARY:' + clean(record.title), 'DESCRIPTION:' + clean(d.brief), 'LOCATION:' + clean(d.meeting), 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(line => { let out = '', n = 0; for (const c of line) { const size = new TextEncoder().encode(c).length; if (n + size > 72) { out += '\r\n '; n = 1; } out += c; n += size; } return out; }).join('\r\n') + '\r\n';
}
