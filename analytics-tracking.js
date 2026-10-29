(() => {
  'use strict';
  // First-party measurement only. No cookies, persistent browser identifier,
  // form values, full referring URLs or private workspace paths are collected.
  if (window.blvckOakAnalytics || location.protocol !== 'https:') return;
  let path = location.pathname;
  try {
    for (let attempt = 0; attempt < 3 && (attempt === 0 || /%[\da-f]{2}/i.test(path)); attempt += 1) {
      path = decodeURIComponent(path).split(/[?#]/, 1)[0];
    }
    if (/%[\da-f]{2}/i.test(path) || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x1f\x7f\\]/.test(path)) return;
    path = new URL(encodeURI(path), location.origin).pathname;
    if (path.length > 160) return;
  } catch { return; }
  const privatePath = /^\/(?:partners|login|analytics|operations|pay|progress|oakpay-app)(?:\.html)?(?:\/|$)/i;
  const excluded = privatePath.test(path) || /^\/(?:api|\.netlify)(?:\/|$)/i.test(path)
    || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  if (excluded) return;

  const allowed = new Set(['page_view', 'quote_click', 'contact_click', 'booking_click', 'audit_click', 'form_start', 'form_success']);
  const forms = '[data-contact-form],[data-booking-form],[data-audit-form]';
  const startedForms = new WeakSet();
  const campaign = {};
  const params = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ref']) {
    const raw = params.get(key) || '';
    // Campaign fields are labels, never a place for email addresses or URLs.
    if (raw && !/@|https?:|[?=]/i.test(raw)) campaign[key] = raw.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 80);
  }
  let referrer = '';
  try {
    const parsed = new URL(document.referrer);
    if (/^https?:$/.test(parsed.protocol)) referrer = parsed.origin;
  } catch { /* A missing referrer is valid direct traffic. */ }

  let sent = 0;
  const track = (event) => {
    if (!allowed.has(event) || sent >= 60 || document.prerendering) return;
    sent += 1;
    fetch('/.netlify/functions/analytics-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, path, referrer, ...campaign }),
      credentials: 'same-origin', keepalive: true,
    }).catch(() => {});
  };
  window.blvckOakAnalytics = Object.freeze({ track });
  track('page_view');

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('aria-disabled') || event.defaultPrevented) return;
    let target;
    try { target = new URL(link.href, location.origin); } catch { return; }
    if (target.origin !== location.origin) return;
    const action = target.pathname.match(/^\/(quote|contact|book|audit)(?:\.html)?\/?$/i)?.[1]?.toLowerCase();
    const events = { quote: 'quote_click', contact: 'contact_click', book: 'booking_click', audit: 'audit_click' };
    if (action) track(events[action]);
  });
  document.addEventListener('focusin', (event) => {
    const form = event.target.closest?.(forms);
    if (!form || startedForms.has(form)) return;
    startedForms.add(form);
    track('form_start');
  });
})();
