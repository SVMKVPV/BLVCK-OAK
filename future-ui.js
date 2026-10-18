/* BLVCK OAK shared interaction layer. No navigation, payment or form interception. */
(() => {
  'use strict';
  const body = document.body;
  if (!body?.hasAttribute('data-future-ui') || body.dataset.futureUiReady === 'true') return;

  const storageKey = 'blvckoak-motion-paused';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const controls = new Set();
  const registeredCards = new WeakSet();
  const registeredReveals = new WeakSet();
  const registeredParallax = new WeakSet();
  const parallaxInView = new Set();
  const animations = new Set();
  const abort = new AbortController();
  const eventOptions = { signal: abort.signal };
  const passiveOptions = { passive: true, signal: abort.signal };
  let userPaused = false;
  try { userPaused = sessionStorage.getItem(storageKey) === 'true'; } catch { /* Storage may be unavailable. */ }
  let paused = true;
  let suspended = false;
  let disposed = false;
  let pointerFrame = 0;
  let parallaxFrame = 0;
  let pointer = null;
  let cursorTarget = null;
  let activeCard = null;
  let pointerDown = false;

  const cursor = document.createElement('div');
  cursor.className = 'future-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  const cursorGlyph = document.createElement('span');
  cursorGlyph.className = 'future-cursor__glyph';
  cursorGlyph.textContent = '↗';
  const cursorLabel = document.createElement('span');
  cursorLabel.className = 'future-cursor__label';
  cursor.append(cursorGlyph, cursorLabel);
  body.append(cursor);
  // A missing stylesheet must never remove the usable native pointer.
  const cursorStyled = getComputedStyle(cursor).getPropertyValue('--future-cursor-enabled').trim() === '1';

  const cardSelector = '[data-future-card], .portfolio-card, .concept-photo-card, .package-card';
  const revealSelector = '[data-future-reveal]';
  const parallaxSelector = '[data-future-parallax]';
  const nativeSelector = 'input, textarea, select, option, label, [contenteditable]:not([contenteditable="false"]), iframe, video, audio, pre, code, [data-native-cursor]';
  const textSelector = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, figcaption, blockquote, td, th';
  const actionSelector = 'a[href], button, summary';

  function modalActive() {
    if (body.classList.contains('modal-open') || body.classList.contains('menu-open') || document.querySelector('dialog[open]')) return true;
    try { return Boolean(document.querySelector(':popover-open')); } catch { return false; }
  }

  function hideCursor() {
    if (cursorTarget) cursorTarget.classList.remove('future-cursor-target');
    cursorTarget = null;
    cursor.classList.remove('is-visible', 'is-action');
    delete body.dataset.futureCursorReady;
  }

  function resetCard() {
    if (!activeCard) return;
    activeCard.classList.remove('future-card-hover');
    activeCard.style.removeProperty('--future-tilt');
    activeCard.style.removeProperty('--future-pointer-x');
    activeCard.style.removeProperty('--future-pointer-y');
    activeCard = null;
  }

  function resetPointer() {
    pointer = null;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    hideCursor();
    resetCard();
  }

  function animateReveal(element) {
    if (paused || typeof element.animate !== 'function') return;
    // Resting CSS is always visible. Animation failure cannot strand content.
    try {
      const animation = element.animate([
        { opacity: 0.55, translate: '0 12px' },
        { opacity: 1, translate: '0 0' },
      ], { duration: 580, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animations.add(animation);
      animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    } catch { /* Keep the readable, unanimated element. */ }
  }

  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      animateReveal(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -20px 0px' }) : null;

  const parallaxObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) parallaxInView.add(entry.target);
      else {
        parallaxInView.delete(entry.target);
        entry.target.style.removeProperty('--future-parallax-y');
      }
    }
    scheduleParallax();
  }, { rootMargin: '40px 0px' }) : null;

  function visit(root, selector, callback) {
    if (!(root instanceof Element)) return;
    if (root.matches(selector)) callback(root);
    root.querySelectorAll(selector).forEach(callback);
  }

  function register(root) {
    visit(root, '[data-motion-toggle]', (button) => {
      if (!(button instanceof HTMLButtonElement) || controls.has(button)) return;
      controls.add(button);
      button.type = 'button';
      button.addEventListener('click', () => {
        if (reduced.matches) return;
        userPaused = !userPaused;
        try { sessionStorage.setItem(storageKey, String(userPaused)); } catch { /* Keep the in-memory choice. */ }
        syncMotion();
      }, eventOptions);
      updateControl(button);
    });
    visit(root, cardSelector, (card) => {
      if (registeredCards.has(card) || card.closest('[data-future-effects="off"]') || card.querySelector('form, input, textarea, select')) return;
      registeredCards.add(card);
      card.setAttribute('data-future-card', '');
      const light = document.createElement('span');
      light.className = 'future-card-light';
      light.setAttribute('aria-hidden', 'true');
      card.append(light);
    });
    visit(root, revealSelector, (element) => {
      if (registeredReveals.has(element)) return;
      registeredReveals.add(element);
      // Do not animate form controls, live status or an already visible opening.
      if (element.matches('form, input, select, textarea, [role="status"], [aria-live]') || element.getBoundingClientRect().top < innerHeight * 0.85) return;
      revealObserver?.observe(element);
    });
    visit(root, parallaxSelector, (element) => {
      if (registeredParallax.has(element) || element.matches('form, input, button, a, textarea, select') || element.querySelector('form, input, button, a, textarea, select')) return;
      registeredParallax.add(element);
      parallaxObserver?.observe(element);
    });
  }

  function updateControl(button) {
    const motionOff = userPaused || reduced.matches;
    button.setAttribute('aria-pressed', String(motionOff));
    button.disabled = reduced.matches;
    button.setAttribute('aria-label', reduced.matches ? 'Decorative motion paused by your system preference' : motionOff ? 'Resume decorative motion' : 'Pause decorative motion');
    button.title = reduced.matches ? 'Your device prefers reduced motion' : motionOff ? 'Resume decorative motion' : 'Pause decorative motion';
    const label = button.querySelector('[data-motion-label]');
    if (label) label.textContent = reduced.matches ? 'Motion reduced' : motionOff ? 'Motion off' : 'Motion on';
  }

  function syncMotion() {
    if (disposed) return;
    paused = userPaused || reduced.matches || document.hidden || suspended;
    body.dataset.motionPaused = String(paused);
    body.dataset.motionActive = String(!paused);
    for (const button of controls) {
      if (button.isConnected) updateControl(button);
      else controls.delete(button);
    }
    if (paused) {
      resetPointer();
      if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
      parallaxFrame = 0;
      for (const animation of animations) animation.cancel();
      animations.clear();
      for (const element of parallaxInView) element.style.removeProperty('--future-parallax-y');
    } else scheduleParallax();
    window.dispatchEvent(new CustomEvent('blvckoak:motion-change', { detail: { paused, userPaused, reducedMotion: reduced.matches } }));
  }

  function drawPointer() {
    pointerFrame = 0;
    if (!pointer || paused || !finePointer.matches || forcedColors.matches || pointerDown || modalActive()) { resetPointer(); return; }
    const { x, y, target } = pointer;
    if (!target.isConnected || target.closest(nativeSelector) || target.closest('[inert]')) { hideCursor(); resetCard(); return; }
    const action = target.closest(actionSelector);
    const disabledAction = action?.matches(':disabled, [aria-disabled="true"]');
    const isText = !action && target.closest(textSelector);
    const selection = window.getSelection();
    if (isText || disabledAction || (selection && !selection.isCollapsed)) hideCursor();
    else if (cursorStyled) {
      // Position and display the custom pointer before hiding the native one.
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      cursor.classList.add('is-visible');
      cursor.classList.toggle('is-action', Boolean(action));
      cursorLabel.textContent = action ? (action.dataset.futureCursor || (action.tagName === 'A' ? 'Open' : action.tagName === 'SUMMARY' ? 'Expand' : 'Select')).slice(0, 18) : '';
      if (cursorTarget !== target) {
        cursorTarget?.classList.remove('future-cursor-target');
        cursorTarget = target;
        cursorTarget.classList.add('future-cursor-target');
      }
      body.dataset.futureCursorReady = 'true';
    }
    const card = target.closest('[data-future-card]');
    if (!card || !registeredCards.has(card) || card.matches(':focus-within') || disabledAction) { resetCard(); return; }
    if (activeCard !== card) { resetCard(); activeCard = card; }
    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { resetCard(); return; }
    const nx = Math.max(-1, Math.min(1, ((x - bounds.left) / bounds.width - 0.5) * 2));
    const ny = Math.max(-1, Math.min(1, ((y - bounds.top) / bounds.height - 0.5) * 2));
    const length = Math.hypot(nx, ny);
    card.style.setProperty('--future-tilt', length > 0.001 ? `${(-ny / length).toFixed(3)} ${(nx / length).toFixed(3)} 0 ${Math.min(1.6, length * 1.15).toFixed(2)}deg` : '0deg');
    card.style.setProperty('--future-pointer-x', `${(x - bounds.left).toFixed(1)}px`);
    card.style.setProperty('--future-pointer-y', `${(y - bounds.top).toFixed(1)}px`);
    card.classList.add('future-card-hover');
  }

  function scheduleParallax() {
    if (paused || parallaxFrame || !parallaxInView.size) return;
    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      if (paused) return;
      for (const element of parallaxInView) {
        if (!element.isConnected) { parallaxInView.delete(element); continue; }
        const bounds = element.getBoundingClientRect();
        const progress = Math.max(-1, Math.min(1, (innerHeight / 2 - bounds.top - bounds.height / 2) / innerHeight));
        element.style.setProperty('--future-parallax-y', `${(progress * 10).toFixed(2)}px`);
      }
    });
  }

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || paused || !finePointer.matches || forcedColors.matches || pointerDown || !(event.target instanceof Element)) return;
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    if (!pointerFrame) pointerFrame = requestAnimationFrame(drawPointer);
  }, passiveOptions);
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget || event.relatedTarget instanceof HTMLIFrameElement) resetPointer();
  }, passiveOptions);
  document.addEventListener('pointerdown', () => { pointerDown = true; resetPointer(); }, passiveOptions);
  window.addEventListener('pointerup', () => { pointerDown = false; }, passiveOptions);
  window.addEventListener('pointercancel', () => { pointerDown = false; resetPointer(); }, passiveOptions);
  document.addEventListener('keydown', resetPointer, eventOptions);
  document.addEventListener('focusin', resetPointer, eventOptions);
  window.addEventListener('blur', () => { pointerDown = false; resetPointer(); }, eventOptions);
  document.addEventListener('selectionchange', () => { if (!window.getSelection()?.isCollapsed) resetPointer(); }, eventOptions);
  window.addEventListener('scroll', () => { resetPointer(); scheduleParallax(); }, passiveOptions);
  window.addEventListener('resize', () => { resetPointer(); scheduleParallax(); }, passiveOptions);
  document.addEventListener('visibilitychange', syncMotion, eventOptions);
  reduced.addEventListener('change', syncMotion, eventOptions);
  finePointer.addEventListener('change', resetPointer, eventOptions);
  forcedColors.addEventListener('change', resetPointer, eventOptions);

  register(body);
  if (!controls.size) {
    const button = document.createElement('button');
    button.className = 'future-motion-toggle';
    button.setAttribute('data-motion-toggle', '');
    const dot = document.createElement('span'); dot.className = 'future-motion-indicator'; dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.setAttribute('data-motion-label', '');
    button.append(dot, label);
    body.append(button);
    register(button);
  }

  const additions = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') { if (modalActive()) resetPointer(); continue; }
      for (const node of record.addedNodes) {
        if (node instanceof Element && !node.matches('.future-cursor, .future-cursor *, .future-card-light')) register(node);
      }
    }
  });
  additions.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
  const bodyState = new MutationObserver(() => { if (modalActive()) resetPointer(); });
  bodyState.observe(body, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('pagehide', (event) => {
    suspended = true;
    syncMotion();
    if (event.persisted) return;
    disposed = true;
    abort.abort();
    revealObserver?.disconnect();
    parallaxObserver?.disconnect();
    additions.disconnect();
    bodyState.disconnect();
    cursor.remove();
  }, eventOptions);
  window.addEventListener('pageshow', () => { suspended = false; syncMotion(); }, eventOptions);
  body.dataset.futureUiReady = 'true';
  syncMotion();
})();
