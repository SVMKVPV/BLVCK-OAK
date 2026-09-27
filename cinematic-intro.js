'use strict';

(() => {
  const intro = document.querySelector('[data-oak-origin]');
  const stage = document.querySelector('[data-oak-stage]');
  const canvas = document.querySelector('[data-oak-canvas]');
  const skipButton = document.querySelector('[data-oak-skip]');
  const chapters = [...document.querySelectorAll('[data-oak-chapter]')];
  const officialSite = document.querySelector('main');
  if (!intro || !stage || !(canvas instanceof HTMLCanvasElement) || !officialSite) return;

  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const TAU = Math.PI * 2;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const mix = (start, end, amount) => start + (end - start) * amount;
  const smoothstep = (start, end, value) => {
    const progress = clamp((value - start) / (end - start));
    return progress * progress * (3 - 2 * progress);
  };
  const easeOut = (value) => 1 - (1 - value) ** 3;
  const easeIn = (value) => value ** 3;

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

  function buildTree(seed, levels = 5) {
    const random = seededRandom(seed);
    const segments = [];
    const tips = [];

    function grow(x, y, length, angle, width, depth, generation) {
      const bend = (random() - 0.5) * 0.08;
      const x2 = x + Math.cos(angle + bend) * length;
      const y2 = y + Math.sin(angle + bend) * length;
      segments.push({ x, y, x2, y2, width, generation, reveal: generation / (levels + 1) });
      if (depth === 0) {
        tips.push({ x: x2, y: y2, phase: random() * TAU, size: 0.72 + random() * 0.5 });
        return;
      }
      const spread = 0.28 + random() * 0.16 + generation * 0.008;
      const nextLength = length * (0.72 + random() * 0.1);
      grow(x2, y2, nextLength, angle - spread, width * 0.7, depth - 1, generation + 1);
      grow(x2, y2, nextLength * (0.92 + random() * 0.13), angle + spread, width * 0.68, depth - 1, generation + 1);
      if (depth > 2 && random() > 0.6) {
        grow(x2, y2, nextLength * 0.74, angle + (random() - 0.5) * 0.24, width * 0.54, depth - 2, generation + 1);
      }
    }

    grow(0, 0, 1, -Math.PI / 2, 0.15, levels, 0);
    return { segments, tips };
  }

  const oldTree = buildTree(1313, 5);
  const youngTree = buildTree(3131, 5);
  const websiteNames = ['ELECTRIC', 'CAFÉ', 'HEALTH', 'ECOMMERCE', 'LANDSCAPE', 'AUTO', 'SOCIAL', 'CLEANING'];
  const websitePalettes = [
    ['#f1d48c', '#34332c', '#9f7a31'],
    ['#ead8bd', '#56301e', '#d29b62'],
    ['#dbeee7', '#163b3b', '#63a68f'],
    ['#efd8ec', '#3d183e', '#c064b6'],
    ['#d8e8c8', '#26341d', '#7ea158'],
    ['#d4d7dc', '#20252d', '#727f91'],
    ['#e6ddff', '#2d2047', '#9676d7'],
    ['#d9eef1', '#17363b', '#6daab2'],
  ];
  const leafRandom = seededRandom(8088);
  const leaves = oldTree.tips.slice(0, 24).map((tip, index) => ({
    ...tip,
    index,
    website: websiteNames[index % websiteNames.length],
    palette: websitePalettes[index % websitePalettes.length],
    z: leafRandom() * 1.4 - 0.7,
    rotation: leafRandom() * TAU,
    direction: leafRandom() > 0.5 ? 1 : -1,
    fallStart: 0.17 + (index % 9) * 0.011 + Math.floor(index / 9) * 0.018,
    burnStart: 0.39 + (index % 6) * 0.026 + Math.floor(index / 6) * 0.012,
    drift: (leafRandom() - 0.5) * 0.34,
    ash: Array.from({ length: 9 }, () => ({
      x: leafRandom() * 2 - 1,
      y: leafRandom(),
      speed: 0.55 + leafRandom() * 1.15,
      phase: leafRandom() * TAU,
      size: 0.55 + leafRandom() * 1.7,
    })),
  }));
  const atmosphereRandom = seededRandom(4242);
  const atmosphere = Array.from({ length: 92 }, () => ({
    x: atmosphereRandom(),
    y: atmosphereRandom(),
    depth: 0.15 + atmosphereRandom() * 0.85,
    phase: atmosphereRandom() * TAU,
    warm: atmosphereRandom() > 0.72,
  }));
  const groundAsh = Array.from({ length: 110 }, (_, index) => ({
    angle: atmosphereRandom() * TAU,
    radius: atmosphereRandom(),
    phase: atmosphereRandom() * TAU,
    lift: atmosphereRandom(),
    size: 0.4 + atmosphereRandom() * 1.4,
    index,
  }));

  let width = 1;
  let height = 1;
  let deviceScale = 1;
  let progress = 0;
  let activeChapter = -1;
  let introVisible = true;
  let frameId = 0;
  let lastFrame = 0;
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    deviceScale = Math.min(window.devicePixelRatio || 1, coarsePointer.matches ? 1.35 : 1.7);
    canvas.width = Math.round(width * deviceScale);
    canvas.height = Math.round(height * deviceScale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    draw(performance.now());
  }

  function setChapter(index) {
    if (index === activeChapter) return;
    activeChapter = index;
    chapters.forEach((chapter, chapterIndex) => {
      const selected = chapterIndex === index;
      chapter.classList.toggle('is-active', selected);
      chapter.setAttribute('aria-hidden', String(!selected));
    });
  }

  function updateProgress() {
    const rect = intro.getBoundingClientRect();
    const travel = Math.max(1, intro.offsetHeight - window.innerHeight);
    progress = reducedMotion.matches ? 0.9 : clamp(-rect.top / travel);
    const chapter = progress < 0.155 ? 0
      : progress < 0.345 ? 1
        : progress < 0.615 ? 2
          : progress < 0.84 ? 3
            : 4;
    setChapter(chapter);
    intro.style.setProperty('--oak-progress', progress.toFixed(4));
    intro.style.setProperty('--oak-exit', smoothstep(0.955, 1, progress).toFixed(4));
    intro.classList.toggle('has-progress', progress > 0.025);
    const introIsActive = rect.bottom > window.innerHeight * 0.42 && rect.top < window.innerHeight * 0.55;
    document.body.classList.toggle('oak-intro-active', introIsActive);
  }

  function drawBackground(time) {
    const horizon = height * 0.82;
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#020303');
    background.addColorStop(0.56, '#080909');
    background.addColorStop(1, '#030404');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const fireLevel = smoothstep(0.34, 0.57, progress) * (1 - smoothstep(0.69, 0.79, progress));
    const growthLevel = smoothstep(0.62, 0.9, progress);
    const glowX = width * (0.54 + pointer.x * 0.012);
    const glowY = mix(horizon, height * 0.68, growthLevel);
    const glow = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, width * 0.5);
    glow.addColorStop(0, `rgba(202, ${Math.round(mix(111, 166, growthLevel))}, ${Math.round(mix(35, 80, growthLevel))}, ${0.055 + fireLevel * 0.11 + growthLevel * 0.045})`);
    glow.addColorStop(0.4, `rgba(104,63,24,${0.025 + fireLevel * 0.045})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.save();
    atmosphere.forEach((particle) => {
      const drift = ((particle.y + time * 0.000005 * particle.depth) % 1) * height;
      const x = particle.x * width + Math.sin(time * 0.00017 + particle.phase) * 16 * particle.depth + pointer.x * 19 * particle.depth;
      const alpha = (0.04 + particle.depth * 0.12) * (particle.warm ? 1 + fireLevel * 1.6 : 1);
      context.beginPath();
      context.arc(x, drift, 0.45 + particle.depth * 1.05, 0, TAU);
      context.fillStyle = particle.warm ? `rgba(226,151,62,${alpha})` : `rgba(228,221,203,${alpha * 0.6})`;
      context.fill();
    });
    context.restore();

    context.fillStyle = 'rgba(3,4,4,.62)';
    context.beginPath();
    context.ellipse(width * 0.5, horizon + height * 0.1, width * 0.55, height * 0.17, 0, 0, TAU);
    context.fill();
  }

  function drawTree(tree, centerX, groundY, scale, alpha, growth, isYoung = false) {
    if (alpha <= 0.002 || growth <= 0.002) return;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    tree.segments.forEach((segment, index) => {
      const revealLength = 0.17 + segment.generation * 0.014;
      const localGrowth = clamp((growth - segment.reveal * 0.7) / revealLength);
      if (localGrowth <= 0) return;
      const amount = easeOut(localGrowth);
      const startX = centerX + segment.x * scale;
      const startY = groundY + segment.y * scale;
      const endX = centerX + mix(segment.x, segment.x2, amount) * scale;
      const endY = groundY + mix(segment.y, segment.y2, amount) * scale;
      const widthScale = Math.max(0.55, segment.width * scale * mix(0.62, 1, amount));
      const shimmer = 0.78 + Math.sin(index * 1.73) * 0.12;

      context.beginPath();
      context.moveTo(startX, startY);
      context.quadraticCurveTo(
        mix(startX, endX, 0.5) + Math.sin(index * 2.1) * scale * 0.012,
        mix(startY, endY, 0.5),
        endX,
        endY,
      );
      context.lineWidth = widthScale * 1.45;
      context.strokeStyle = `rgba(0,0,0,${alpha * 0.58})`;
      context.stroke();
      context.lineWidth = widthScale;
      context.strokeStyle = isYoung
        ? `rgba(${Math.round(116 + 65 * shimmer)},${Math.round(76 + 48 * shimmer)},31,${alpha})`
        : `rgba(${Math.round(67 + 42 * shimmer)},${Math.round(51 + 28 * shimmer)},29,${alpha})`;
      context.stroke();
      context.lineWidth = Math.max(0.45, widthScale * 0.14);
      context.strokeStyle = `rgba(241,212,140,${alpha * (isYoung ? 0.22 : 0.1)})`;
      context.stroke();
    });

    if (growth > 0.82) {
      const rootGrowth = smoothstep(0.82, 1, growth);
      for (let index = 0; index < 7; index += 1) {
        const direction = index % 2 ? 1 : -1;
        const rootLength = scale * (0.18 + index * 0.025) * rootGrowth;
        context.beginPath();
        context.moveTo(centerX, groundY - 2);
        context.quadraticCurveTo(centerX + direction * rootLength * 0.42, groundY + scale * 0.035, centerX + direction * rootLength, groundY + scale * 0.055);
        context.lineWidth = Math.max(0.8, scale * 0.018 * (1 - index * 0.08));
        context.strokeStyle = `rgba(111,76,34,${alpha * 0.55})`;
        context.stroke();
      }
    }
    context.restore();
  }

  function leafPath(size) {
    context.beginPath();
    context.moveTo(0, -size * 0.56);
    context.bezierCurveTo(size * 0.5, -size * 0.34, size * 0.56, size * 0.19, 0, size * 0.56);
    context.bezierCurveTo(-size * 0.56, size * 0.19, -size * 0.5, -size * 0.34, 0, -size * 0.56);
    context.closePath();
  }

  function drawWebsiteLeaf(leaf, x, y, size, rotation, turn, alpha, burn) {
    if (alpha <= 0.005) return;
    const [paper, ink, accent] = leaf.palette;
    const widthTurn = 0.28 + Math.abs(Math.cos(turn)) * 0.72;
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(widthTurn, 1);
    context.globalAlpha = alpha;

    context.shadowColor = burn > 0 ? `rgba(255,107,24,${0.45 * burn})` : 'rgba(212,174,88,.22)';
    context.shadowBlur = size * (0.22 + burn * 0.32);
    leafPath(size);
    context.fillStyle = burn > 0.15 ? ink : paper;
    context.fill();
    context.shadowBlur = 0;
    context.clip();

    context.fillStyle = ink;
    context.fillRect(-size * 0.39, -size * 0.38, size * 0.78, size * 0.72);
    context.fillStyle = accent;
    context.fillRect(-size * 0.39, -size * 0.38, size * 0.78, size * 0.08);
    context.fillStyle = 'rgba(255,255,255,.8)';
    for (let dot = 0; dot < 3; dot += 1) context.fillRect(-size * (0.32 - dot * 0.07), -size * 0.355, size * 0.025, size * 0.025);
    context.fillStyle = paper;
    context.fillRect(-size * 0.3, -size * 0.21, size * 0.33, size * 0.055);
    context.fillStyle = accent;
    context.fillRect(-size * 0.3, -size * 0.11, size * 0.58, size * 0.16);
    context.fillStyle = 'rgba(255,255,255,.28)';
    context.fillRect(-size * 0.3, size * 0.095, size * 0.25, size * 0.07);
    context.fillRect(size * 0.01, size * 0.095, size * 0.27, size * 0.07);
    context.fillStyle = paper;
    context.font = `800 ${Math.max(4.5, size * 0.075)}px Plus Jakarta Sans, sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(leaf.website, -size * 0.3, size * 0.245, size * 0.58);

    if (burn > 0) {
      const burnGradient = context.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
      burnGradient.addColorStop(0, `rgba(255,102,18,${burn * 0.15})`);
      burnGradient.addColorStop(clamp(1 - burn), 'rgba(32,12,4,.12)');
      burnGradient.addColorStop(clamp(1 - burn + 0.08), `rgba(255,103,17,${0.86 * burn})`);
      burnGradient.addColorStop(clamp(1 - burn + 0.15), `rgba(13,8,5,${0.96 * burn})`);
      context.fillStyle = burnGradient;
      context.fillRect(-size, -size, size * 2, size * 2);
    }
    context.restore();

    context.save();
    context.globalAlpha = alpha;
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(widthTurn, 1);
    leafPath(size);
    context.lineWidth = Math.max(0.7, size * 0.022);
    context.strokeStyle = burn > 0.1 ? `rgba(255,125,35,${0.5 + burn * 0.4})` : 'rgba(241,212,140,.76)';
    context.stroke();
    context.beginPath();
    context.moveTo(0, size * 0.54);
    context.lineTo(0, -size * 0.48);
    context.strokeStyle = burn > 0.1 ? 'rgba(255,175,70,.6)' : 'rgba(212,174,88,.42)';
    context.lineWidth = Math.max(0.5, size * 0.012);
    context.stroke();
    context.restore();
  }

  function drawFlame(x, y, size, alpha, time, phase) {
    if (alpha <= 0.005) return;
    context.save();
    context.translate(x, y);
    context.globalCompositeOperation = 'lighter';
    const flicker = 0.84 + Math.sin(time * 0.012 + phase) * 0.13;
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, size * 1.15);
    glow.addColorStop(0, `rgba(255,209,92,${alpha * 0.72})`);
    glow.addColorStop(0.3, `rgba(255,86,16,${alpha * 0.52})`);
    glow.addColorStop(1, 'rgba(255,44,0,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, size * 1.15, 0, TAU);
    context.fill();

    for (let flame = 0; flame < 3; flame += 1) {
      const offset = (flame - 1) * size * 0.24;
      const flameHeight = size * (0.8 + flame * 0.2) * flicker;
      context.beginPath();
      context.moveTo(offset - size * 0.22, size * 0.34);
      context.quadraticCurveTo(offset - size * 0.2, -flameHeight * 0.23, offset + Math.sin(time * 0.014 + flame) * size * 0.16, -flameHeight);
      context.quadraticCurveTo(offset + size * 0.31, -flameHeight * 0.2, offset + size * 0.2, size * 0.34);
      context.closePath();
      context.fillStyle = flame === 1 ? `rgba(255,222,114,${alpha})` : `rgba(255,94,19,${alpha * 0.78})`;
      context.fill();
    }
    context.restore();
  }

  function drawLeaves(centerX, groundY, treeScale, time) {
    const count = width < 680 ? 14 : leaves.length;
    leaves.slice(0, count).sort((a, b) => a.z - b.z).forEach((leaf) => {
      const fall = smoothstep(leaf.fallStart, leaf.fallStart + 0.31, progress);
      const burn = smoothstep(leaf.burnStart, leaf.burnStart + 0.2, progress);
      const baseX = centerX + leaf.x * treeScale;
      const baseY = groundY + leaf.y * treeScale;
      const sway = Math.sin(time * 0.0012 + leaf.phase + fall * 8) * (6 + fall * 34);
      const x = baseX + sway + leaf.drift * width * easeIn(fall) + pointer.x * 14 * (1 + leaf.z);
      const y = baseY + easeIn(fall) * height * (0.68 + leaf.z * 0.07) + Math.sin(fall * Math.PI * 4 + leaf.phase) * 11;
      const depthScale = 0.78 + (leaf.z + 0.7) * 0.22;
      const size = clamp(treeScale * 0.16 * leaf.size * depthScale, 28, width < 680 ? 52 : 68);
      const rotation = leaf.rotation + fall * leaf.direction * 5.8 + Math.sin(time * 0.001 + leaf.phase) * 0.09;
      const turn = time * 0.0011 * leaf.direction + leaf.phase + fall * 7;
      const leafAlpha = (1 - smoothstep(0.72, 0.99, burn)) * smoothstep(0.02, 0.1, 1 - progress);
      drawWebsiteLeaf(leaf, x, y, size, rotation, turn, leafAlpha, burn);

      const flameAmount = smoothstep(0.05, 0.34, burn) * (1 - smoothstep(0.68, 1, burn));
      drawFlame(x, y + size * 0.12, size * 0.44, flameAmount, time, leaf.phase);

      const ashAmount = smoothstep(0.28, 0.82, burn);
      if (ashAmount > 0) {
        context.save();
        leaf.ash.forEach((particle) => {
          const travel = ashAmount * particle.speed;
          const ashX = x + particle.x * size * (0.35 + travel) + Math.sin(time * 0.002 + particle.phase) * 7;
          const ashY = y + size * 0.1 + travel * size * 1.55 + particle.y * size * 0.45;
          context.globalAlpha = clamp((1 - travel) * ashAmount) * 0.72;
          context.fillStyle = particle.phase > Math.PI ? '#ae6d31' : '#777168';
          context.fillRect(ashX, ashY, particle.size, particle.size * 1.8);
        });
        context.restore();
      }
    });
  }

  function drawGroundAsh(time, groundY) {
    const visible = smoothstep(0.5, 0.72, progress) * (1 - smoothstep(0.9, 1, progress) * 0.45);
    if (visible <= 0.001) return;
    context.save();
    groundAsh.forEach((particle) => {
      const radius = Math.sqrt(particle.radius) * width * 0.28;
      const x = width * 0.5 + Math.cos(particle.angle) * radius;
      const rise = smoothstep(0.6, 0.82, progress) * particle.lift * height * 0.16;
      const y = groundY + Math.sin(particle.angle) * radius * 0.13 - rise + Math.sin(time * 0.0015 + particle.phase) * 4;
      context.globalAlpha = visible * (0.15 + particle.lift * 0.55);
      context.fillStyle = particle.index % 4 === 0 ? '#b77632' : '#5c5953';
      context.fillRect(x, y, particle.size, particle.size * 1.7);
    });
    context.restore();
  }

  function drawYoungLeaves(centerX, groundY, treeScale, growth, time) {
    if (growth < 0.48) return;
    const alpha = smoothstep(0.48, 0.82, growth);
    const count = width < 680 ? 18 : 28;
    context.save();
    youngTree.tips.slice(0, count).forEach((tip, index) => {
      const reveal = smoothstep(0.46 + (index % 7) * 0.035, 0.72 + (index % 7) * 0.035, growth);
      if (reveal <= 0) return;
      const x = centerX + tip.x * treeScale + Math.sin(time * 0.001 + tip.phase) * 2.5;
      const y = groundY + tip.y * treeScale;
      const size = treeScale * 0.055 * tip.size * reveal;
      context.save();
      context.translate(x, y);
      context.rotate(Math.sin(tip.phase) * 0.7);
      context.scale(0.62, 1);
      leafPath(size);
      const leafGlow = context.createLinearGradient(0, -size, 0, size);
      leafGlow.addColorStop(0, '#f2d891');
      leafGlow.addColorStop(0.55, '#bb8e3e');
      leafGlow.addColorStop(1, '#5f4927');
      context.globalAlpha = alpha * reveal;
      context.shadowColor = 'rgba(212,174,88,.5)';
      context.shadowBlur = size * 0.8;
      context.fillStyle = leafGlow;
      context.fill();
      context.restore();
    });
    context.restore();
  }

  function draw(time) {
    if (!width || !height) return;
    pointer.x += (pointer.targetX - pointer.x) * 0.045;
    pointer.y += (pointer.targetY - pointer.y) * 0.045;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    context.clearRect(0, 0, width, height);
    drawBackground(time);

    const mobile = width < 680;
    const groundY = height * (mobile ? 0.9 : 0.91);
    const oldCenterX = width * (mobile ? 0.53 : 0.72) + pointer.x * 13;
    const oldScale = Math.min(width * (mobile ? 0.17 : 0.19), height * 0.225) * (1 + smoothstep(0, 0.34, progress) * 0.055);
    const oldTreeAlpha = 1 - smoothstep(0.5, 0.72, progress);
    drawTree(oldTree, oldCenterX, groundY, oldScale, oldTreeAlpha, 1, false);
    drawLeaves(oldCenterX, groundY, oldScale, time);
    drawGroundAsh(time, groundY);

    const youngGrowth = smoothstep(0.625, 0.91, progress);
    if (youngGrowth > 0) {
      const youngCenterX = width * 0.5 + pointer.x * 6;
      const youngScale = Math.min(width * (mobile ? 0.16 : 0.145), height * 0.205);
      const seedGlow = context.createRadialGradient(youngCenterX, groundY, 0, youngCenterX, groundY, youngScale * 0.72);
      seedGlow.addColorStop(0, `rgba(241,212,140,${0.18 * (1 - youngGrowth) + 0.08})`);
      seedGlow.addColorStop(1, 'rgba(212,174,88,0)');
      context.fillStyle = seedGlow;
      context.fillRect(youngCenterX - youngScale, groundY - youngScale, youngScale * 2, youngScale * 2);
      drawTree(youngTree, youngCenterX, groundY, youngScale, smoothstep(0.02, 0.18, youngGrowth), youngGrowth, true);
      drawYoungLeaves(youngCenterX, groundY, youngScale, youngGrowth, time);
    }

    const foreground = context.createLinearGradient(0, height * 0.76, 0, height);
    foreground.addColorStop(0, 'rgba(3,4,4,0)');
    foreground.addColorStop(1, 'rgba(1,2,2,.82)');
    context.fillStyle = foreground;
    context.fillRect(0, height * 0.72, width, height * 0.28);
  }

  function animate(time) {
    frameId = window.requestAnimationFrame(animate);
    if (!introVisible || document.hidden || reducedMotion.matches || time - lastFrame < 16) return;
    lastFrame = time;
    draw(time);
  }

  function enterOfficialSite() {
    const top = officialSite.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  skipButton?.addEventListener('click', enterOfficialSite);
  stage.addEventListener('pointermove', (event) => {
    if (coarsePointer.matches || reducedMotion.matches) return;
    const rect = stage.getBoundingClientRect();
    pointer.targetX = (event.clientX - rect.left) / rect.width - 0.5;
    pointer.targetY = (event.clientY - rect.top) / rect.height - 0.5;
  }, { passive: true });
  stage.addEventListener('pointerleave', () => {
    pointer.targetX = 0;
    pointer.targetY = 0;
  });

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    introVisible = entry.isIntersecting;
  }, { threshold: 0 });
  visibilityObserver.observe(intro);

  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', () => {
    resize();
    updateProgress();
  }, { passive: true });
  reducedMotion.addEventListener?.('change', () => {
    intro.classList.toggle('is-reduced-motion', reducedMotion.matches);
    if (skipButton) skipButton.firstChild.textContent = reducedMotion.matches ? 'Enter site ' : 'Skip intro ';
    updateProgress();
    draw(performance.now());
  });

  intro.classList.toggle('is-reduced-motion', reducedMotion.matches);
  if (skipButton && reducedMotion.matches) skipButton.firstChild.textContent = 'Enter site ';
  updateProgress();
  resize();
  if (!reducedMotion.matches) frameId = window.requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => window.cancelAnimationFrame(frameId), { once: true });
})();
