/**
 * BLVCK OAK site-wide cinematic root + firefall system.
 *
 * Scroll grows a restrained oak-root network and releases burning oak leaves
 * through two depth planes. The rear plane is matted around readable content,
 * so roots and some leaves visibly travel behind copy while a sparse foreground
 * plane supplies the 3D parallax. The canvas never handles pointer input or
 * changes scroll position, and sleeps whenever there is no motion left to draw.
 */
(() => {
  'use strict';

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (window.self !== window.top || motionPreference.matches || forcedColors.matches || connection?.saveData) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'site-firefall';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  const subdued = document.body.matches('.workspace-body, .oakpay-app-body, .sales-page')
    || Boolean(document.querySelector('form, .workspace, .op-app-shell'));
  if (subdued) canvas.classList.add('site-firefall--subdued');

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const rootCanvas = document.createElement('canvas');
  const rootContext = rootCanvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!context || !rootContext) return;

  document.body.append(canvas);

  const leaves = [];
  const roots = [];
  const contentWindows = [];
  let width = 0;
  let height = 0;
  let documentHeight = 1;
  let pixelRatio = 1;
  let rootPixelRatio = 1;
  let particleLimit = 24;
  let frame = 0;
  let resizeFrame = 0;
  let contentRefreshTimer = 0;
  let lastFrameAt = performance.now();
  let lastPaintAt = 0;
  let lastScrollAt = lastFrameAt;
  let lastScrollY = window.scrollY;
  let lastSceneRefreshAt = 0;
  let scrollEnergy = 0;
  let spawnRemainder = 0;
  let rootCacheProgress = -1;
  let destroyed = false;
  let suspended = false;
  let heroSuppressed = false;
  let heroObserver;
  let contentObserver;

  const random = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
  const seeded = (seed) => {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  const cubic = (start, controlA, controlB, end, time) => {
    const inverse = 1 - time;
    return inverse ** 3 * start
      + 3 * inverse ** 2 * time * controlA
      + 3 * inverse * time ** 2 * controlB
      + time ** 3 * end;
  };

  function cacheContentWindows() {
    contentWindows.length = 0;
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd',
      'a', 'label', 'button', '[role="button"]', 'legend', 'summary',
      'blockquote', 'figcaption', 'th', 'td',
      '.button', '.eyebrow', '.kicker', '.section-label', '.hero-copy',
      'input', 'textarea', 'select',
    ].join(',');
    const candidates = document.querySelectorAll(selectors);

    for (const element of candidates) {
      if (element.closest('[hidden]')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (element.tagName === 'A' && rect.height > 120 && element.querySelector('img, picture, video, iframe')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;

      const heading = /^H[1-4]$/.test(element.tagName);
      contentWindows.push({
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
        padding: heading ? 7 : 3,
      });
    }
  }

  function scheduleContentRefresh() {
    window.clearTimeout(contentRefreshTimer);
    contentRefreshTimer = window.setTimeout(() => {
      contentRefreshTimer = 0;
      if (destroyed) return;
      documentHeight = Math.max(height, document.documentElement.scrollHeight, document.body.scrollHeight);
      cacheContentWindows();
      wake();
    }, 120);
  }

  function buildRootNetwork() {
    roots.length = 0;
    const rootCount = width < 700 ? 8 : 15;
    const pointCount = width < 700 ? 22 : 30;

    for (let index = 0; index < rootCount; index += 1) {
      const seed = index + 3.17;
      const source = index % 3;
      const startX = source === 0
        ? width * (-.04 + seeded(seed) * .22)
        : source === 1
          ? width * (.82 + seeded(seed) * .22)
          : width * (.34 + seeded(seed) * .32);
      const startY = height * (1.01 + seeded(seed + 2) * .1);
      const endX = width * (.04 + seeded(seed + 4) * .92);
      const endY = height * (-.08 + seeded(seed + 6) * .68);
      const controlAX = startX + (endX - startX) * (.16 + seeded(seed + 8) * .18)
        + (seeded(seed + 9) - .5) * width * .22;
      const controlAY = height * (.71 + seeded(seed + 10) * .17);
      const controlBX = endX + (seeded(seed + 11) - .5) * width * .25;
      const controlBY = height * (.19 + seeded(seed + 12) * .35);
      const points = [];

      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const time = pointIndex / (pointCount - 1);
        const taper = Math.sin(time * Math.PI);
        const organicOffset = Math.sin(time * (8 + seeded(seed + 13) * 8) + seed) * taper;
        points.push({
          x: cubic(startX, controlAX, controlBX, endX, time) + organicOffset * (5 + seeded(seed + 14) * 12),
          y: cubic(startY, controlAY, controlBY, endY, time),
        });
      }

      roots.push({
        points,
        revealAt: (index / rootCount) * .68,
        revealSpan: .2 + seeded(seed + 15) * .2,
        thickness: (width < 700 ? 1.15 : 1.5) + seeded(seed + 16) * 3.2,
        depth: .25 + seeded(seed + 17) * .75,
        seed,
      });
    }
  }

  function resize() {
    resizeFrame = 0;
    const previousWidth = width || window.innerWidth;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    documentHeight = Math.max(height, document.documentElement.scrollHeight, document.body.scrollHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, width < 700 ? 1 : width > 1900 ? 1.1 : 1.35);
    rootPixelRatio = Math.min(window.devicePixelRatio || 1, width < 700 ? .75 : width > 1900 ? .7 : 1);
    particleLimit = width < 700 ? 12 : 24;

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    rootCanvas.width = Math.round(width * rootPixelRatio);
    rootCanvas.height = Math.round(height * rootPixelRatio);
    rootContext.setTransform(rootPixelRatio, 0, 0, rootPixelRatio, 0, 0);
    rootCacheProgress = -1;

    const scaleX = width / Math.max(1, previousWidth);
    for (const leaf of leaves) leaf.x *= scaleX;
    buildRootNetwork();
    cacheContentWindows();
    wake();
  }

  function scheduleResize() {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
  }

  function makeLeaf(intensity = 1) {
    if (leaves.length >= particleLimit) return;

    const depth = random(.12, 1);
    const size = random(width < 700 ? 4.5 : 5.5, width < 700 ? 8 : 10.5) * (.72 + depth * .42);
    leaves.push({
      x: random(-size, width + size),
      y: random(-height * .18 - 34, -size * 2),
      vx: random(-20, 20) * (0.75 + intensity * .2) * (.7 + depth * .45),
      vy: random(95, 158) + intensity * 34,
      angle: random(0, Math.PI * 2),
      spin: random(-2.5, 2.5),
      tumble: random(0, Math.PI * 2),
      tumbleSpeed: random(2.1, 4.8),
      wobble: random(1.2, 3.4),
      wobbleOffset: random(0, Math.PI * 2),
      size,
      depth,
      foreground: !subdued && depth > .76 && Math.random() < .46,
      glow: random(.55, 1),
      seed: random(0, 1000),
      emberCount: Math.random() < .5 ? 1 : 2,
    });
  }

  function traceLeaf(size) {
    context.beginPath();
    context.moveTo(0, -size * 1.25);
    context.bezierCurveTo(size * .35, -size, size * .92, -size * .96, size * .64, -size * .5);
    context.bezierCurveTo(size * 1.04, -size * .2, size * .88, size * .2, size * .55, size * .28);
    context.bezierCurveTo(size * .72, size * .7, size * .3, size * 1.02, 0, size * 1.22);
    context.bezierCurveTo(-size * .3, size * 1.02, -size * .72, size * .7, -size * .55, size * .28);
    context.bezierCurveTo(-size * .88, size * .2, -size * 1.04, -size * .2, -size * .64, -size * .5);
    context.bezierCurveTo(-size * .92, -size * .96, -size * .35, -size, 0, -size * 1.25);
    context.closePath();
  }

  function drawLeaf(leaf, now) {
    const flicker = .75 + Math.sin(now * .012 + leaf.seed) * .2;
    const flameLength = leaf.size * (1.45 + flicker * .9);
    const sway = Math.sin(now * .006 + leaf.seed) * leaf.size * .45;
    const tilt = Math.cos(leaf.tumble);
    const perspectiveScale = .62 + leaf.depth * .7;
    const foreshorten = .22 + Math.abs(tilt) * .78;
    const depthAlpha = leaf.foreground ? .88 : .3 + leaf.depth * .42;

    context.save();
    context.translate(leaf.x, leaf.y);
    context.rotate(leaf.angle);
    context.transform(
      perspectiveScale * foreshorten * (tilt < 0 ? -1 : 1),
      Math.sin(leaf.tumble) * .13,
      Math.sin(leaf.tumble) * .08,
      perspectiveScale,
      0,
      0,
    );
    context.globalAlpha = depthAlpha;
    context.lineCap = 'round';

    // Soft cast shadow and offset rim sell the leaf's distance from the page.
    context.beginPath();
    context.ellipse(leaf.size * .28, leaf.size * .58, leaf.size * .78, leaf.size * .32, .18, 0, Math.PI * 2);
    context.fillStyle = 'rgba(0, 0, 0, .48)';
    context.shadowColor = 'rgba(0, 0, 0, .72)';
    context.shadowBlur = leaf.size * (1.1 + leaf.depth);
    context.fill();

    // Layered old-gold flame tongues trail above each falling leaf.
    context.globalCompositeOperation = 'lighter';
    context.shadowColor = 'rgba(212, 174, 88, .9)';
    context.shadowBlur = leaf.size * (1.1 + leaf.depth * .65);
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
    context.strokeStyle = `rgba(212, 174, 88, ${.2 + leaf.glow * .24})`;
    context.lineWidth = Math.max(1, leaf.size * .38);
    context.stroke();

    context.beginPath();
    context.moveTo(leaf.size * .16, -leaf.size * .28);
    context.quadraticCurveTo(-sway * .4, -flameLength * .62, -sway * .1, -flameLength * .84);
    context.strokeStyle = `rgba(255, 230, 164, ${.24 + flicker * .26})`;
    context.lineWidth = Math.max(.75, leaf.size * .18);
    context.stroke();

    // A shaded, lobed silhouette with a hot rim creates the 3D charred shell.
    context.globalCompositeOperation = 'source-over';
    context.shadowColor = 'rgba(212, 174, 88, .42)';
    context.shadowBlur = leaf.size * .7;
    traceLeaf(leaf.size);
    const shell = context.createLinearGradient(-leaf.size, -leaf.size, leaf.size, leaf.size);
    shell.addColorStop(0, 'rgba(76, 48, 20, .96)');
    shell.addColorStop(.42, 'rgba(12, 13, 10, .98)');
    shell.addColorStop(.72, 'rgba(38, 27, 14, .98)');
    shell.addColorStop(1, 'rgba(142, 94, 29, .92)');
    context.fillStyle = shell;
    context.fill();
    context.strokeStyle = `rgba(226, 183, 83, ${.54 + flicker * .3})`;
    context.lineWidth = Math.max(.7, leaf.size * .12);
    context.stroke();

    context.shadowBlur = 0;
    context.beginPath();
    context.moveTo(0, -leaf.size * .94);
    context.lineTo(0, leaf.size * 1.08);
    context.moveTo(0, -leaf.size * .08);
    context.lineTo(leaf.size * .5, -leaf.size * .48);
    context.moveTo(0, leaf.size * .24);
    context.lineTo(-leaf.size * .46, leaf.size * .02);
    context.strokeStyle = `rgba(255, 222, 140, ${.36 + flicker * .36})`;
    context.lineWidth = Math.max(.6, leaf.size * .085);
    context.stroke();

    // Tiny embers break away without needing a second particle system.
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < leaf.emberCount; index += 1) {
      const phase = now * (.004 + index * .0015) + leaf.seed + index * 2.7;
      const emberX = Math.sin(phase) * leaf.size * (1.1 + index * .65);
      const emberY = -leaf.size * (1.15 + index * .7) - Math.cos(phase * .7) * leaf.size;
      context.beginPath();
      context.arc(emberX, emberY, Math.max(.55, leaf.size * (.07 + index * .02)), 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 225, 144, ${.3 + flicker * .34})`;
      context.fill();
    }

    context.restore();
  }

  function rootGrowth() {
    const maximumScroll = Math.max(1, documentHeight - height);
    const pageProgress = clamp(window.scrollY / maximumScroll);
    const earlyTravel = clamp(window.scrollY / Math.max(1, height * 2.7));
    return clamp(Math.max(pageProgress, earlyTravel * .88));
  }

  function traceRoot(points, visiblePoints, offsetX = 0) {
    rootContext.beginPath();
    rootContext.moveTo(points[0].x + offsetX, points[0].y);
    for (let index = 1; index < visiblePoints; index += 1) {
      const point = points[index];
      const previous = points[index - 1];
      rootContext.quadraticCurveTo(
        previous.x + offsetX,
        previous.y,
        (previous.x + point.x) * .5 + offsetX,
        (previous.y + point.y) * .5,
      );
    }
  }

  function drawRoots(growth) {
    if (growth <= 0) return;

    for (const root of roots) {
      const reveal = clamp((growth - root.revealAt) / root.revealSpan);
      if (reveal <= 0) continue;
      const eased = 1 - (1 - reveal) ** 3;
      const visiblePoints = Math.max(2, Math.ceil(root.points.length * eased));
      const first = root.points[0];
      const last = root.points[Math.min(root.points.length - 1, visiblePoints - 1)];
      const pulse = 1;

      rootContext.save();
      rootContext.lineCap = 'round';
      rootContext.lineJoin = 'round';

      // Deep ambient strand.
      traceRoot(root.points, visiblePoints);
      rootContext.globalAlpha = .18 + root.depth * .14;
      rootContext.strokeStyle = 'rgba(0, 0, 0, .88)';
      rootContext.lineWidth = root.thickness * 3.2 * pulse;
      rootContext.shadowColor = 'rgba(0, 0, 0, .88)';
      rootContext.shadowBlur = 11 + root.depth * 13;
      rootContext.stroke();

      // Warm bark core and a narrow gold light edge create cylindrical depth.
      traceRoot(root.points, visiblePoints);
      const bark = rootContext.createLinearGradient(first.x, first.y, last.x, last.y);
      bark.addColorStop(0, 'rgba(35, 24, 13, .88)');
      bark.addColorStop(.5, 'rgba(104, 67, 27, .72)');
      bark.addColorStop(1, 'rgba(212, 174, 88, .42)');
      rootContext.globalAlpha = .28 + root.depth * .28;
      rootContext.strokeStyle = bark;
      rootContext.lineWidth = root.thickness * pulse;
      rootContext.shadowColor = 'rgba(212, 174, 88, .28)';
      rootContext.shadowBlur = 5 + root.depth * 8;
      rootContext.stroke();

      traceRoot(root.points, visiblePoints, -root.thickness * .18);
      rootContext.globalAlpha = .2 + root.depth * .2;
      rootContext.strokeStyle = 'rgba(245, 214, 145, .7)';
      rootContext.lineWidth = Math.max(.45, root.thickness * .2);
      rootContext.shadowBlur = 0;
      rootContext.stroke();
      rootContext.restore();
    }
  }

  function cutContentWindows() {
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';

    for (const windowRect of contentWindows) {
      const top = windowRect.top - window.scrollY;
      const left = windowRect.left - window.scrollX;
      if (top > height + 20 || top + windowRect.height < -20) continue;
      const padding = windowRect.padding;
      context.beginPath();
      const x = left - padding;
      const y = top - padding;
      const rectWidth = windowRect.width + padding * 2;
      const rectHeight = windowRect.height + padding * 2;
      if (typeof context.roundRect === 'function') context.roundRect(x, y, rectWidth, rectHeight, Math.min(8, padding * 2));
      else context.rect(x, y, rectWidth, rectHeight);
      context.fill();
    }

    context.restore();
  }

  function wake() {
    if (!frame && !document.hidden && !destroyed && !suspended) {
      frame = requestAnimationFrame(render);
    }
  }

  function render(now) {
    frame = 0;
    const minimumFrameTime = width < 700 || coarsePointer.matches ? 1000 / 30 : 1000 / 45;
    if (now - lastPaintAt < minimumFrameTime) {
      frame = requestAnimationFrame(render);
      return;
    }
    lastPaintAt = now;
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
      const parallax = .68 + leaf.depth * .5;
      leaf.y += leaf.vy * parallax * elapsed;
      leaf.x += (leaf.vx + Math.sin(now * .0018 * leaf.wobble + leaf.wobbleOffset) * (12 + leaf.depth * 12)) * elapsed;
      leaf.angle += leaf.spin * elapsed;
      leaf.tumble += leaf.tumbleSpeed * elapsed;

      if (leaf.y > height + leaf.size * 4 || leaf.x < -70 || leaf.x > width + 70) {
        leaves.splice(index, 1);
      }
    }

    // Back plane -> content matte -> sparse front plane creates real occlusion.
    const growth = Math.round(rootGrowth() * 160) / 160;
    if (growth !== rootCacheProgress) {
      rootContext.clearRect(0, 0, width, height);
      drawRoots(growth);
      rootCacheProgress = growth;
    }
    context.drawImage(rootCanvas, 0, 0, width, height);
    for (const leaf of leaves) if (!leaf.foreground) drawLeaf(leaf, now);
    cutContentWindows();
    for (const leaf of leaves) if (leaf.foreground) drawLeaf(leaf, now);

    if (leaves.length || scrollEnergy > .025 || spawnRemainder >= 1) wake();
  }

  function onScroll() {
    const now = performance.now();
    const distance = Math.abs(window.scrollY - lastScrollY);
    const elapsed = Math.max(16, now - lastScrollAt);
    const velocity = distance / elapsed;
    lastScrollY = window.scrollY;
    lastScrollAt = now;

    if (now - lastSceneRefreshAt > 1200) {
      documentHeight = Math.max(height, document.documentElement.scrollHeight, document.body.scrollHeight);
      lastSceneRefreshAt = now;
    }
    if (heroSuppressed || distance < 1) return;
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
    wake();
  }

  function onPageHide(event) {
    if (!event.persisted) {
      destroy();
      return;
    }
    suspended = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    window.clearTimeout(contentRefreshTimer);
    frame = 0;
    resizeFrame = 0;
    contentRefreshTimer = 0;
  }

  function onPageShow(event) {
    if (!event.persisted || destroyed) return;
    suspended = false;
    scheduleResize();
  }

  function onConnectionChange() {
    if (connection?.saveData) destroy();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    window.clearTimeout(contentRefreshTimer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('load', scheduleResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    motionPreference.removeEventListener?.('change', onMotionChange);
    forcedColors.removeEventListener?.('change', onMotionChange);
    connection?.removeEventListener?.('change', onConnectionChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    heroObserver?.disconnect();
    contentObserver?.disconnect();
    canvas.remove();
    rootCanvas.width = 1;
    rootCanvas.height = 1;
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
      } else {
        cacheContentWindows();
        wake();
      }
    }, { threshold: [0, .55, 1] });
    heroObserver.observe(homepageHero);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleResize, { passive: true });
  window.addEventListener('load', scheduleResize, { once: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  motionPreference.addEventListener?.('change', onMotionChange);
  forcedColors.addEventListener?.('change', onMotionChange);
  connection?.addEventListener?.('change', onConnectionChange);
  if ('MutationObserver' in window) {
    contentObserver = new MutationObserver(scheduleContentRefresh);
    contentObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'aria-hidden'],
    });
  }
  document.fonts?.ready.then(scheduleContentRefresh).catch(() => {});
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
})();
