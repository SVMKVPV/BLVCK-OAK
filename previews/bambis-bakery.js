(() => {
  function enhanceBakery() {
    document.body.classList.add('ready');
    const cake = document.querySelector('.b-cake');
    if (!cake) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    function updateRotation() {
      frame = 0;
      cake.style.setProperty('--cake-scroll-rotation', `${window.scrollY * 0.035}deg`);
    }

    function scheduleRotation() {
      if (!frame) frame = window.requestAnimationFrame(updateRotation);
    }

    function applyMotionPreference() {
      window.removeEventListener('scroll', scheduleRotation);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (reducedMotion.matches) {
        cake.style.removeProperty('--cake-scroll-rotation');
        return;
      }
      window.addEventListener('scroll', scheduleRotation, { passive: true });
      scheduleRotation();
    }

    reducedMotion.addEventListener('change', applyMotionPreference);
    applyMotionPreference();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceBakery, { once: true });
  } else {
    enhanceBakery();
  }
})();
