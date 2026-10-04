'use strict';

/*
 * BLVCK OAK cinematic origin — Three.js r160.
 *
 * Website mode is scroll-driven and completes a seamless 72-second orbit.
 * Reels capture mode: open /?oak-render=reel in a 9:16 viewport. Its
 * eight-second loop triggers the molten-gold beat drop at exactly 3 seconds.
 */
(() => {
  const intro = document.querySelector('[data-oak-origin]');
  const stage = document.querySelector('[data-oak-stage]');
  const video = document.querySelector('[data-oak-video]');
  const canvas = document.querySelector('[data-oak-canvas]');
  const skipButton = document.querySelector('[data-oak-skip]');
  const chapters = [...document.querySelectorAll('[data-oak-chapter]')];
  const officialSite = document.querySelector('main');
  if (!intro || !stage || !(canvas instanceof HTMLCanvasElement) || !officialSite) return;

  const scriptBase = new URL('.', document.currentScript?.src || document.baseURI);
  const query = new URLSearchParams(window.location.search);
  const reelMode = query.get('oak-render') === 'reel' || stage.dataset.oakRender === 'reel';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const TAU = Math.PI * 2;
  const DEG_15 = Math.PI / 12;
  const HEADER_LOOP_SECONDS = 72;
  const REEL_LOOP_SECONDS = 8;
  const REEL_BEAT_SECONDS = 3;
  const VIDEO_END_SECONDS = 9.4;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const mix = (start, end, amount) => start + (end - start) * amount;
  const smoothstep = (start, end, value) => {
    const amount = clamp((value - start) / Math.max(0.00001, end - start));
    return amount * amount * (3 - 2 * amount);
  };
  const easeOut = (value) => 1 - (1 - clamp(value)) ** 3;

  let storyProgress = reducedMotion.matches ? 0.9 : 0;
  let activeChapter = -1;
  let introVisible = true;
  let frameId = 0;
  let videoReelFrame = 0;
  let videoReelStartedAt = 0;
  let previousVideoReelTime = 0;
  let videoReady = false;
  let videoDuration = VIDEO_END_SECONDS;
  let threeStarted = false;
  let rendererCleanup = () => {};
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function setChapter(index) {
    if (index === activeChapter) return;
    activeChapter = index;
    chapters.forEach((chapter, chapterIndex) => {
      const selected = chapterIndex === index;
      chapter.classList.toggle('is-active', selected);
      chapter.setAttribute('aria-hidden', String(!selected));
    });
  }

  function queueVideoScrub(force = false) {
    if (!(video instanceof HTMLVideoElement) || !videoReady) return;
    // Only one seek is allowed at a time. If progress changes while a seek is
    // active, the seeked listener calls this again using the latest progress.
    if (video.seeking && !force) return;
    const target = clamp(storyProgress) * videoDuration;
    if (Math.abs(video.currentTime - target) < 1 / 48) return;
    try {
      // currentTime requests the exact decoded frame. fastSeek deliberately is
      // not used because it may stop on an earlier keyframe.
      video.currentTime = target;
    } catch (error) {
      startProceduralFallback(error);
    }
  }

  function animateVideoReel(now) {
    videoReelFrame = 0;
    if (!videoReady || threeStarted || reducedMotion.matches || !reelMode) return;
    if (!videoReelStartedAt) videoReelStartedAt = now;
    const cycle = ((now - videoReelStartedAt) / 1000) % REEL_LOOP_SECONDS;
    if (cycle < previousVideoReelTime) previousVideoReelTime = 0;
    applyStoryProgress(cycle / REEL_LOOP_SECONDS);
    if (previousVideoReelTime < REEL_BEAT_SECONDS && cycle >= REEL_BEAT_SECONDS) {
      window.dispatchEvent(new CustomEvent('blvckoak:beat-drop', {
        detail: { at: REEL_BEAT_SECONDS, loop: REEL_LOOP_SECONDS },
      }));
    }
    previousVideoReelTime = cycle;
    videoReelFrame = window.requestAnimationFrame(animateVideoReel);
  }

  function activateVideo() {
    if (!(video instanceof HTMLVideoElement)) return;
    const availableDuration = Number.isFinite(video.duration) ? video.duration : VIDEO_END_SECONDS;
    videoDuration = Math.max(0, Math.min(VIDEO_END_SECONDS, availableDuration - 1 / 48));
    video.pause();
    videoReady = true;
    intro.classList.add('is-video-ready');
    queueVideoScrub(true);
    if (reelMode && !reducedMotion.matches && !videoReelFrame) {
      videoReelStartedAt = 0;
      videoReelFrame = window.requestAnimationFrame(animateVideoReel);
    }
  }

  function handleVideoMotionPreference() {
    intro.classList.toggle('is-reduced-motion', reducedMotion.matches);
    if (skipButton) skipButton.firstChild.textContent = reducedMotion.matches ? 'Enter site ' : 'Skip intro ';
    cancelAnimationFrame(videoReelFrame);
    videoReelFrame = 0;
    videoReelStartedAt = 0;
    if (reducedMotion.matches) applyStoryProgress(0.9);
    else if (reelMode && videoReady) videoReelFrame = window.requestAnimationFrame(animateVideoReel);
    else updateScrollProgress();
  }

  function applyStoryProgress(value) {
    storyProgress = clamp(value);
    const chapter = storyProgress < 0.155 ? 0
      : storyProgress < 0.345 ? 1
        : storyProgress < 0.615 ? 2
          : storyProgress < 0.84 ? 3
            : 4;
    setChapter(chapter);
    intro.style.setProperty('--oak-progress', storyProgress.toFixed(4));
    intro.style.setProperty('--oak-exit', smoothstep(0.955, 1, storyProgress).toFixed(4));
    intro.classList.toggle('has-progress', storyProgress > 0.025);
    queueVideoScrub();
  }

  function updateScrollProgress() {
    const rect = intro.getBoundingClientRect();
    if (!reelMode) {
      const travel = Math.max(1, intro.offsetHeight - window.innerHeight);
      applyStoryProgress(reducedMotion.matches ? 0.9 : -rect.top / travel);
    }
    const active = rect.bottom > window.innerHeight * 0.42 && rect.top < window.innerHeight * 0.55;
    document.body.classList.toggle('oak-intro-active', active);
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
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  updateScrollProgress();
  intro.classList.toggle('is-reel-render', reelMode);
  intro.classList.toggle('is-reduced-motion', reducedMotion.matches);
  if (skipButton && reducedMotion.matches) skipButton.firstChild.textContent = 'Enter site ';
  if (video instanceof HTMLVideoElement) {
    video.addEventListener('loadedmetadata', activateVideo, { once: true });
    video.addEventListener('loadeddata', activateVideo, { once: true });
    video.addEventListener('seeked', () => queueVideoScrub());
    video.addEventListener('error', () => startProceduralFallback(video.error || new Error('The cinematic MP4 could not be decoded.')), { once: true });
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) activateVideo();
    else video.load();
  }
  reducedMotion.addEventListener?.('change', handleVideoMotionPreference);

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

  async function loadThree() {
    const candidates = [
      new URL('vendor/three.module.min.js?v=160', scriptBase),
      new URL('node_modules/three/build/three.module.min.js?v=160', scriptBase),
    ];
    let lastError;
    for (const candidate of candidates) {
      try {
        return await import(candidate.href);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Three.js r160 could not be loaded.');
  }

  function createRadialTexture(THREE, inner, middle, outer) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 256;
    textureCanvas.height = 128;
    const context = textureCanvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 64, 0, 128, 64, 128);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.2, middle);
    gradient.addColorStop(0.54, outer);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 128);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function generateTreeData(THREE, seed, maxDepth) {
    const random = seededRandom(seed);
    const segments = [];
    const tips = [];
    const worldUp = new THREE.Vector3(0, 1, 0);

    function grow(start, inputDirection, length, radius, depth, generation) {
      const direction = inputDirection.clone().normalize();
      let side = new THREE.Vector3().crossVectors(worldUp, direction);
      if (side.lengthSq() < 0.001) side.set(1, 0, 0);
      side.normalize();
      const normal = new THREE.Vector3().crossVectors(direction, side).normalize();
      const bend = side.clone().multiplyScalar((random() - 0.5) * length * 0.18)
        .add(normal.clone().multiplyScalar((random() - 0.5) * length * 0.13));
      const end = start.clone().addScaledVector(direction, length).add(bend);
      segments.push({
        start: start.clone(),
        end,
        radius,
        generation,
        reveal: generation / (maxDepth + 1) + random() * 0.025,
        phase: random() * TAU,
      });
      if (depth <= 0 || radius < 0.024) {
        tips.push({ position: end.clone(), phase: random() * TAU, size: 0.72 + random() * 0.55 });
        return;
      }
      const childCount = depth > maxDepth - 3 && random() > 0.64 ? 3 : 2;
      const baseAzimuth = random() * TAU;
      for (let index = 0; index < childCount; index += 1) {
        const azimuth = baseAzimuth + index * TAU / childCount + (random() - 0.5) * 0.46;
        const spread = 0.34 + generation * 0.018 + random() * 0.23;
        const childDirection = direction.clone().multiplyScalar(Math.cos(spread))
          .addScaledVector(side, Math.sin(spread) * Math.cos(azimuth))
          .addScaledVector(normal, Math.sin(spread) * Math.sin(azimuth))
          .normalize();
        grow(
          end,
          childDirection,
          length * (0.68 + random() * 0.1),
          radius * (0.62 + random() * 0.08),
          depth - 1,
          generation + 1,
        );
      }
    }

    const root = new THREE.Vector3(0, -3.05, 0);
    grow(root, new THREE.Vector3(0.02, 1, 0.01), 1.66, 0.5, maxDepth, 0);
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * TAU + random() * 0.28;
      const length = 1.15 + random() * 0.95;
      const end = root.clone().add(new THREE.Vector3(
        Math.cos(angle) * length,
        -0.18 - random() * 0.22,
        Math.sin(angle) * length * 0.58,
      ));
      segments.push({
        start: root.clone(),
        end,
        radius: 0.2 - index * 0.01,
        generation: 0,
        reveal: 0.78 + index * 0.018,
        phase: random() * TAU,
      });
    }
    return { segments, tips, maxDepth };
  }

  function cylinderMatrix(THREE, start, end, radius, radialScale = 1) {
    const direction = end.clone().sub(start);
    const length = Math.max(0.0001, direction.length());
    const position = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    const scale = new THREE.Vector3(radius * radialScale, length, radius * radialScale);
    return new THREE.Matrix4().compose(position, quaternion, scale);
  }

  function createTreeMaterials(THREE, reflection = false) {
    if (reflection) {
      return {
        branch: new THREE.MeshPhysicalMaterial({
          color: 0x111111,
          metalness: 1,
          roughness: 0.08,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
        }),
        vein: new THREE.MeshBasicMaterial({
          color: 0xd49a3a,
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        halo: new THREE.MeshBasicMaterial({
          color: 0xff6a00,
          transparent: true,
          opacity: 0.04,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        bud: new THREE.MeshBasicMaterial({
          color: 0xd4ae58,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        }),
      };
    }
    return {
      branch: new THREE.MeshPhysicalMaterial({
        color: 0x0a0a0a,
        metalness: 0.95,
        roughness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        emissive: 0xffa500,
        emissiveIntensity: 0.015,
        transparent: true,
        opacity: 1,
      }),
      vein: new THREE.MeshBasicMaterial({
        color: 0xffbd57,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      halo: new THREE.MeshBasicMaterial({
        color: 0xff5a00,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      bud: new THREE.MeshPhysicalMaterial({
        color: 0x25170a,
        metalness: 0.55,
        roughness: 0.2,
        clearcoat: 1,
        emissive: 0xff9f24,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0,
      }),
    };
  }

  function createTreeLevel(THREE, data, materials, generationLimit, radialSegments) {
    const group = new THREE.Group();
    const segments = data.segments
      .filter((segment) => segment.generation <= generationLimit)
      .sort((a, b) => a.reveal - b.reveal);
    const branchGeometry = new THREE.CylinderGeometry(0.68, 1, 1, radialSegments, 1, false);
    const branchMesh = new THREE.InstancedMesh(branchGeometry, materials.branch, Math.max(1, segments.length));
    branchMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    branchMesh.castShadow = radialSegments >= 7;
    branchMesh.receiveShadow = true;
    branchMesh.frustumCulled = false;
    segments.forEach((segment, index) => {
      branchMesh.setMatrixAt(index, cylinderMatrix(THREE, segment.start, segment.end, segment.radius));
    });
    branchMesh.instanceMatrix.needsUpdate = true;
    branchMesh.userData.total = segments.length;
    branchMesh.userData.kind = 'branch';
    group.add(branchMesh);

    const veinRuns = [];
    const up = new THREE.Vector3(0, 1, 0);
    segments.forEach((segment, segmentIndex) => {
      if (segment.generation > Math.min(generationLimit, 5)) return;
      const direction = segment.end.clone().sub(segment.start).normalize();
      let side = new THREE.Vector3().crossVectors(direction, up);
      if (side.lengthSq() < 0.001) side.set(0, 0, 1);
      side.normalize();
      const normal = new THREE.Vector3().crossVectors(direction, side).normalize();
      const runCount = segment.generation < 2 ? 3 : segment.generation < 4 ? 2 : 1;
      for (let run = 0; run < runCount; run += 1) {
        const angle = segment.phase + run * 2.31;
        const offset = side.clone().multiplyScalar(Math.cos(angle) * segment.radius * 0.82)
          .addScaledVector(normal, Math.sin(angle) * segment.radius * 0.82);
        const fromAmount = 0.08 + run * 0.22 + (segmentIndex % 3) * 0.025;
        const toAmount = Math.min(0.94, fromAmount + 0.3 + (segmentIndex % 4) * 0.045);
        const start = segment.start.clone().lerp(segment.end, fromAmount).add(offset);
        const end = segment.start.clone().lerp(segment.end, toAmount)
          .add(offset.clone().multiplyScalar(0.72))
          .addScaledVector(side, Math.sin(segment.phase * 2 + run) * segment.radius * 0.18);
        veinRuns.push({
          start,
          end,
          radius: Math.max(0.012, segment.radius * 0.075),
          reveal: segment.reveal,
        });
      }
    });
    veinRuns.sort((a, b) => a.reveal - b.reveal);

    const veinGeometry = new THREE.CylinderGeometry(0.72, 1, 1, Math.max(4, radialSegments - 2), 1, false);
    const veinCore = new THREE.InstancedMesh(veinGeometry, materials.vein, Math.max(1, veinRuns.length));
    const veinHalo = new THREE.InstancedMesh(veinGeometry, materials.halo, Math.max(1, veinRuns.length));
    veinCore.frustumCulled = false;
    veinHalo.frustumCulled = false;
    veinRuns.forEach((vein, index) => {
      veinCore.setMatrixAt(index, cylinderMatrix(THREE, vein.start, vein.end, vein.radius));
      veinHalo.setMatrixAt(index, cylinderMatrix(THREE, vein.start, vein.end, vein.radius, 2.8));
    });
    veinCore.instanceMatrix.needsUpdate = true;
    veinHalo.instanceMatrix.needsUpdate = true;
    veinCore.userData.total = veinRuns.length;
    veinHalo.userData.total = veinRuns.length;
    veinCore.userData.kind = 'vein';
    veinHalo.userData.kind = 'vein';
    group.add(veinHalo, veinCore);

    const tips = data.tips.filter((_, index) => index % (generationLimit >= 6 ? 2 : 4) === 0);
    const budGeometry = new THREE.IcosahedronGeometry(1, radialSegments >= 7 ? 1 : 0);
    const buds = new THREE.InstancedMesh(budGeometry, materials.bud, Math.max(1, tips.length));
    buds.frustumCulled = false;
    tips.forEach((tip, index) => {
      const scale = 0.045 * tip.size;
      buds.setMatrixAt(index, new THREE.Matrix4().compose(
        tip.position,
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale * 1.6, scale),
      ));
    });
    buds.instanceMatrix.needsUpdate = true;
    buds.userData.total = tips.length;
    buds.userData.kind = 'bud';
    group.add(buds);
    group.userData.renderMeshes = [branchMesh, veinHalo, veinCore, buds];
    return group;
  }

  function createTreeLOD(THREE, data, options = {}) {
    const materials = createTreeMaterials(THREE, Boolean(options.reflection));
    const lod = new THREE.LOD();
    const levels = options.reflection
      ? [
        { generation: 4, radial: 5, distance: 0 },
        { generation: 2, radial: 4, distance: 17 },
      ]
      : coarsePointer.matches
        ? [
          { generation: 6, radial: 7, distance: 0 },
          { generation: 4, radial: 5, distance: 16 },
          { generation: 2, radial: 4, distance: 25 },
        ]
        : [
          { generation: data.maxDepth, radial: 10, distance: 0 },
          { generation: 5, radial: 7, distance: 16 },
          { generation: 3, radial: 5, distance: 25 },
        ];
    levels.forEach((level) => {
      lod.addLevel(createTreeLevel(THREE, data, materials, level.generation, level.radial), level.distance);
    });
    lod.autoUpdate = true;
    return { lod, materials, levels: lod.levels.map((level) => level.object) };
  }

  function setTreeGrowth(tree, growth) {
    const visibleGrowth = clamp(growth);
    tree.lod.visible = visibleGrowth > 0.005;
    tree.levels.forEach((level) => {
      level.userData.renderMeshes.forEach((mesh) => {
        const total = mesh.userData.total || 0;
        mesh.count = Math.round(total * (mesh.userData.kind === 'bud'
          ? smoothstep(0.66, 1, visibleGrowth)
          : easeOut(visibleGrowth)));
        mesh.visible = mesh.count > 0;
      });
    });
  }

  function setTreeAppearance(tree, opacity, heat, pulse, growth) {
    const visibleOpacity = clamp(opacity);
    tree.materials.branch.opacity = visibleOpacity;
    tree.materials.branch.emissiveIntensity = 0.015 + heat * 0.18 + pulse * 0.025;
    tree.materials.vein.opacity = visibleOpacity * (0.66 + pulse * 0.28 + heat * 0.42);
    tree.materials.halo.opacity = visibleOpacity * (0.12 + pulse * 0.14 + heat * 0.34);
    tree.materials.bud.opacity = visibleOpacity * smoothstep(0.62, 0.92, growth);
    tree.materials.bud.emissiveIntensity = 0.9 + pulse * 1.3 + heat * 0.6;
    setTreeGrowth(tree, growth);
  }

  function createParticleCloud(THREE, count, texture, color, size, additive = false) {
    const random = seededRandom(count * 911 + color);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 7);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 7;
      for (let item = 0; item < 7; item += 1) seeds[offset + item] = random();
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size,
      map: texture,
      transparent: true,
      opacity: 0,
      alphaTest: 0.004,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.userData.seeds = seeds;
    points.userData.count = count;
    return points;
  }

  function updateAmbientDust(points, time, strength) {
    const positions = points.geometry.attributes.position.array;
    const seeds = points.userData.seeds;
    for (let index = 0; index < points.userData.count; index += 1) {
      const seed = index * 7;
      const position = index * 3;
      const cycle = (seeds[seed + 1] + time * (0.01 + seeds[seed + 3] * 0.018)) % 1;
      positions[position] = (seeds[seed] - 0.5) * 17 + Math.sin(time * 0.23 + seeds[seed + 4] * TAU) * 0.24;
      positions[position + 1] = -4 + cycle * 11;
      positions[position + 2] = (seeds[seed + 2] - 0.5) * 8;
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.material.opacity = 0.13 + strength * 0.16;
  }

  function updateRisingParticles(points, time, originX, strength, mode) {
    const positions = points.geometry.attributes.position.array;
    const seeds = points.userData.seeds;
    const verticalRange = mode === 'ember' ? 7 : 9;
    for (let index = 0; index < points.userData.count; index += 1) {
      const seed = index * 7;
      const position = index * 3;
      const speed = mode === 'ember' ? 0.13 + seeds[seed + 3] * 0.24 : 0.035 + seeds[seed + 3] * 0.08;
      const cycle = (seeds[seed + 1] + time * speed) % 1;
      const radius = (0.25 + seeds[seed] * 2.2) * (0.45 + cycle);
      const angle = seeds[seed + 4] * TAU + time * (0.32 + seeds[seed + 5] * 0.5);
      positions[position] = originX + Math.cos(angle) * radius;
      positions[position + 1] = -2.8 + cycle * verticalRange;
      positions[position + 2] = (seeds[seed + 2] - 0.5) * 3.2 + Math.sin(angle) * 0.35;
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.material.opacity = strength * (mode === 'ember' ? 0.92 : 0.48);
    points.visible = strength > 0.005;
  }

  function updateExplosion(points, originX, amount, age) {
    const positions = points.geometry.attributes.position.array;
    const seeds = points.userData.seeds;
    for (let index = 0; index < points.userData.count; index += 1) {
      const seed = index * 7;
      const position = index * 3;
      const theta = seeds[seed] * TAU;
      const z = seeds[seed + 1] * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - z * z));
      const distance = easeOut(age) * (1.5 + seeds[seed + 2] * 7.5);
      positions[position] = originX + Math.cos(theta) * radial * distance;
      positions[position + 1] = 0.1 + z * distance * 0.78;
      positions[position + 2] = Math.sin(theta) * radial * distance;
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.material.opacity = amount * (1 - age) * 1.35;
    points.visible = amount > 0.005;
  }

  function createFogBank(THREE, texture, count) {
    const random = seededRandom(4471);
    const group = new THREE.Group();
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: index % 3 === 0 ? 0x6f4c2d : 0x3d3a36,
        transparent: true,
        opacity: 0.025,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set((random() - 0.5) * 13, -2.8 + random() * 6, -2 + random() * 3);
      sprite.scale.set(4 + random() * 6, 1.3 + random() * 2.4, 1);
      sprite.userData = {
        baseX: sprite.position.x,
        baseY: sprite.position.y,
        phase: random() * TAU,
        speed: 0.06 + random() * 0.12,
      };
      group.add(sprite);
    }
    return group;
  }

  function updateFogBank(group, time, fire, ash) {
    group.children.forEach((sprite, index) => {
      sprite.position.x = sprite.userData.baseX + Math.sin(time * sprite.userData.speed + sprite.userData.phase) * 0.65;
      sprite.position.y = sprite.userData.baseY + Math.sin(time * 0.08 + sprite.userData.phase) * 0.22;
      sprite.material.opacity = 0.018 + ash * 0.07 + fire * (index % 3 === 0 ? 0.055 : 0.015);
      sprite.material.rotation = Math.sin(time * 0.035 + sprite.userData.phase) * 0.08;
    });
  }

  function initThree(THREE) {
    if (!THREE || THREE.REVISION !== '160') throw new Error('BLVCK OAK requires Three.js r160.');

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !coarsePointer.matches,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.shadowMap.enabled = !coarsePointer.matches;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x010101, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010101);
    scene.fog = new THREE.FogExp2(0x030303, 0.052);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 70);
    camera.position.set(0, 0.65, 12);

    scene.add(new THREE.HemisphereLight(0x4a4135, 0x010101, 0.48));
    const keyLight = new THREE.SpotLight(0xfff2d3, 115, 34, Math.PI / 5, 0.72, 1.2);
    keyLight.position.set(-6, 8, 9);
    keyLight.target.position.set(1.8, 0.3, 0);
    keyLight.castShadow = !coarsePointer.matches;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight, keyLight.target);
    const rimLight = new THREE.SpotLight(0x6f8fac, 82, 30, Math.PI / 4, 0.8, 1.4);
    rimLight.position.set(8, 4, -5);
    rimLight.target.position.set(2, 0, 0);
    scene.add(rimLight, rimLight.target);
    const moltenLight = new THREE.PointLight(0xff7a12, 0, 15, 1.8);
    moltenLight.position.set(2.3, 0.15, 1.5);
    scene.add(moltenLight);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 20),
      new THREE.MeshPhysicalMaterial({
        color: 0x060606,
        metalness: 0.72,
        roughness: 0.24,
        clearcoat: 0.82,
        clearcoatRoughness: 0.18,
      }),
    );
    wall.position.set(0, 1, -3.05);
    wall.receiveShadow = true;
    scene.add(wall);

    const mirrorPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 11),
      new THREE.MeshPhysicalMaterial({
        color: 0x090909,
        metalness: 1,
        roughness: 0.035,
        clearcoat: 1,
        transparent: true,
        opacity: 0.62,
      }),
    );
    mirrorPanel.position.set(-4.1, 0.35, -2.96);
    scene.add(mirrorPanel);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 22),
      new THREE.MeshPhysicalMaterial({
        color: 0x030303,
        metalness: 0.82,
        roughness: 0.28,
        transparent: true,
        opacity: 0.9,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.42;
    floor.receiveShadow = true;
    scene.add(floor);

    const maxDepth = coarsePointer.matches ? 6 : 7;
    const oldData = generateTreeData(THREE, 0xB10C0A, maxDepth);
    const youngData = generateTreeData(THREE, 0xF1A551, maxDepth);
    const oldTree = createTreeLOD(THREE, oldData);
    const youngTree = createTreeLOD(THREE, youngData);
    const reflectionTree = createTreeLOD(THREE, oldData, { reflection: true });
    scene.add(oldTree.lod, youngTree.lod, reflectionTree.lod);
    reflectionTree.lod.position.set(-3.15, -0.15, -2.72);
    reflectionTree.lod.scale.set(-0.66, 0.66, 0.1);
    reflectionTree.lod.rotation.y = -0.22;

    const glowTexture = createRadialTexture(
      THREE,
      'rgba(255,242,196,1)',
      'rgba(255,151,45,.78)',
      'rgba(255,120,18,.12)',
    );
    const ashTexture = createRadialTexture(
      THREE,
      'rgba(235,229,217,.75)',
      'rgba(151,143,132,.28)',
      'rgba(151,143,132,.08)',
    );
    const fogTexture = createRadialTexture(
      THREE,
      'rgba(204,184,151,.2)',
      'rgba(91,80,67,.11)',
      'rgba(40,36,32,.04)',
    );
    const qualityScale = coarsePointer.matches ? 0.55 : 1;
    const dust = createParticleCloud(THREE, Math.round(420 * qualityScale), ashTexture, 0xd8cbb7, 0.045);
    const embers = createParticleCloud(THREE, Math.round(280 * qualityScale), glowTexture, 0xffa02d, 0.075, true);
    const ash = createParticleCloud(THREE, Math.round(340 * qualityScale), ashTexture, 0xaaa39a, 0.065);
    const explosion = createParticleCloud(THREE, Math.round(320 * qualityScale), glowTexture, 0xffa02d, 0.12, true);
    const fogBank = createFogBank(THREE, fogTexture, coarsePointer.matches ? 6 : 11);
    scene.add(dust, embers, ash, explosion, fogBank);

    let mobile = false;
    let startTime = performance.now();
    let lastFrame = 0;
    let previousReelTime = 0;
    let destroyed = false;

    function resize() {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      mobile = width < 760;
      const pixelRatioCap = mobile || coarsePointer.matches ? 1.25 : 1.7;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = reelMode ? 47 : mobile ? 51 : 39;
      camera.updateProjectionMatrix();
    }

    function reelStory(cycle) {
      if (cycle < 2.55) return mix(0.08, 0.42, smoothstep(0, 2.55, cycle));
      if (cycle < 4.65) return mix(0.42, 0.7, smoothstep(2.55, 4.65, cycle));
      if (cycle < 7.15) return mix(0.7, 0.96, smoothstep(4.65, 7.15, cycle));
      return mix(0.96, 0.08, smoothstep(7.15, REEL_LOOP_SECONDS, cycle));
    }

    function render(time, progress, reelCycle = 0) {
      pointer.x += (pointer.targetX - pointer.x) * 0.045;
      pointer.y += (pointer.targetY - pointer.y) * 0.045;
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.45);
      const fire = smoothstep(0.27, 0.43, progress) * (1 - smoothstep(0.63, 0.74, progress));
      const ashAmount = smoothstep(0.43, 0.58, progress) * (1 - smoothstep(0.84, 0.97, progress));
      const newGrowth = smoothstep(0.62, 0.92, progress);
      const oldGrowth = 0.58 + smoothstep(0, 0.14, progress) * 0.42;
      const oldOpacity = 1 - smoothstep(0.48, 0.72, progress) * 0.93;
      let beatAmount;
      let beatAge;

      if (reelMode) {
        const age = reelCycle - REEL_BEAT_SECONDS;
        beatAge = clamp(age / 1.35);
        beatAmount = age >= 0 && age < 1.35 ? 1 - smoothstep(0, 1.35, age) : 0;
        if (previousReelTime < REEL_BEAT_SECONDS && reelCycle >= REEL_BEAT_SECONDS) {
          window.dispatchEvent(new CustomEvent('blvckoak:beat-drop', {
            detail: { at: REEL_BEAT_SECONDS, loop: REEL_LOOP_SECONDS },
          }));
        }
        previousReelTime = reelCycle;
      } else {
        beatAge = smoothstep(0.43, 0.58, progress);
        beatAmount = Math.exp(-(((progress - 0.49) / 0.055) ** 2));
      }

      const heat = clamp(fire + beatAmount * 0.9);
      setTreeAppearance(oldTree, oldOpacity, heat, pulse, oldGrowth);
      setTreeAppearance(youngTree, newGrowth, heat * 0.35, pulse, newGrowth);
      setTreeGrowth(reflectionTree, Math.max(oldGrowth * oldOpacity, newGrowth));
      reflectionTree.materials.branch.opacity = 0.035 + oldOpacity * 0.09;
      reflectionTree.materials.vein.opacity = 0.035 + heat * 0.09 + newGrowth * 0.05;
      reflectionTree.materials.halo.opacity = 0.015 + heat * 0.04;
      reflectionTree.materials.bud.opacity = newGrowth * 0.05;

      const loopFraction = reelMode
        ? reelCycle / REEL_LOOP_SECONDS
        : (time % HEADER_LOOP_SECONDS) / HEADER_LOOP_SECONDS;
      const orbit = loopFraction * TAU + (reelMode ? 0 : progress * 0.58);
      const swayCycles = reelMode ? 1 : 6;
      const sway = Math.sin(loopFraction * TAU * swayCycles) * DEG_15;
      const baseX = mobile ? 0.55 : 2.55;
      const centeredX = mix(baseX, 0, smoothstep(0.82, 0.97, progress));

      oldTree.lod.position.set(centeredX, -0.08, 0);
      youngTree.lod.position.set(centeredX, -0.08, 0.02);
      oldTree.lod.rotation.set(0, orbit, sway);
      youngTree.lod.rotation.set(0, orbit + 0.08, sway * 0.72);
      oldTree.lod.scale.setScalar(1 - smoothstep(0.48, 0.72, progress) * 0.07);
      youngTree.lod.scale.set(
        mix(0.54, 1, newGrowth),
        mix(0.045, 1, easeOut(newGrowth)),
        mix(0.54, 1, newGrowth),
      );
      reflectionTree.lod.rotation.y = -orbit * 0.38 - 0.22;
      reflectionTree.lod.visible = !mobile;
      mirrorPanel.visible = !mobile;

      updateAmbientDust(dust, time, ashAmount);
      updateRisingParticles(embers, time, centeredX, clamp(fire + beatAmount), 'ember');
      updateRisingParticles(ash, time, centeredX, ashAmount, 'ash');
      updateExplosion(explosion, centeredX, beatAmount, beatAge);
      updateFogBank(fogBank, time, fire, ashAmount);
      moltenLight.position.x = centeredX;
      moltenLight.intensity = 8 + pulse * 7 + heat * 78 + beatAmount * 125;
      scene.fog.density = 0.042 + ashAmount * 0.034 + fire * 0.009;
      renderer.toneMappingExposure = 0.82 + heat * 0.15 + beatAmount * 0.22;
      camera.position.x = pointer.x * 0.75 + (reelMode ? 0 : -0.18);
      camera.position.y = 0.55 - pointer.y * 0.42;
      camera.position.z = reelMode ? 12.9 : mobile ? 13.6 : 12;
      camera.lookAt(centeredX * (mobile ? 0.35 : 0.46), -0.1, 0);
      renderer.render(scene, camera);
    }

    function animate(now) {
      frameId = window.requestAnimationFrame(animate);
      if (destroyed || !introVisible || document.hidden) return;
      const minimumFrame = coarsePointer.matches ? 1000 / 30 : 1000 / 60;
      if (now - lastFrame < minimumFrame) return;
      lastFrame = now;
      const time = (now - startTime) / 1000;
      const reelCycle = time % REEL_LOOP_SECONDS;
      const progress = reelMode ? reelStory(reelCycle) : storyProgress;
      if (reelMode) applyStoryProgress(progress);
      render(time, progress, reelCycle);
    }

    function renderReducedMotion() {
      applyStoryProgress(0.9);
      render(4.5, 0.9, 4.5);
    }

    const resizeHandler = () => {
      resize();
      updateScrollProgress();
      if (reducedMotion.matches) renderReducedMotion();
    };
    const motionHandler = () => {
      intro.classList.toggle('is-reduced-motion', reducedMotion.matches);
      if (skipButton) skipButton.firstChild.textContent = reducedMotion.matches ? 'Enter site ' : 'Skip intro ';
      cancelAnimationFrame(frameId);
      startTime = performance.now();
      resize();
      if (reducedMotion.matches) renderReducedMotion();
      else frameId = window.requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resizeHandler, { passive: true });
    reducedMotion.addEventListener?.('change', motionHandler);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      intro.classList.add('is-webgl-fallback');
      cancelAnimationFrame(frameId);
    });
    resize();
    if (reducedMotion.matches) renderReducedMotion();
    else frameId = window.requestAnimationFrame(animate);

    rendererCleanup = () => {
      destroyed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resizeHandler);
      reducedMotion.removeEventListener?.('change', motionHandler);
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
      glowTexture.dispose();
      ashTexture.dispose();
      fogTexture.dispose();
      renderer.dispose();
    };
  }

  function showFallback(error) {
    intro.classList.add('is-webgl-fallback');
    canvas.style.background = 'radial-gradient(circle at 68% 48%, rgba(255,153,45,.16), transparent 12%), radial-gradient(circle at 62% 54%, rgba(212,174,88,.08), transparent 34%), #020202';
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.warn('BLVCK OAK WebGL intro fallback:', error);
    }
  }

  function startProceduralFallback(error) {
    if (threeStarted) return;
    threeStarted = true;
    cancelAnimationFrame(videoReelFrame);
    videoReelFrame = 0;
    videoReady = false;
    intro.classList.remove('is-video-ready');
    intro.classList.add('is-video-fallback');
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.warn('BLVCK OAK video intro fallback:', error);
    }
    loadThree().then(initThree).catch(showFallback);
  }

  if (!(video instanceof HTMLVideoElement)) {
    startProceduralFallback(new Error('The cinematic video element is unavailable.'));
  }
  window.addEventListener('pagehide', () => {
    rendererCleanup();
    visibilityObserver.disconnect();
    reducedMotion.removeEventListener?.('change', handleVideoMotionPreference);
    cancelAnimationFrame(frameId);
    cancelAnimationFrame(videoReelFrame);
  }, { once: true });
})();
