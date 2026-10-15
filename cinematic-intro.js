'use strict';

/*
 * BLVCK OAK first-viewport cinematic.
 *
 * The oak is decorative and lives inside the real homepage hero. It never
 * captures scroll or delays access to navigation, copy, or conversion links.
 * The generated oak film is progressively enhanced with a lightweight
 * leaf-and-fire canvas. Mobile, reduced-motion, and data-saving visitors get
 * a dedicated poster instead of paying the video download cost.
 */
(() => {
  const scene = document.querySelector('[data-cinematic-oak]');
  const canvas = scene?.querySelector('[data-cinematic-particles]');
  const video = scene?.querySelector('[data-cinematic-video]');
  const videoSource = video?.querySelector('[data-cinematic-src]');
  const hero = scene?.closest('.hero');
  if (!scene || !(canvas instanceof HTMLCanvasElement) || !hero) return;

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const wideViewport = window.matchMedia('(min-width: 901px)');
  const saveData = Boolean(navigator.connection?.saveData);
  const TAU = Math.PI * 2;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let frameId = 0;
  let previousFrame = 0;
  let visible = true;
  let videoReady = false;
  let videoRequested = false;
  let leaves = [];
  let sparks = [];

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

  function makeParticles() {
    const random = seededRandom(0xB10C0A);
    const compact = width < 720 || coarsePointer.matches;
    const leafCount = compact ? 20 : 42;
    const sparkCount = compact ? 28 : 58;

    leaves = Array.from({ length: leafCount }, (_, index) => ({
      x: .48 + random() * .55,
      start: random() * 1.2,
      speed: .018 + random() * .026,
      size: (compact ? 4.5 : 6) + random() * (compact ? 6 : 9),
      drift: .018 + random() * .055,
      phase: random() * TAU,
      spin: (random() - .5) * 1.8,
      warm: index % 4 === 0,
    }));

    sparks = Array.from({ length: sparkCount }, (_, index) => ({
      x: .55 + random() * .43,
      start: random(),
      speed: .026 + random() * .06,
      length: 5 + random() * 18,
      size: .45 + random() * 1.55,
      drift: .008 + random() * .035,
      phase: random() * TAU,
      bright: index % 5 === 0,
    }));
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    pixelRatio = Math.min(window.devicePixelRatio || 1, width < 720 ? 1.15 : 1.55);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    makeParticles();
    if (reducedMotion.matches || saveData) draw(3.8, true);
    requestVideo();
  }

  function canUseVideo() {
    return wideViewport.matches && !coarsePointer.matches && !reducedMotion.matches && !saveData;
  }

  function requestVideo() {
    if (
      videoRequested
      || !canUseVideo()
      || !(video instanceof HTMLVideoElement)
      || !(videoSource instanceof HTMLSourceElement)
    ) return;
    const sourceUrl = videoSource.dataset.cinematicSrc;
    if (!sourceUrl) return;
    videoSource.src = sourceUrl;
    videoRequested = true;
    video.load();
  }

  function drawLeaf(leaf, time) {
    const travel = (leaf.start + time * leaf.speed) % 1.2;
    const progress = travel / 1.2;
    const x = leaf.x * width
      + Math.sin(time * .55 + leaf.phase) * width * leaf.drift
      + Math.sin(time * .19 + leaf.phase * 1.7) * 8;
    const y = -height * .14 + travel * height * 1.2;
    const opacity = Math.sin(clamp(progress) * Math.PI) * (leaf.warm ? .5 : .31);
    const rotation = leaf.phase + time * leaf.spin + Math.sin(time + leaf.phase) * .45;

    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(1, .55 + Math.abs(Math.sin(time * 1.3 + leaf.phase)) * .5);
    context.beginPath();
    context.moveTo(0, -leaf.size);
    context.bezierCurveTo(leaf.size * .9, -leaf.size * .3, leaf.size * .8, leaf.size * .6, 0, leaf.size);
    context.bezierCurveTo(-leaf.size * .8, leaf.size * .6, -leaf.size * .9, -leaf.size * .3, 0, -leaf.size);
    context.fillStyle = leaf.warm
      ? `rgba(241, 212, 140, ${opacity})`
      : `rgba(150, 123, 63, ${opacity})`;
    context.fill();
    context.beginPath();
    context.moveTo(0, -leaf.size * .75);
    context.lineTo(0, leaf.size * .8);
    context.strokeStyle = `rgba(241, 212, 140, ${opacity * .52})`;
    context.lineWidth = .65;
    context.stroke();
    context.restore();
  }

  function drawSpark(spark, time) {
    const travel = (spark.start + time * spark.speed) % 1;
    const x = spark.x * width + Math.sin(time * 1.4 + spark.phase) * width * spark.drift;
    const y = -24 + travel * (height + 48);
    const pulse = .3 + Math.abs(Math.sin(time * 2.2 + spark.phase)) * .7;
    const fade = Math.sin(travel * Math.PI);
    const alpha = fade * pulse * (spark.bright ? .78 : .42);

    context.save();
    context.shadowColor = spark.bright ? 'rgba(241, 212, 140, .9)' : 'rgba(212, 174, 88, .7)';
    context.shadowBlur = spark.bright ? 12 : 7;
    context.beginPath();
    context.moveTo(x, y - spark.length);
    context.quadraticCurveTo(x + Math.sin(time + spark.phase) * 5, y - spark.length * .45, x, y);
    context.strokeStyle = `rgba(${spark.bright ? '241, 212, 140' : '212, 174, 88'}, ${alpha})`;
    context.lineWidth = spark.size;
    context.lineCap = 'round';
    context.stroke();
    context.restore();
  }

  function draw(time, still = false) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const sweep = still ? height * .57 : ((time * .052) % 1.24 - .12) * height;
    const heat = context.createLinearGradient(0, sweep - height * .16, 0, sweep + height * .16);
    heat.addColorStop(0, 'rgba(212, 174, 88, 0)');
    heat.addColorStop(.43, 'rgba(212, 174, 88, .025)');
    heat.addColorStop(.5, 'rgba(241, 212, 140, .1)');
    heat.addColorStop(.57, 'rgba(212, 174, 88, .035)');
    heat.addColorStop(1, 'rgba(212, 174, 88, 0)');
    context.fillStyle = heat;
    context.fillRect(width * .42, sweep - height * .16, width * .58, height * .32);

    leaves.forEach((leaf) => drawLeaf(leaf, still ? 3.8 : time));
    sparks.forEach((spark) => drawSpark(spark, still ? 3.8 : time));
  }

  function animate(now) {
    frameId = window.requestAnimationFrame(animate);
    if (!visible || document.hidden || reducedMotion.matches || saveData) return;
    const minimumFrameTime = coarsePointer.matches ? 1000 / 30 : 1000 / 60;
    if (now - previousFrame < minimumFrameTime) return;
    previousFrame = now;
    draw(now / 1000);
  }

  function stopAnimation() {
    window.cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function startAnimation() {
    if (frameId || reducedMotion.matches || saveData) return;
    frameId = window.requestAnimationFrame(animate);
  }

  function setVideoPlayback() {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!visible || !canUseVideo() || !videoReady) {
      video.pause();
      return;
    }
    video.play().catch(() => scene.classList.add('is-video-fallback'));
  }

  function markVideoReady() {
    if (!(video instanceof HTMLVideoElement)) return;
    videoReady = true;
    scene.classList.remove('is-video-fallback');
    scene.classList.add('is-video-ready');
    setVideoPlayback();
  }

  function handleMotionPreference() {
    scene.classList.toggle('is-reduced-motion', reducedMotion.matches);
    requestVideo();
    if (reducedMotion.matches || saveData) {
      stopAnimation();
      video?.pause();
      draw(3.8, true);
    } else {
      startAnimation();
      setVideoPlayback();
    }
  }

  if (video instanceof HTMLVideoElement) {
    video.addEventListener('canplay', markVideoReady, { once: true });
    video.addEventListener('loadeddata', markVideoReady, { once: true });
    video.addEventListener('error', () => {
      videoReady = false;
      scene.classList.remove('is-video-ready');
      scene.classList.add('is-video-fallback');
    }, { once: true });
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markVideoReady();
  } else {
    scene.classList.add('is-video-fallback');
  }

  const visibilityObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) startAnimation();
        setVideoPlayback();
      }, { threshold: 0 })
    : null;
  visibilityObserver?.observe(hero);

  if (!coarsePointer.matches && !reducedMotion.matches) {
    hero.addEventListener('pointermove', (event) => {
      const rect = hero.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1) - .5;
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1) - .5;
      scene.style.setProperty('--cinema-x', x.toFixed(3));
      scene.style.setProperty('--cinema-y', y.toFixed(3));
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      scene.style.setProperty('--cinema-x', '0');
      scene.style.setProperty('--cinema-y', '0');
    });
  }

  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(hero);
  if (!resizeObserver) window.addEventListener('resize', resize, { passive: true });
  reducedMotion.addEventListener?.('change', handleMotionPreference);
  coarsePointer.addEventListener?.('change', handleMotionPreference);
  wideViewport.addEventListener?.('change', handleMotionPreference);
  resize();
  handleMotionPreference();

  window.addEventListener('pagehide', () => {
    stopAnimation();
    video?.pause();
    visibilityObserver?.disconnect();
    resizeObserver?.disconnect();
    reducedMotion.removeEventListener?.('change', handleMotionPreference);
    coarsePointer.removeEventListener?.('change', handleMotionPreference);
    wideViewport.removeEventListener?.('change', handleMotionPreference);
  }, { once: true });
})();
