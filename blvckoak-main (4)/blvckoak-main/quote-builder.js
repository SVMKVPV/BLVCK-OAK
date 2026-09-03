export const quoteCatalog = Object.freeze({
  website: Object.freeze({
    essential: { label: 'New website — Essential foundation', min: 500, max: 500 },
    professional: { label: 'New website — Professional foundation', min: 1500, max: 1500 },
    enterprise: { label: 'New website — Enterprise / custom build', min: 2900, max: 4500 },
    upgrade: { label: 'Existing website upgrade', min: 300, max: 1500 },
  }),
  features: Object.freeze({
    booking: { label: 'Online booking', min: 350, max: 900 },
    ecommerce: { label: 'Online store', min: 800, max: 2500 },
    payments: { label: 'Online payments', min: 250, max: 800 },
    members: { label: 'Client or member login', min: 1000, max: 3000 },
    'extra-pages': { label: 'Extra pages', min: 300, max: 1200 },
    copywriting: { label: 'Website copywriting', min: 300, max: 1000 },
    analytics: { label: 'Analytics setup', min: 150, max: 400 },
    motion: { label: 'Advanced motion', min: 500, max: 1600 },
  }),
  services: Object.freeze({
    seo: { label: 'SEO & search strategy', min: 350, max: 1200 },
    automation: { label: 'Workflow & AI automation', min: 800, max: 3500 },
    branding: { label: 'Digital branding & asset kit', min: 450, max: 1800 },
    consulting: { label: 'Consulting & coaching', min: 200, max: 600 },
  }),
  marketingSetup: Object.freeze({
    strategy: { label: 'Campaign strategy & setup', min: 450, max: 1200 },
    launch: { label: 'Brand launch campaign', min: 600, max: 1800 },
    local: { label: 'Local marketing setup', min: 350, max: 900 },
  }),
  monthly: Object.freeze({
    social: { label: 'Social media management', min: 500, max: 1200 },
    ads: { label: 'Paid ads management (ad spend excluded)', min: 450, max: 1500 },
    'seo-content': { label: 'SEO & content growth', min: 500, max: 1400 },
    email: { label: 'Email campaigns', min: 350, max: 900 },
    optimisation: { label: 'Website optimisation', min: 250, max: 600 },
    maintenance: { label: 'Website care & maintenance', min: 99, max: 350 },
  }),
});

const timelineLabels = Object.freeze({ flexible: 'Flexible timing', 'one-month': 'Within one month', urgent: 'Urgent — as soon as possible', planning: 'Still planning' });
const paymentLabels = Object.freeze({ discuss: 'Discuss the best option', standard: 'Standard deposit and balance', staged: 'Staged project payments', 'pay-as-you-sell': 'Ask about Pay as You Sell' });

function chosenItems(values, catalog, field) {
  const unique = [...new Set(Array.isArray(values) ? values : [])];
  return unique.map((id) => {
    if (!Object.hasOwn(catalog, id)) throw new Error(`Choose a valid ${field} option.`);
    return catalog[id];
  });
}

function total(items) {
  return items.reduce((sum, item) => ({ min: sum.min + item.min, max: sum.max + item.max }), { min: 0, max: 0 });
}

export function calculateEstimate(selection) {
  const websiteBuild = String(selection.websiteBuild || '');
  if (!['new', 'upgrade', 'none'].includes(websiteBuild)) throw new Error('Choose whether you need a new website, an upgrade or no website work.');
  const oneOffItems = [];
  if (websiteBuild === 'new') {
    const level = String(selection.websiteLevel || '');
    if (!Object.hasOwn(quoteCatalog.website, level) || level === 'upgrade') throw new Error('Choose a starting website package.');
    oneOffItems.push(quoteCatalog.website[level]);
  }
  if (websiteBuild === 'upgrade') oneOffItems.push(quoteCatalog.website.upgrade);
  const features = websiteBuild === 'none' ? [] : chosenItems(selection.features, quoteCatalog.features, 'website feature');
  const services = chosenItems(selection.services, quoteCatalog.services, 'specialist service');
  const marketingSetup = chosenItems(selection.marketingSetup, quoteCatalog.marketingSetup, 'marketing setup');
  const monthlyItems = chosenItems(selection.monthly, quoteCatalog.monthly, 'monthly service');
  oneOffItems.push(...features, ...services, ...marketingSetup);
  if (!oneOffItems.length && !monthlyItems.length) throw new Error('Choose at least one service or marketing option to generate an estimate.');
  if (!Object.hasOwn(timelineLabels, selection.timeline)) throw new Error('Choose a valid project timing.');
  if (!Object.hasOwn(paymentLabels, selection.payment)) throw new Error('Choose a valid payment preference.');
  return {
    oneOff: total(oneOffItems),
    monthly: total(monthlyItems),
    oneOffItems,
    monthlyItems,
    timeline: timelineLabels[selection.timeline],
    payment: paymentLabels[selection.payment],
    industry: String(selection.industry || '').trim().slice(0, 100),
    notes: String(selection.notes || '').trim().slice(0, 500),
  };
}

export function formatRange(range, suffix = '') {
  const money = (value) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
  if (!range.max) return 'None selected';
  return `${money(range.min)}${range.min === range.max ? '' : `–${money(range.max)}`}${suffix}`;
}

function formSelection(form) {
  const data = new FormData(form);
  return {
    websiteBuild: data.get('websiteBuild'),
    websiteLevel: data.get('websiteLevel'),
    features: data.getAll('features'),
    services: data.getAll('services'),
    marketingSetup: data.getAll('marketingSetup'),
    monthly: data.getAll('monthly'),
    timeline: data.get('timeline'),
    payment: data.get('payment'),
    industry: data.get('industry'),
    notes: data.get('notes'),
  };
}

function estimateReference() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `BOQ-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function buildEstimateBrief(estimate, reference) {
  const oneOffText = estimate.oneOff.max ? `${formatRange(estimate.oneOff)} AUD` : 'None selected';
  const monthlyText = estimate.monthly.max ? `${formatRange(estimate.monthly)} AUD per month` : 'None selected';
  const lines = [
    'BLACK OAK SELF-QUOTE — INDICATIVE ESTIMATE ONLY',
    `Reference: ${reference}`,
    `Estimated one-off project: ${oneOffText}`,
    `Optional ongoing services: ${monthlyText}`,
    '',
    'Selected one-off work:',
    ...(estimate.oneOffItems.length ? estimate.oneOffItems.map((item) => `- ${item.label}`) : ['- None']),
    '',
    'Selected monthly work:',
    ...(estimate.monthlyItems.length ? estimate.monthlyItems.map((item) => `- ${item.label}`) : ['- None']),
    '',
    `Industry: ${estimate.industry || 'Not supplied'}`,
    `Timing: ${estimate.timeline}`,
    `Payment preference: ${estimate.payment}`,
    ...(estimate.notes ? [`Other requirements: ${estimate.notes}`] : []),
    '',
    'This is a planning range, not a binding offer or final quote. Final scope and price require Black Oak confirmation. Third-party fees, advertising spend, hosting and paid software are excluded unless confirmed in writing. Referral eligibility and discounts are checked separately.',
  ];
  return lines.join('\n').slice(0, 2900);
}

function initialiseBuilder() {
  const form = document.querySelector('[data-self-quote-form]');
  if (!form) return;
  const websiteLevel = document.querySelector('[data-website-level]');
  const features = document.querySelector('[data-feature-fieldset]');
  const featureNote = document.querySelector('[data-feature-note]');
  const result = document.querySelector('[data-quote-result]');
  const status = document.querySelector('[data-quote-builder-status]');

  function updateWebsiteFields() {
    const build = form.elements.websiteBuild.value;
    websiteLevel.hidden = build !== 'new';
    websiteLevel.querySelectorAll('input').forEach((input) => { input.required = build === 'new'; });
    features.disabled = !['new', 'upgrade'].includes(build);
    featureNote.hidden = !features.disabled;
    if (features.disabled) features.querySelectorAll('input').forEach((input) => { input.checked = false; });
  }
  form.addEventListener('change', (event) => { if (event.target.name === 'websiteBuild') updateWebsiteFields(); });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = '';
    status.classList.remove('error');
    try {
      const estimate = calculateEstimate(formSelection(form));
      const reference = estimateReference();
      document.querySelector('[data-estimate-reference]').textContent = reference;
      document.querySelector('[data-one-off-estimate]').textContent = formatRange(estimate.oneOff);
      document.querySelector('[data-monthly-estimate]').textContent = formatRange(estimate.monthly);
      document.querySelector('[data-monthly-estimate-card]').hidden = estimate.monthly.max === 0;
      const list = document.querySelector('[data-estimate-lines]');
      list.replaceChildren();
      [...estimate.oneOffItems, ...estimate.monthlyItems.map((item) => ({ ...item, label: `${item.label} — monthly` }))].forEach((item) => {
        const li = document.createElement('li'); li.textContent = item.label; list.append(li);
      });
      const brief = buildEstimateBrief(estimate, reference);
      const contactUrl = new URL('/contact.html', window.location.origin);
      contactUrl.searchParams.set('service', 'general');
      contactUrl.searchParams.set('brief', brief);
      contactUrl.hash = 'contact-title';
      document.querySelector('[data-send-estimate]').href = contactUrl.toString();
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    }
  });

  document.querySelector('[data-print-estimate]').addEventListener('click', () => window.print());
  document.querySelector('[data-edit-estimate]').addEventListener('click', () => form.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  updateWebsiteFields();
}

if (typeof document !== 'undefined') initialiseBuilder();
