'use strict';

/*
 * BLVCK OAK liquid field.
 *
 * The supplied liquid-sculpture reference is React/WebGL-first. The public
 * site is framework-free, so this layer keeps the same interaction model in
 * the existing cinematic: image-sampled particles, pointer turbulence,
 * elastic return and a scroll-controlled material state.
 */
(() => {
  const intro = document.querySelector('[data-oak-origin]');
  const stage = document.querySelector('[data-oak-stage]');
  const canvas = document.querySelector('[data-oak-liquid]');
  const poster = document.querySelector('.oak-origin-poster');
  if (!intro || !stage || !(canvas instanceof HTMLCanvasElement) || !(poster instanceof HTMLImageElement)) return;

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!context) {
    intro.classList.add('is-liquid-fallback');
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const TAU = Math.PI * 2;
  const palette = ['#d4ae58', '#f1d48c', '#9a6332'];
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const smoothstep = (start, end, value) => {
    const amount = clamp((value - start) / Math.max(0.00001, end - start));
    return amount * amount * (3 - 2 * amount);
  };

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  const random = seededRandom(0xB10C0A4);
  const pointer = {
    x: -10000,
    y: -10000,
    targetX: -10000,
    targetY: -10000,
    previousX: -10000,
    previousY: -10000,
    velocityX: 0,
    velocityY: 0,
    presence: 0,
    targetPresence: 0,
    burst: 0,
  };

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let sourceAspect = 720 / 1280;
  let samples = [];
  let particles = [];
  let progress = 0;
  let targetProgress = 0;
  let previousProgress = 0;
  let scrollVelocity = 0;
  let visible = true;
  let motionPaused = false;
  let frame = 0;
  let resizeFrame = 0;
  let lastFrame = performance.now();
  let startTime = lastFrame;
  let destroyed = false;

  function readProgress() {
    const value = Number.parseFloat(getComputedStyle(intro).getPropertyValue('--oak-progress'));
    return Number.isFinite(value) ? clamp(value) : 0;
  }

  function currentMotionPreference() {
    if (reducedMotion.matches || document.hidden || document.body.dataset.motionPaused === 'true') return true;
    try { return sessionStorage.getItem('blvckoak-motion-paused') === 'true'; }
    catch { return false; }
  }

  function containedRect() {
    const viewportAspect = width / height;
    if (viewportAspect > sourceAspect) {
      const rectWidth = height * sourceAspect;
      return { x: (width - rectWidth) / 2, y: 0, width: rectWidth, height };
    }
    const rectHeight = width / sourceAspect;
    return { x: 0, y: (height - rectHeight) / 2, width, height: rectHeight };
  }

  function proceduralSamples(count) {
    const points = [];
    for (let index = 0; index < count; index += 1) {
      const canopy = random() > 0.28;
      let x;
      let y;
      if (canopy) {
        const angle = random() * TAU;
        const radius = Math.sqrt(random());
        x = 0.5 + Math.cos(angle) * radius * (0.24 + random() * 0.08);
        y = 0.37 + Math.sin(angle) * radius * (0.2 + random() * 0.05);
      } else {
        y = 0.38 + random() * 0.49;
        x = 0.5 + (random() - 0.5) * (0.025 + (y - 0.38) * 0.13);
      }
      points.push({ x, y, light: 0.35 + random() * 0.65, tone: index % palette.length });
    }
    return points;
  }

  function samplePoster() {
    sourceAspect = poster.naturalWidth / Math.max(1, poster.naturalHeight) || sourceAspect;
    const sampleWidth = width < 700 ? 116 : 178;
    const sampleHeight = Math.max(1, Math.round(sampleWidth / sourceAspect));
    const source = document.createElement('canvas');
    source.width = sampleWidth;
    source.height = sampleHeight;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) return proceduralSamples(width < 700 ? 720 : 1700);

    try {
      sourceContext.drawImage(poster, 0, 0, sampleWidth, sampleHeight);
      const pixels = sourceContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const candidates = [];
      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const offset = (y * sampleWidth + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3] / 255;
          const light = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
          const warm = Math.max(0, (red - blue) / 255);
          if (alpha < 0.2 || light < 0.075 || random() > clamp(0.28 + light * 1.05 + warm * 0.35)) continue;
          const tone = light > 0.58 ? 1 : warm > 0.08 ? 0 : 2;
          candidates.push({
            x: (x + random() * 0.72) / sampleWidth,
            y: (y + random() * 0.72) / sampleHeight,
            light,
            tone,
          });
        }
      }

      const targetCount = width < 700 ? 760 : width < 1100 ? 1280 : 1900;
      for (let index = candidates.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
      }
      if (candidates.length < Math.min(420, targetCount / 2)) return proceduralSamples(targetCount);
      return candidates.slice(0, targetCount);
    } catch {
      intro.classList.add('is-liquid-fallback');
      return proceduralSamples(width < 700 ? 720 : 1700);
    }
  }

  function particleTarget(particle, time) {
    const rect = containedRect();
    const centerX = rect.x + rect.width * 0.5;
    const centerY = rect.y + rect.height * 0.5;
    const localX = (particle.sampleX - 0.5) * rect.width;
    const localY = (particle.sampleY - 0.5) * rect.height;
    const bloomIn = smoothstep(0.13, 0.43, progress);
    const bloomOut = 1 - smoothstep(0.7, 0.91, progress);
    const bloom = bloomIn * bloomOut;
    const reform = smoothstep(0.68, 0.9, progress);
    const angle = Math.sin(progress * Math.PI * 1.15) * bloom * (0.07 + particle.depth * 0.17);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const scale = 1 + bloom * (0.035 + particle.depth * 0.13) - reform * 0.025;
    const wave = Math.sin(particle.sampleY * 24 + time * 0.00048 + particle.phase)
      + Math.cos(particle.sampleX * 19 - time * 0.00034 + particle.phase * 0.7);
    const turbulence = bloom * (5 + particle.depth * 17);
    const exit = smoothstep(0.9, 1, progress);
    const rotatedX = (localX * cosine - localY * sine) * scale;
    const rotatedY = (localX * sine + localY * cosine) * scale;
    return {
      x: centerX + rotatedX + wave * turbulence + (particle.depth - 0.5) * exit * width * 0.11,
      y: centerY + rotatedY - bloom * height * (0.012 + particle.depth * 0.035) - exit * height * (0.06 + particle.depth * 0.08),
      bloom,
      exit,
    };
  }

  function buildParticles() {
    if (!samples.length) samples = samplePoster();
    const rect = containedRect();
    particles = samples.map((sample, index) => {
      const homeX = rect.x + sample.x * rect.width;
      const homeY = rect.y + sample.y * rect.height;
      const scatter = reducedMotion.matches ? 0 : 18 + random() * Math.min(width, height) * 0.13;
      const angle = random() * TAU;
      return {
        sampleX: sample.x,
        sampleY: sample.y,
        light: sample.light,
        tone: sample.tone,
        depth: random(),
        phase: random() * TAU,
        size: 1.05 + sample.light * 1.8 + random() * 1.05,
        x: homeX + Math.cos(angle) * scatter,
        y: homeY + Math.sin(angle) * scatter,
        previousX: homeX,
        previousY: homeY,
        velocityX: 0,
        velocityY: 0,
        index,
      };
    }).sort((a, b) => a.tone - b.tone);
    startTime = performance.now();
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, width < 700 ? 1.15 : 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    samples = samplePoster();
    buildParticles();
    if (motionPaused || reducedMotion.matches) drawStatic();
    else schedule();
  }

  function scheduleResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }

  function updatePointer(delta) {
    const blend = 1 - Math.pow(0.74, delta);
    const nextX = pointer.x + (pointer.targetX - pointer.x) * blend;
    const nextY = pointer.y + (pointer.targetY - pointer.y) * blend;
    pointer.velocityX = (nextX - pointer.previousX) / Math.max(0.5, delta);
    pointer.velocityY = (nextY - pointer.previousY) / Math.max(0.5, delta);
    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;
    pointer.x = nextX;
    pointer.y = nextY;
    pointer.presence += (pointer.targetPresence - pointer.presence) * (1 - Math.pow(0.8, delta));
    pointer.burst *= Math.pow(0.9, delta);
  }

  function updateParticle(particle, time, delta) {
    const target = particleTarget(particle, time);
    const introAmount = 1 - smoothstep(0, 1700, time - startTime);
    const spring = (0.022 + (1 - target.bloom) * 0.02) * delta;
    particle.previousX = particle.x;
    particle.previousY = particle.y;
    particle.velocityX += (target.x - particle.x) * spring;
    particle.velocityY += (target.y - particle.y) * spring;

    if (target.bloom > 0.01) {
      const field = Math.sin(particle.sampleY * 31 + time * 0.0011 + particle.phase);
      particle.velocityX += field * target.bloom * (0.012 + particle.depth * 0.025) * delta;
      particle.velocityY += Math.cos(particle.sampleX * 27 - time * 0.0009 + particle.phase) * target.bloom * 0.018 * delta;
    }

    if (pointer.presence > 0.005) {
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;
      const radius = Math.min(width, height) * (coarsePointer.matches ? 0.24 : 0.17);
      if (distanceSquared < radius * radius) {
        const distance = Math.sqrt(distanceSquared) + 0.001;
        const falloff = (1 - distance / radius) ** 2 * pointer.presence;
        const speed = Math.min(15, Math.hypot(pointer.velocityX, pointer.velocityY));
        const force = falloff * (0.5 + speed * 0.14 + pointer.burst * 1.8) * delta;
        particle.velocityX += (dx / distance * 1.7 - dy / distance * 0.9) * force;
        particle.velocityY += (dy / distance * 1.7 + dx / distance * 0.9) * force;
        particle.velocityX += pointer.velocityX * falloff * 0.11;
        particle.velocityY += pointer.velocityY * falloff * 0.11;
      }
    }

    const scrollKick = clamp(Math.abs(scrollVelocity) * 34, 0, 1.8);
    particle.velocityX += Math.sin(particle.phase + progress * TAU) * scrollKick * particle.depth * 0.03 * delta;
    particle.velocityY -= scrollVelocity * height * (0.022 + particle.depth * 0.03) * delta;
    const damping = Math.pow(0.875 + target.bloom * 0.035, delta);
    particle.velocityX *= damping;
    particle.velocityY *= damping;
    particle.x += particle.velocityX * delta;
    particle.y += particle.velocityY * delta;

    if (introAmount > 0.001) {
      particle.x += Math.sin(particle.phase + time * 0.001) * introAmount * particle.depth * 0.18;
      particle.y -= introAmount * particle.depth * 0.12;
    }
  }

  function drawPointerGlow(alpha) {
    if (pointer.presence < 0.01 || pointer.x < -1000) return;
    const radius = Math.min(width, height) * (coarsePointer.matches ? 0.23 : 0.16);
    const gradient = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
    gradient.addColorStop(0, `rgba(241,212,140,${0.14 * pointer.presence * alpha})`);
    gradient.addColorStop(0.35, `rgba(212,174,88,${0.065 * pointer.presence * alpha})`);
    gradient.addColorStop(1, 'rgba(212,174,88,0)');
    context.fillStyle = gradient;
    context.fillRect(pointer.x - radius, pointer.y - radius, radius * 2, radius * 2);
  }

  function drawParticles(time, staticFrame = false) {
    context.clearRect(0, 0, width, height);
    if (!particles.length) return;
    const bloom = smoothstep(0.13, 0.43, progress) * (1 - smoothstep(0.7, 0.91, progress));
    const exit = smoothstep(0.92, 1, progress);
    const alpha = (0.46 + bloom * 0.34) * (1 - exit * 0.84);
    context.save();
    context.globalCompositeOperation = 'lighter';
    drawPointerGlow(alpha);

    if (!staticFrame) {
      context.lineWidth = 0.72;
      for (let tone = 0; tone < palette.length; tone += 1) {
        context.beginPath();
        let strokes = 0;
        for (const particle of particles) {
          if (particle.tone !== tone) continue;
          const speed = Math.hypot(particle.velocityX, particle.velocityY);
          if (speed < 1.1) continue;
          const length = Math.min(7, speed * 0.9);
          context.moveTo(particle.x, particle.y);
          context.lineTo(
            particle.x - particle.velocityX / Math.max(speed, 0.001) * length,
            particle.y - particle.velocityY / Math.max(speed, 0.001) * length,
          );
          strokes += 1;
        }
        if (strokes) {
          context.globalAlpha = alpha * 0.38;
          context.strokeStyle = palette[tone];
          context.stroke();
        }
      }
    }

    for (let tone = 0; tone < palette.length; tone += 1) {
      context.fillStyle = palette[tone];
      context.shadowColor = palette[tone];
      context.shadowBlur = tone === 1 ? 4 : 2.5;
      context.globalAlpha = alpha * (tone === 1 ? 0.92 : tone === 0 ? 0.72 : 0.44);
      for (const particle of particles) {
        if (particle.tone !== tone) continue;
        const shimmer = staticFrame ? 1 : 0.78 + Math.sin(time * 0.002 + particle.phase) * 0.22;
        const size = Math.max(0.55, particle.size * shimmer * (0.78 + bloom * 0.28));
        context.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
      }
    }
    context.restore();
  }

  function drawStatic() {
    if (!particles.length) return;
    progress = readProgress();
    const now = performance.now();
    for (const particle of particles) {
      const target = particleTarget(particle, now);
      particle.x = target.x;
      particle.y = target.y;
      particle.previousX = target.x;
      particle.previousY = target.y;
      particle.velocityX = 0;
      particle.velocityY = 0;
    }
    drawParticles(now, true);
  }

  function animate(now) {
    frame = 0;
    if (destroyed || motionPaused || reducedMotion.matches || document.hidden || !visible) return;
    const delta = clamp((now - lastFrame) / (1000 / 60), 0.35, 1.8);
    lastFrame = now;
    progress += (targetProgress - progress) * (1 - Math.pow(0.73, delta));
    const progressDelta = progress - previousProgress;
    scrollVelocity = scrollVelocity * Math.pow(0.78, delta) + progressDelta * 0.22;
    previousProgress = progress;
    updatePointer(delta);
    for (const particle of particles) updateParticle(particle, now, delta);
    drawParticles(now);
    schedule();
  }

  function schedule() {
    if (frame || destroyed || motionPaused || reducedMotion.matches || document.hidden || !visible || !particles.length) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  }

  function localPointer(event) {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerMove(event) {
    if (motionPaused || reducedMotion.matches) return;
    if (event.pointerType === 'touch' && event.pressure === 0 && event.buttons === 0) return;
    const point = localPointer(event);
    pointer.targetX = point.x;
    pointer.targetY = point.y;
    if (pointer.x < -1000) {
      pointer.x = point.x;
      pointer.y = point.y;
      pointer.previousX = point.x;
      pointer.previousY = point.y;
    }
    pointer.targetPresence = 1;
    intro.classList.add('has-liquid-input');
    schedule();
  }

  function onPointerDown(event) {
    onPointerMove(event);
    pointer.burst = 1;
    pointer.targetPresence = 1.25;
  }

  function onPointerUp(event) {
    if (event.pointerType === 'touch') pointer.targetPresence = 0;
    else pointer.targetPresence = 0.82;
  }

  function onPointerLeave() {
    pointer.targetPresence = 0;
  }

  function syncMotion(event) {
    motionPaused = Boolean(event?.detail?.paused ?? currentMotionPreference());
    cancelAnimationFrame(frame);
    frame = 0;
    if (motionPaused || reducedMotion.matches) drawStatic();
    else schedule();
  }

  function onProgress(event) {
    targetProgress = clamp(Number(event.detail?.progress) || 0);
    if (motionPaused || reducedMotion.matches) drawStatic();
    else schedule();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      targetProgress = readProgress();
      if (motionPaused || reducedMotion.matches) drawStatic();
      else schedule();
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }, { threshold: 0 });

  const resizeObserver = new ResizeObserver(scheduleResize);
  observer.observe(intro);
  resizeObserver.observe(stage);
  stage.addEventListener('pointermove', onPointerMove, { passive: true });
  stage.addEventListener('pointerdown', onPointerDown, { passive: true });
  stage.addEventListener('pointerup', onPointerUp, { passive: true });
  stage.addEventListener('pointercancel', onPointerUp, { passive: true });
  stage.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('blvckoak:origin-progress', onProgress);
  window.addEventListener('blvckoak:motion-change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener?.('change', syncMotion);

  const prepare = () => {
    targetProgress = readProgress();
    progress = targetProgress;
    previousProgress = progress;
    motionPaused = currentMotionPreference();
    resize();
  };
  if (poster.complete && poster.naturalWidth) prepare();
  else poster.addEventListener('load', prepare, { once: true });

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    observer.disconnect();
    resizeObserver.disconnect();
  });
})();
