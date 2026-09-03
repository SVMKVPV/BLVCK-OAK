'use strict';

const packageCatalog = Object.freeze({
  essential: {
    id: 'essential',
    name: 'Essential',
    price: '$500 AUD',
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: '$1,500 AUD',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$2,900 AUD',
    referralPrice: '$1,160 AUD',
  },
});

const REFERRAL_STORAGE_KEY = 'blackOakReferralCode';
const referralCodePattern = /^BO-[A-F0-9]{10}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseReferralCode(value = '') {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 13);
}

function buildReferralLandingLink(packageId, referralCode) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('ref', normaliseReferralCode(referralCode));
  url.searchParams.set('package', packageId);
  url.hash = 'packages';
  return url.toString();
}

const pageParameters = new URLSearchParams(window.location.search);
const incomingReferralCode = normaliseReferralCode(pageParameters.get('ref') || '');
if (referralCodePattern.test(incomingReferralCode)) {
  sessionStorage.setItem(REFERRAL_STORAGE_KEY, incomingReferralCode);
}

function getActiveReferralCode() {
  const input = document.querySelector('[data-checkout-referral]');
  return normaliseReferralCode(
    input ? input.value : (sessionStorage.getItem(REFERRAL_STORAGE_KEY) || ''),
  );
}

const modalBackdrop = document.querySelector('[data-modal-backdrop]');
const checkoutModal = document.querySelector('.checkout-modal');
const closeModalButton = document.querySelector('[data-close-modal]');
const checkoutButton = document.querySelector('[data-checkout-action]');
const modalTitle = document.querySelector('[data-modal-title]');
const modalName = document.querySelector('[data-modal-name]');
const modalPrice = document.querySelector('[data-modal-price]');
const summaryName = document.querySelector('[data-summary-name]');
const summaryPrice = document.querySelector('[data-summary-price]');
const summaryListPriceRow = document.querySelector('[data-summary-list-price-row]');
const summaryDiscountRow = document.querySelector('[data-summary-discount-row]');
const checkoutReferralInput = document.querySelector('[data-checkout-referral]');
const checkoutReferralMessage = document.querySelector('[data-checkout-referral-message]');
const checkoutEmailField = document.querySelector('[data-checkout-email-field]');
const checkoutEmailInput = document.querySelector('[data-checkout-email]');

let selectedPackage = null;
let previouslyFocusedElement = null;

function updateCheckoutOfferPresentation() {
  if (!selectedPackage) return;

  const code = getActiveReferralCode();
  const hasReferral = referralCodePattern.test(code);
  const enterpriseReferral = selectedPackage.id === 'enterprise' && hasReferral;

  if (checkoutEmailField) checkoutEmailField.hidden = !hasReferral;

  summaryListPriceRow.hidden = !enterpriseReferral;
  summaryDiscountRow.hidden = !enterpriseReferral;
  summaryPrice.textContent = enterpriseReferral ? selectedPackage.referralPrice : selectedPackage.price;
  modalPrice.textContent = enterpriseReferral
    ? `${selectedPackage.referralPrice} after referral verification`
    : selectedPackage.price;

  if (enterpriseReferral) {
    checkoutReferralMessage.textContent = `${code} will be verified. If eligible, the limited 60% Enterprise offer applies.`;
  } else if (hasReferral) {
    checkoutReferralMessage.textContent = `Referral ${code} will be tracked at Stripe checkout.`;
  } else {
    checkoutReferralMessage.textContent = selectedPackage.id === 'enterprise'
      ? 'Add a valid partner code to unlock the limited 60% Enterprise offer.'
      : 'Add a partner code if someone referred you.';
  }
}

function openCheckout(packageId) {
  const selected = packageCatalog[packageId];
  if (!selected || !modalBackdrop) return;

  selectedPackage = selected;
  previouslyFocusedElement = document.activeElement;
  modalTitle.textContent = selected.name;
  modalName.textContent = selected.name;
  modalPrice.textContent = selected.price;
  summaryName.textContent = selected.name;
  summaryPrice.textContent = selected.price;
  const storedReferralCode = normaliseReferralCode(sessionStorage.getItem(REFERRAL_STORAGE_KEY) || '');
  if (checkoutReferralInput && referralCodePattern.test(storedReferralCode)) {
    checkoutReferralInput.value = storedReferralCode;
  }
  updateCheckoutOfferPresentation();
  checkoutButton.disabled = false;
  checkoutButton.firstChild.textContent = 'Continue to secure checkout ';
  checkoutButton.querySelector('span').textContent = '↗';
  modalBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  closeModalButton.focus();
}

function closeCheckout() {
  if (!modalBackdrop || modalBackdrop.hidden) return;

  modalBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  selectedPackage = null;

  if (previouslyFocusedElement instanceof HTMLElement) {
    previouslyFocusedElement.focus();
  }
}

document.querySelectorAll('[data-package]').forEach((button) => {
  button.addEventListener('click', () => {
    openCheckout(button.dataset.package);
    const directCode = document.querySelector('[data-enterprise-referral]')?.value;
    if (button.dataset.package === 'enterprise' && directCode) {
      checkoutReferralInput.value = normaliseReferralCode(directCode);
      updateCheckoutOfferPresentation();
    }
  });
});

const enterpriseReferralInput = document.querySelector('[data-enterprise-referral]');
enterpriseReferralInput?.addEventListener('input', () => {
  enterpriseReferralInput.value = normaliseReferralCode(enterpriseReferralInput.value);
});
document.querySelector('[data-enterprise-apply]')?.addEventListener('click', () => {
  const code = normaliseReferralCode(enterpriseReferralInput?.value || '');
  openCheckout('enterprise');
  checkoutReferralInput.value = code;
  updateCheckoutOfferPresentation();
  (referralCodePattern.test(code) ? checkoutEmailInput : checkoutReferralInput)?.focus();
});

closeModalButton?.addEventListener('click', closeCheckout);

modalBackdrop?.addEventListener('mousedown', (event) => {
  if (event.target === modalBackdrop) closeCheckout();
});

checkoutButton?.addEventListener('click', async () => {
  if (!selectedPackage) return;

  const referralCode = getActiveReferralCode();
  if (referralCode && !referralCodePattern.test(referralCode)) {
    checkoutReferralMessage.textContent = 'Use a complete code in the format BO-AB12CD34EF.';
    checkoutReferralInput?.focus();
    return;
  }

  const customerEmail = String(checkoutEmailInput?.value || '').trim().toLowerCase();
  if (referralCode && !emailPattern.test(customerEmail)) {
    checkoutReferralMessage.textContent = 'Enter the customer email that will be used at Stripe checkout.';
    checkoutEmailInput?.focus();
    return;
  }

  if (referralCode) sessionStorage.setItem(REFERRAL_STORAGE_KEY, referralCode);

  checkoutButton.disabled = true;
  checkoutButton.firstChild.textContent = 'Opening checkout… ';
  checkoutButton.querySelector('span').textContent = '•';

  try {
    const requestId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await fetch('/api/checkout/package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: selectedPackage.id, referralCode, customerEmail, requestId }),
    });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || 'Secure checkout is temporarily unavailable.');
    window.location.assign(result.url);
  } catch (error) {
    checkoutReferralMessage.textContent = error.message;
    checkoutButton.disabled = false;
    checkoutButton.firstChild.textContent = 'Continue to secure checkout ';
    checkoutButton.querySelector('span').textContent = '↗';
  }
});

checkoutReferralInput?.addEventListener('input', () => {
  checkoutReferralInput.value = normaliseReferralCode(checkoutReferralInput.value);
  if (!checkoutReferralInput.value) sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
  updateCheckoutOfferPresentation();
});

document.addEventListener('keydown', (event) => {
  if (!modalBackdrop || modalBackdrop.hidden) return;

  if (event.key === 'Escape') {
    closeCheckout();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = [...checkoutModal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.getClientRects().length);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

const paymentStatus = new URLSearchParams(window.location.search).get('payment');
const paymentNotice = document.querySelector('[data-payment-notice]');

if (paymentNotice && (paymentStatus === 'success' || paymentStatus === 'cancelled')) {
  const success = paymentStatus === 'success';
  paymentNotice.classList.add(paymentStatus);
  paymentNotice.querySelector('[data-payment-icon]').textContent = success ? '✓' : '↩';
  paymentNotice.querySelector('[data-payment-title]').textContent = success ? 'Payment received.' : 'Checkout cancelled.';
  paymentNotice.querySelector('[data-payment-message]').textContent = success
    ? ' Your build is reserved—we’ll be in touch with next steps.'
    : ' Nothing was charged. Your package is still here when you are ready.';
  paymentNotice.hidden = false;
}

document.querySelector('[data-dismiss-notice]')?.addEventListener('click', () => {
  if (paymentNotice) paymentNotice.hidden = true;
});

if (window.matchMedia('(pointer: fine)').matches) {
  document.querySelectorAll('[data-package-preview]').forEach((packagePreview) => {
    const demoBrowser = packagePreview.querySelector('.demo-browser');

    packagePreview.addEventListener('pointermove', (event) => {
      const rect = packagePreview.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      packagePreview.style.setProperty('--demo-glow-x', `${x * 100}%`);
      packagePreview.style.setProperty('--demo-glow-y', `${y * 100}%`);

      if (demoBrowser) {
        demoBrowser.style.setProperty('--demo-rx', `${(0.5 - y) * 4}deg`);
        demoBrowser.style.setProperty('--demo-ry', `${(x - 0.5) * 6}deg`);
      }
    });

    packagePreview.addEventListener('pointerleave', () => {
      demoBrowser?.style.setProperty('--demo-rx', '0deg');
      demoBrowser?.style.setProperty('--demo-ry', '0deg');
    });
  });
}

const referralForm = document.querySelector('[data-referral-form]');
const referralFields = document.querySelector('[data-referral-fields]');
const referralResult = document.querySelector('[data-referral-result]');
const referralStatus = document.querySelector('[data-referral-status]');

function renderReferralLinks(code) {
  const linkList = document.querySelector('[data-referral-links]');
  if (!linkList) return;

  linkList.replaceChildren();
  Object.values(packageCatalog).forEach((packageItem) => {
    const trackedLink = buildReferralLandingLink(packageItem.id, code);
    const row = document.createElement('div');
    row.className = 'referral-share-row';

    const label = document.createElement('span');
    label.textContent = `${packageItem.name}: ${trackedLink}`;

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy link';
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(trackedLink);
      copyButton.textContent = 'Copied';
      window.setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1800);
    });

    row.append(label, copyButton);
    linkList.append(row);
  });
}

referralForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = referralForm.querySelector('[type="submit"]');
  const formData = new FormData(referralForm);

  referralStatus.classList.remove('error');
  referralStatus.textContent = 'Sending your private verification link…';
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/referrals/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        website: formData.get('website'),
        acceptedTerms: formData.get('terms') === 'on',
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Registration could not be completed.');

    document.querySelector('[data-referral-result-title]').textContent = 'Verification email sent';
    document.querySelector('[data-referral-code]').textContent = 'Check your inbox';
    document.querySelector('[data-referral-result-message]').textContent = result.message
      || 'Use the private link in your email to continue securely to Stripe.';
    referralFields.hidden = true;
    referralResult.hidden = false;
  } catch (error) {
    referralStatus.classList.add('error');
    referralStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

if (pageParameters.get('referral') === 'connected') {
  const completedCode = normaliseReferralCode(pageParameters.get('code') || '');
  paymentNotice?.classList.add('success');
  paymentNotice?.querySelector('[data-payment-icon]')?.replaceChildren('✓');
  paymentNotice?.querySelector('[data-payment-title]')?.replaceChildren('Stripe onboarding submitted.');
  paymentNotice?.querySelector('[data-payment-message]')?.replaceChildren(` Your referral profile ${completedCode || ''} is being verified.`);
  if (paymentNotice) paymentNotice.hidden = false;
}

if (pageParameters.get('referral') === 'active') {
  const activeCode = normaliseReferralCode(pageParameters.get('code') || '');
  paymentNotice?.classList.add('success');
  paymentNotice?.querySelector('[data-payment-icon]')?.replaceChildren('✓');
  paymentNotice?.querySelector('[data-payment-title]')?.replaceChildren('Referral profile active.');
  paymentNotice?.querySelector('[data-payment-message]')?.replaceChildren(` Your verified code is ${activeCode || 'ready'}. Your tracked links are in your email.`);
  if (paymentNotice) paymentNotice.hidden = false;
}

const referralAccessState = pageParameters.get('referral') || '';
const verificationState = pageParameters.get('verification') || '';
if (paymentNotice && ['invalid', 'expired', 'failed'].includes(verificationState)) {
  const expired = verificationState === 'expired';
  paymentNotice.classList.add('cancelled');
  paymentNotice.querySelector('[data-payment-icon]').textContent = '!';
  paymentNotice.querySelector('[data-payment-title]').textContent = expired ? 'Verification link expired.' : 'Verification could not be completed.';
  paymentNotice.querySelector('[data-payment-message]').textContent = ' Submit the form again to receive a new private link.';
  paymentNotice.hidden = false;
}

if (paymentNotice && ['access-invalid', 'access-expired', 'access-failed'].includes(referralAccessState)) {
  paymentNotice.classList.add('cancelled');
  paymentNotice.querySelector('[data-payment-icon]').textContent = '!';
  paymentNotice.querySelector('[data-payment-title]').textContent = 'Private access link unavailable.';
  paymentNotice.querySelector('[data-payment-message]').textContent = ' Submit the same email again to receive a fresh link.';
  paymentNotice.hidden = false;
}

async function loadEnterpriseOfferStats() {
  const usedElement = document.querySelector('[data-enterprise-offer-used]');
  const limitElement = document.querySelector('[data-enterprise-offer-limit]');
  const remainingElement = document.querySelector('[data-enterprise-offer-remaining]');
  const progressElement = document.querySelector('[data-enterprise-offer-progress]');
  const barElement = document.querySelector('[data-enterprise-offer-bar]');
  if (!usedElement || !limitElement || !remainingElement || !progressElement || !barElement) return;

  try {
    const response = await fetch('/api/referrals/enterprise-offer-stats', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Counter unavailable');
    const stats = await response.json();
    const used = Math.max(0, Number(stats.used) || 0);
    const limit = Math.max(1, Number(stats.limit) || 1000);
    const remaining = Math.max(0, Number(stats.remaining) || 0);
    const percentage = Math.min(100, (used / limit) * 100);

    usedElement.textContent = used.toLocaleString('en-AU');
    limitElement.textContent = limit.toLocaleString('en-AU');
    remainingElement.textContent = remaining > 0
      ? `${remaining.toLocaleString('en-AU')} offers remaining`
      : 'Offer fully claimed';
    progressElement.setAttribute('aria-valuemax', String(limit));
    progressElement.setAttribute('aria-valuenow', String(used));
    barElement.style.width = `${percentage}%`;
  } catch {
    remainingElement.textContent = 'Live count available when payments are connected';
  }
}

loadEnterpriseOfferStats();

const contactForm = document.querySelector('[data-contact-form]');
const contactStatus = document.querySelector('[data-contact-status]');
const contactService = document.querySelector('[data-contact-service]');
const contactMessage = document.querySelector('[data-contact-message]');
const requestedService = pageParameters.get('service');
const requestedBrief = pageParameters.get('brief');

function preselectContactService() {
  if (contactService && requestedService && [...contactService.options].some((option) => option.value === requestedService)) {
    contactService.value = requestedService;
  }
}
preselectContactService();
if (contactMessage && requestedBrief && requestedBrief.length <= 2900) contactMessage.value = requestedBrief;

contactForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = contactForm.querySelector('[type="submit"]');
  const formData = new FormData(contactForm);
  const requestId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  contactStatus.classList.remove('error');
  contactStatus.textContent = 'Sending your secure enquiry…';
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        company: formData.get('company'),
        service: formData.get('service'),
        message: formData.get('message'),
        website: formData.get('website'),
        acceptedPrivacy: formData.get('privacy') === 'on',
        requestId,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your enquiry could not be sent.');
    contactForm.reset();
    preselectContactService();
    contactStatus.textContent = result.message;
  } catch (error) {
    contactStatus.classList.add('error');
    contactStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

const requestedPackage = pageParameters.get('package');
if (requestedPackage && packageCatalog[requestedPackage]) {
  window.setTimeout(() => openCheckout(requestedPackage), 0);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
document.documentElement.classList.add('motion-ready');

const revealTargets = document.querySelectorAll([
  '.approach-grid',
  '.section-heading',
  '.service-card',
  '.package-card',
  '.enterprise-demo',
  '.film-heading',
  '.referral-heading',
  '.referral-rewards',
  '.enterprise-referral-offer',
  '.referral-panel',
  '.process-grid article',
  '.faq > *',
  '.closing-cta > *',
].join(','));

revealTargets.forEach((element, index) => {
  element.dataset.reveal = '';
  element.style.transitionDelay = `${Math.min(index % 4, 3) * 80}ms`;
});

if ('IntersectionObserver' in window && !reducedMotion.matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  revealTargets.forEach((element) => revealObserver.observe(element));
} else {
  revealTargets.forEach((element) => element.classList.add('is-visible'));
}

const setScrolledHeader = () => document.body.classList.toggle('scrolled', window.scrollY > 38);
setScrolledHeader();
window.addEventListener('scroll', setScrolledHeader, { passive: true });

function attachDepthTilt(element, strength = 5, xProperty = '--card-rx', yProperty = '--card-ry') {
  if (!element || reducedMotion.matches || !window.matchMedia('(pointer: fine)').matches) return;
  element.addEventListener('pointermove', (event) => {
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.setProperty(xProperty, `${-y * strength}deg`);
    element.style.setProperty(yProperty, `${x * strength}deg`);
  });
  element.addEventListener('pointerleave', () => {
    element.style.setProperty(xProperty, '0deg');
    element.style.setProperty(yProperty, '0deg');
  });
}

document.querySelectorAll('.package-card').forEach((card) => attachDepthTilt(card, 5.5));
attachDepthTilt(document.querySelector('[data-film-shell]'), 2.2, '--film-rx', '--film-ry');

const hero = document.querySelector('.hero');
const heroArtefact = document.querySelector('[data-hero-artefact]');
if (hero && heroArtefact && !reducedMotion.matches && window.matchMedia('(pointer: fine)').matches) {
  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    heroArtefact.style.setProperty('--hero-rx', `${-8 - y * 10}deg`);
    heroArtefact.style.setProperty('--hero-ry', `${-18 + x * 16}deg`);
    heroArtefact.style.setProperty('--hero-shift-x', `${x * 18}px`);
    heroArtefact.style.setProperty('--hero-shift-y', `${y * 14}px`);
  });
  hero.addEventListener('pointerleave', () => {
    heroArtefact.style.removeProperty('--hero-rx');
    heroArtefact.style.removeProperty('--hero-ry');
    heroArtefact.style.removeProperty('--hero-shift-x');
    heroArtefact.style.removeProperty('--hero-shift-y');
  });
}

const film = document.querySelector('.brand-film video');
if (film && 'IntersectionObserver' in window) {
  const filmObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && entry.intersectionRatio > 0.45) {
      film.play().catch(() => {});
    } else {
      film.pause();
    }
  }, { threshold: [0, 0.45, 0.8] });
  filmObserver.observe(film);
}

function initialiseHeroCanvas() {
  const canvas = document.querySelector('[data-hero-canvas]');
  if (!(canvas instanceof HTMLCanvasElement) || !hero || reducedMotion.matches) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  let width = 0;
  let height = 0;
  let deviceScale = 1;
  let visible = true;
  let frameId = 0;
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const particles = Array.from({ length: 74 }, (_, index) => ({
    x: ((index * 47) % 101) / 101,
    y: ((index * 83) % 97) / 97,
    depth: 0.2 + ((index * 29) % 70) / 100,
    phase: index * 1.37,
  }));

  const resize = () => {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    deviceScale = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * deviceScale);
    canvas.height = Math.round(height * deviceScale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };

  const draw = (timeStamp) => {
    const time = timeStamp * 0.001;
    frameId = window.requestAnimationFrame(draw);
    if (!visible || document.hidden || width === 0 || height === 0) return;
    pointer.x += (pointer.targetX - pointer.x) * 0.035;
    pointer.y += (pointer.targetY - pointer.y) * 0.035;

    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    context.clearRect(0, 0, width, height);
    const horizon = height * (0.56 + pointer.y * 0.018);
    const vanishingX = width * (0.72 + pointer.x * 0.035);

    context.lineWidth = 1;
    for (let index = -15; index <= 15; index += 1) {
      context.beginPath();
      context.moveTo(vanishingX, horizon);
      context.lineTo(width * 0.5 + index * width * 0.085, height + 30);
      context.strokeStyle = `rgba(212,174,88,${0.025 + Math.abs(index) * 0.0015})`;
      context.stroke();
    }
    const drift = (time * 0.18) % 1;
    for (let index = 0; index < 18; index += 1) {
      const progress = (index + drift) / 18;
      const y = horizon + progress ** 2.2 * (height - horizon + 80);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.strokeStyle = `rgba(241,212,140,${0.018 + progress * 0.045})`;
      context.stroke();
    }

    particles.forEach((particle) => {
      const travel = (particle.y - time * 0.006 * particle.depth + 1) % 1;
      const x = particle.x * width + Math.sin(time * 0.22 + particle.phase) * 18 * particle.depth + pointer.x * 26 * particle.depth;
      const y = travel * height + pointer.y * 18 * particle.depth;
      const pulse = 0.35 + Math.abs(Math.sin(time * 0.7 + particle.phase)) * 0.65;
      context.beginPath();
      context.arc(x, y, 0.7 + particle.depth * 1.25, 0, Math.PI * 2);
      context.fillStyle = `rgba(241,212,140,${pulse * particle.depth * 0.22})`;
      context.fill();
    });

    const glow = context.createRadialGradient(vanishingX, horizon, 0, vanishingX, horizon, width * 0.32);
    glow.addColorStop(0, 'rgba(212,174,88,.09)');
    glow.addColorStop(1, 'rgba(212,174,88,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  };

  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    pointer.targetX = (event.clientX - rect.left) / rect.width - 0.5;
    pointer.targetY = (event.clientY - rect.top) / rect.height - 0.5;
  });
  hero.addEventListener('pointerleave', () => {
    pointer.targetX = 0;
    pointer.targetY = 0;
  });
  const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
  visibilityObserver.observe(hero);
  window.addEventListener('resize', resize, { passive: true });
  resize();
  frameId = window.requestAnimationFrame(draw);

  reducedMotion.addEventListener?.('change', (event) => {
    if (!event.matches) return;
    window.cancelAnimationFrame(frameId);
    context.clearRect(0, 0, width, height);
  });
}

initialiseHeroCanvas();
