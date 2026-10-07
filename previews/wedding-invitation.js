(() => {
  'use strict';

  function initialise() {
    const frame = document.querySelector('.w-frame');
    const orbit = document.querySelector('.w-orbit');
    if (!frame) return;
    const preference = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    function rotateOrbit() {
      if (orbit && preference && !preference.matches) {
        orbit.style.transform = `rotate(${window.scrollY * .12}deg)`;
      }
    }

    function applyMotionPreference() {
      const enabled = Boolean(preference && !preference.matches);
      frame.classList.toggle('w-frame-enter', enabled);
      if (enabled) rotateOrbit();
      else orbit?.style.removeProperty('transform');
    }

    applyMotionPreference();
    if (orbit) window.addEventListener('scroll', rotateOrbit, { passive: true });
    preference?.addEventListener?.('change', applyMotionPreference);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
