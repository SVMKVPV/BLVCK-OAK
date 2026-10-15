/**
 * BLVCK OAK site-wide firefall.
 *
 * Scroll energy releases a restrained shower of burning oak leaves. The
 * overlay never handles pointer input or changes scroll position, and sleeps
 * whenever there is no motion left to render.
 */
(() => {
  'use strict';

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (window.self !== window.top || motionPreference.matches || connection?.saveData) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'site-firefall';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  if (document.body.matches('.workspace-body, .oakpay-app-body, .sales-page') || document.querySelector('form, .workspace, .op-app-shell')) {
    canvas.classList.add('site-firefall--subdued');
  }

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!context) return;

  document.body.append(canvas);

  const leaves = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let particleLimit = 24;
  let frame = 0;
  let resizeFrame = 0;
  let lastFrameAt = performance.now();
  let lastScrollAt = lastFrameAt;
  let lastScrollY = window.scrollY;
  let scrollEnergy = 0;
  let spawnRemainder = 0;
  let destroyed = false;
  let heroSuppressed = false;
  let heroObserver;

  const random = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

  function resize() {
    resizeFrame = 0;
    const previousWidth = width || window.innerWidth;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, width < 700 ? 1 : 1.35);
    particleLimit = width < 700 ? 12 : 24;

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const scaleX = width / Math.max(1, previousWidth);
    for (const leaf of leaves) leaf.x *= scaleX;
  }

  function scheduleResize() {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
  }

  function makeLeaf(intensity = 1) {
    if (leaves.length >= particleLimit) return;

    const size = random(width < 700 ? 4.5 : 5.5, width < 700 ? 8 : 10.5);
    leaves.push({
      x: random(-size, width + size),
      y: random(-height * .18 - 34, -size * 2),
      vx: random(-20, 20) * (0.75 + intensity * .2),
      vy: random(95, 158) + intensity * 34,
      angle: random(0, Math.PI * 2),
      spin: random(-2.5, 2.5),
      wobble: random(1.2, 3.4),
      wobbleOffset: random(0, Math.PI * 2),
      size,
      glow: random(.55, 1),
      seed: random(0, 1000),
      emberCount: Math.random() < .5 ? 1 : 2,
    });
  }

  function drawLeaf(leaf, now) {
    const flicker = .75 + Math.sin(now * .012 + leaf.seed) * .2;
    const flameLength = leaf.size * (1.45 + flicker * .9);
    const sway = Math.sin(now * .006 + leaf.seed) * leaf.size * .45;

    context.save();
    context.translate(leaf.x, leaf.y);
    context.rotate(leaf.angle);
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.shadowColor = 'rgba(212, 174, 88, .86)';
    context.shadowBlur = leaf.size * 1.25;

    // A pair of old-gold flame tongues trails above each falling leaf.
    context.beginPath();
    context.moveTo(-leaf.size * .18, -leaf.size * .42);
    context.bezierCurveTo(
      -leaf.size * .7,
      -flameLength * .52,
      sway,
      -flameLength * .78,
      sway * .35,
      -flameLength,
    );
    context.strokeStyle = `rgba(212, 174, 88, ${.2 + leaf.glow * .22})`;
    context.lineWidth = Math.max(1, leaf.size * .36);
    context.stroke();

    context.beginPath();
    context.moveTo(leaf.size * .16, -leaf.size * .28);
    context.quadraticCurveTo(-sway * .4, -flameLength * .62, -sway * .1, -flameLength * .84);
    context.strokeStyle = `rgba(241, 212, 140, ${.23 + flicker * .24})`;
    context.lineWidth = Math.max(.75, leaf.size * .18);
    context.stroke();

    // Compact oak-leaf silhouette: lobed edges, dark char and a hot vein.
    context.beginPath();
    context.moveTo(0, -leaf.size * 1.25);
    context.bezierCurveTo(leaf.size * .35, -leaf.size, leaf.size * .92, -leaf.size * .96, leaf.size * .64, -leaf.size * .5);
    context.bezierCurveTo(leaf.size * 1.04, -leaf.size * .2, leaf.size * .88, leaf.size * .2, leaf.size * .55, leaf.size * .28);
    context.bezierCurveTo(leaf.size * .72, leaf.size * .7, leaf.size * .3, leaf.size * 1.02, 0, leaf.size * 1.22);
    context.bezierCurveTo(-leaf.size * .3, leaf.size * 1.02, -leaf.size * .72, leaf.size * .7, -leaf.size * .55, leaf.size * .28);
    context.bezierCurveTo(-leaf.size * .88, leaf.size * .2, -leaf.size * 1.04, -leaf.size * .2, -leaf.size * .64, -leaf.size * .5);
    context.bezierCurveTo(-leaf.size * .92, -leaf.size * .96, -leaf.size * .35, -leaf.size, 0, -leaf.size * 1.25);
    context.closePath();
    context.fillStyle = `rgba(18, 17, 13, ${.82 + leaf.glow * .1})`;
    context.fill();
    context.strokeStyle = `rgba(212, 174, 88, ${.5 + flicker * .3})`;
    context.lineWidth = Math.max(.7, leaf.size * .12);
    context.stroke();

    context.beginPath();
    context.moveTo(0, -leaf.size * .92);
    context.lineTo(0, leaf.size * 1.05);
    context.strokeStyle = `rgba(241, 212, 140, ${.45 + flicker * .35})`;
    context.lineWidth = Math.max(.65, leaf.size * .1);
    context.stroke();

    // Tiny embers break away without needing a second particle system.
    for (let index = 0; index < leaf.emberCount; index += 1) {
      const phase = now * (.004 + index * .0015) + leaf.seed + index * 2.7;
      const emberX = Math.sin(phase) * leaf.size * (1.1 + index * .65);
      const emberY = -leaf.size * (1.15 + index * .7) - Math.cos(phase * .7) * leaf.size;
      context.beginPath();
      context.arc(emberX, emberY, Math.max(.55, leaf.size * (.07 + index * .02)), 0, Math.PI * 2);
      context.fillStyle = `rgba(241, 212, 140, ${.28 + flicker * .32})`;
      context.fill();
    }

    context.restore();
  }

  function wake() {
    if (!frame && !document.hidden && !destroyed) {
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(render);
    }
  }

  function render(now) {
    frame = 0;
    const elapsed = Math.min((now - lastFrameAt) / 1000, .04);
    lastFrameAt = now;
    context.clearRect(0, 0, width, height);

    scrollEnergy *= Math.pow(.12, elapsed);
    spawnRemainder += scrollEnergy * elapsed * 5.5;
    while (spawnRemainder >= 1 && leaves.length < particleLimit) {
      makeLeaf(Math.min(2, scrollEnergy));
      spawnRemainder -= 1;
    }

    for (let index = leaves.length - 1; index >= 0; index -= 1) {
      const leaf = leaves[index];
      leaf.y += leaf.vy * elapsed;
      leaf.x += (leaf.vx + Math.sin(now * .0018 * leaf.wobble + leaf.wobbleOffset) * 19) * elapsed;
      leaf.angle += leaf.spin * elapsed;
      drawLeaf(leaf, now);

      if (leaf.y > height + leaf.size * 4 || leaf.x < -70 || leaf.x > width + 70) {
        leaves.splice(index, 1);
      }
    }

    if (leaves.length || scrollEnergy > .025 || spawnRemainder >= 1) wake();
  }

  function onScroll() {
    if (heroSuppressed) return;
    const now = performance.now();
    const distance = Math.abs(window.scrollY - lastScrollY);
    const elapsed = Math.max(16, now - lastScrollAt);
    const velocity = distance / elapsed;
    lastScrollY = window.scrollY;
    lastScrollAt = now;

    if (distance < 1) return;
    const impulse = Math.min(2.2, distance / Math.max(180, height * .32) + velocity * .42);
    scrollEnergy = Math.min(2.6, scrollEnergy + impulse);
    const burst = Math.min(5, 1 + Math.floor(distance / 95 + velocity * 1.4));
    for (let index = 0; index < burst; index += 1) makeLeaf(Math.min(2, scrollEnergy));
    wake();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      context.clearRect(0, 0, width, height);
      return;
    }
    if (leaves.length) wake();
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', scheduleResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    motionPreference.removeEventListener?.('change', onMotionChange);
    heroObserver?.disconnect();
    canvas.remove();
  }

  function onMotionChange(event) {
    if (event.matches) destroy();
  }

  resize();
  const homepageHero = document.querySelector('[data-cinematic-oak]')?.closest('.hero');
  if (homepageHero && 'IntersectionObserver' in window) {
    heroSuppressed = true;
    canvas.classList.add('is-suppressed');
    heroObserver = new IntersectionObserver(([entry]) => {
      heroSuppressed = entry.intersectionRatio >= .55;
      canvas.classList.toggle('is-suppressed', heroSuppressed);
      if (heroSuppressed) {
        leaves.length = 0;
        scrollEnergy = 0;
        spawnRemainder = 0;
        context.clearRect(0, 0, width, height);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }, { threshold: [0, .55, 1] });
    heroObserver.observe(homepageHero);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  motionPreference.addEventListener?.('change', onMotionChange);
  window.addEventListener('pagehide', destroy, { once: true });
})();
