'use strict';

const salesRequestId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function submitSalesForm(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('This sales tool is not connected on the deployed site.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

const bookingForm = document.querySelector('[data-booking-form]');
if (bookingForm) {
  const date = bookingForm.elements.preferredDate;
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const maximum = new Date(today.getTime() + 180 * 86400000).toISOString().slice(0, 10);
  date.min = local; date.max = maximum;
  bookingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = bookingForm.querySelector('[type="submit"]'); const status = document.querySelector('[data-booking-status]');
    button.disabled = true; status.classList.remove('error'); status.textContent = 'Requesting your consultation…';
    try {
      const data = Object.fromEntries(new FormData(bookingForm));
      const result = await submitSalesForm('/api/book', { ...data, acceptedPrivacy: data.privacy === 'on', requestId: salesRequestId() });
      bookingForm.reset(); date.min = local; date.max = maximum; status.textContent = result.message;
    } catch (error) { status.classList.add('error'); status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

const auditForm = document.querySelector('[data-audit-form]');
if (auditForm) auditForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = auditForm.querySelector('[type="submit"]'); const status = document.querySelector('[data-audit-status]'); const resultPanel = document.querySelector('[data-audit-result]');
  button.disabled = true; status.classList.remove('error'); status.textContent = 'Inspecting the public website…'; resultPanel.hidden = true;
  try {
    const data = Object.fromEntries(new FormData(auditForm));
    const result = await submitSalesForm('/api/website-audit', { ...data, acceptedPrivacy: data.privacy === 'on', requestId: salesRequestId() });
    document.querySelector('[data-audit-score]').textContent = result.score;
    document.querySelector('[data-audit-heading]').textContent = result.score >= 80 ? 'Strong foundation. Here are the refinements.' : result.score >= 55 ? 'Good start. These fixes can lift it.' : 'These are the highest-impact fixes.';
    const checks = document.querySelector('[data-audit-checks]'); checks.replaceChildren(...result.checks.map((check) => {
      const item = document.createElement('article'); item.className = check.pass ? 'audit-check pass' : 'audit-check fail';
      const mark = document.createElement('span'); mark.textContent = check.pass ? '✓' : '↗';
      const body = document.createElement('div'); const title = document.createElement('strong'); title.textContent = check.label;
      const copy = document.createElement('p'); copy.textContent = check.pass ? `${check.points} points secured` : check.fix;
      body.append(title, copy); item.append(mark, body); return item;
    }));
    resultPanel.hidden = false; resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); status.textContent = 'Audit complete.';
  } catch (error) { status.classList.add('error'); status.textContent = error.message; }
  finally { button.disabled = false; }
});

async function loadClientProof() {
  const section = document.querySelector('[data-client-proof]'); if (!section) return;
  try {
    const response = await fetch('/api/portfolio', { headers: { Accept: 'application/json' }, cache: 'no-store' }); const data = await response.json();
    const projects = Array.isArray(data.projects) ? data.projects.filter((project) => project.outcome || project.testimonial).slice(0, 3) : [];
    if (!response.ok || !projects.length) return;
    const grid = section.querySelector('[data-client-proof-grid]'); grid.replaceChildren(...projects.map((project) => {
      const card = document.createElement('article'); card.className = 'proof-card';
      const label = document.createElement('p'); label.className = 'section-label'; label.textContent = project.category;
      const title = document.createElement('h3'); title.textContent = project.title; card.append(label, title);
      if (project.outcome) { const result = document.createElement('p'); result.className = 'proof-outcome'; result.textContent = project.outcome; card.append(result); }
      if (project.testimonial) { const quote = document.createElement('blockquote'); quote.append(document.createTextNode(`“${project.testimonial}”`)); const cite = document.createElement('cite'); cite.textContent = project.clientDisplayName || 'Verified client'; quote.append(cite); card.append(quote); }
      return card;
    })); section.hidden = false;
  } catch { /* Real proof remains hidden until published. */ }
}
loadClientProof();

if (!document.body.classList.contains('workspace-body')) {
  const dock = document.createElement('nav'); dock.className = 'sales-dock'; dock.setAttribute('aria-label', 'Quick sales actions');
  dock.innerHTML = '<a href="audit.html"><span>Free</span>Website audit</a><a href="book.html"><span>15 min</span>Book a call</a>';
  const whatsapp = String(window.BLACK_OAK_SALES?.whatsappNumber || '').replace(/\D/g, '');
  if (/^61\d{9}$/.test(whatsapp)) {
    const message = encodeURIComponent('Hi Black Oak, I would like to discuss a website.');
    const link = document.createElement('a'); link.href = `https://wa.me/${whatsapp}?text=${message}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.innerHTML = '<span>Quick reply</span>WhatsApp';
    dock.append(link);
  }
  document.body.append(dock);
}
