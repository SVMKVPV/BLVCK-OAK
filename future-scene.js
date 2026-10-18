/* BLVCK OAK — Thrixel titanium leaf, local Three.js, native scroll. */
(() => {
  'use strict';
  const stage = document.querySelector('[data-future-scene]');
  const canvas = stage?.querySelector('[data-future-canvas]');
  const hero = stage?.closest('.hero');
  if (!hero || !(canvas instanceof HTMLCanvasElement)) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const compact = window.matchMedia('(max-width: 760px)');
  const events = new AbortController();
  const passive = { passive: true, signal: events.signal };
  const scriptBase = new URL('.', document.currentScript?.src || document.baseURI);
  let userPaused = false;
  try { userPaused = sessionStorage.getItem('blvckoak-motion-paused') === 'true'; } catch { /* Private browsing. */ }
  let paused = userPaused || reduced.matches || document.hidden;
  let inView = true;
  let suspended = false;
  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let elapsed = 0;
  let lastFrame = 0;
  let scrollProgress = 0;
  let targetScroll = 0;
  let renderScene = null;
  let resizeScene = null;
  let disposeScene = null;
  let restoreScene = null;
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  stage.dataset.sceneState = 'loading';
  stage.dataset.scenePaused = String(paused);

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  }

  function running() {
    return !disposed && !contextLost && !paused && !document.hidden && !suspended && inView;
  }

  function animate(now) {
    frame = 0;
    if (!running() || !renderScene) { lastFrame = 0; return; }
    // Cap decorative rendering at 40fps on desktop and 30fps on small screens.
    const interval = compact.matches ? 1000 / 30 : 1000 / 40;
    const delta = lastFrame ? now - lastFrame : interval;
    if (delta >= interval - 1) {
      const seconds = Math.min(delta, 80) / 1000;
      elapsed += seconds;
      lastFrame = now;
      const ease = 1 - Math.exp(-seconds * 5);
      pointer.x += (pointer.targetX - pointer.x) * ease;
      pointer.y += (pointer.targetY - pointer.y) * ease;
      scrollProgress += (targetScroll - scrollProgress) * ease;
      try { renderScene(elapsed, scrollProgress, pointer); }
      catch { fallback(); return; }
    }
    frame = requestAnimationFrame(animate);
  }

  function resume() {
    if (running() && renderScene && !frame) frame = requestAnimationFrame(animate);
  }

  function syncMotion(event) {
    if (event?.detail && typeof event.detail.userPaused === 'boolean') userPaused = event.detail.userPaused;
    paused = userPaused || reduced.matches || document.hidden || suspended;
    stage.dataset.scenePaused = String(paused);
    if (paused) stop();
    else resume();
  }

  function updateScroll() {
    const bounds = hero.getBoundingClientRect();
    targetScroll = Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height)));
    // Browsers without IntersectionObserver still stop off-screen work.
    if (!('IntersectionObserver' in window)) {
      inView = bounds.bottom > 0 && bounds.top < innerHeight;
      if (!inView) stop(); else resume();
    }
  }

  hero.addEventListener('pointermove', (event) => {
    if (!running() || !finePointer.matches || event.pointerType !== 'mouse') return;
    const bounds = stage.getBoundingClientRect();
    pointer.targetX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - .5) * 2));
    pointer.targetY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - .5) * 2));
  }, passive);
  hero.addEventListener('pointerleave', () => { pointer.targetX = 0; pointer.targetY = 0; }, passive);
  finePointer.addEventListener('change', () => { pointer.targetX = 0; pointer.targetY = 0; }, { signal: events.signal });
  window.addEventListener('scroll', updateScroll, passive);
  window.addEventListener('blvckoak:motion-change', syncMotion, { signal: events.signal });
  document.addEventListener('visibilitychange', syncMotion, { signal: events.signal });
  reduced.addEventListener('change', syncMotion, { signal: events.signal });

  const visibility = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) stop(); else resume();
  }, { threshold: 0 }) : null;
  visibility?.observe(stage);

  function fallback() {
    stop();
    delete stage.dataset.sceneReady;
    stage.dataset.sceneState = 'fallback';
    canvas.style.visibility = 'hidden';
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    fallback();
  }, { signal: events.signal });
  function handleContextRestored() {
    if (disposed) return;
    contextLost = false;
    try {
      restoreScene?.();
      if (!renderScene) return;
      resizeScene?.();
      renderScene(elapsed, scrollProgress, pointer);
      canvas.style.visibility = '';
      stage.dataset.sceneState = 'ready';
      stage.dataset.sceneReady = 'true';
      resume();
    } catch { fallback(); }
  }

  const sizeObserver = 'ResizeObserver' in window ? new ResizeObserver(() => {
    if (disposed || contextLost) return;
    resizeScene?.();
    if (!document.hidden && renderScene) renderScene(elapsed, scrollProgress, pointer);
    updateScroll();
  }) : null;
  sizeObserver?.observe(stage);
  window.addEventListener('resize', () => {
    if (!sizeObserver && !disposed && !contextLost) {
      resizeScene?.();
      if (!document.hidden) renderScene?.(elapsed, scrollProgress, pointer);
    }
    updateScroll();
  }, passive);

  window.addEventListener('pagehide', (event) => {
    suspended = true;
    syncMotion();
    if (event.persisted) return;
    disposed = true;
    events.abort();
    visibility?.disconnect();
    sizeObserver?.disconnect();
    disposeScene?.();
  }, { signal: events.signal });
  window.addEventListener('pageshow', () => { suspended = false; syncMotion(); }, { signal: events.signal });

  function studioEnvironment(THREE, renderer) {
    // Self-contained softboxes make true reflected highlights without an HDR download.
    const room = new THREE.Scene();
    room.background = new THREE.Color('#11191d');
    const materials = [];
    const geometry = new THREE.PlaneGeometry(1, 1);
    const box = (color, intensity, x, y, z, width, height) => {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
      materials.push(material);
      const panel = new THREE.Mesh(geometry, material);
      panel.position.set(x, y, z);
      panel.scale.set(width, height, 1);
      panel.lookAt(0, 0, 0);
      room.add(panel);
    };
    box('#f6fff8', 4, -3, 3, 4, 3.8, 7);
    box('#c2e4ee', 2, 4, .5, 1, 1.8, 6);
    box('#fafff7', 3, 0, 5, -2, 5, 2);
    box('#9bc9b9', 2, -3, -2, -3, 4, 1.2);
    box('#dde6ef', 1.5, 1, 0, -5, 1.5, 5);
    const generator = new THREE.PMREMGenerator(renderer);
    const texture = generator.fromScene(room, .08, .1, 30);
    generator.dispose();
    geometry.dispose();
    materials.forEach(material => material.dispose());
    return texture;
  }

  async function buildScene() {
    const [THREE, { GLTFLoader }, { mergeVertices }] = await Promise.all([
      import(new URL('vendor/three.module.min.js', scriptBase).href),
      import(new URL('vendor/GLTFLoader.js', scriptBase).href),
      import(new URL('vendor/BufferGeometryUtils.js', scriptBase).href),
    ]);
    if (disposed) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    // Register after Three so its native listener rebuilds GL state first.
    // A microtask in an earlier listener can run before later native listeners.
    canvas.addEventListener('webglcontextrestored', handleContextRestored, { signal: events.signal });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, .1, 40);
    camera.position.set(0, .04, 8.1);
    let env = studioEnvironment(THREE, renderer);
    scene.environment = env.texture;
    restoreScene = () => {
      env.dispose();
      env = studioEnvironment(THREE, renderer);
      scene.environment = env.texture;
    };
    const ambient = new THREE.HemisphereLight('#dceef4', '#10231e', 1.25);
    scene.add(ambient);
    const key = new THREE.DirectionalLight('#ffffff', 2.1);
    key.position.set(-3, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#aeeed6', 2.8);
    rim.position.set(4, -1, 1);
    scene.add(rim);

    const art = new THREE.Group();
    scene.add(art);
    const chrome = new THREE.MeshPhysicalMaterial({
      color: '#d5e0df', metalness: .97, roughness: .235,
      clearcoat: .8, clearcoatRoughness: .18, envMapIntensity: 1.1,
    });
    const disposeTree = (tree) => tree.traverse((object) => {
      object.geometry?.dispose();
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) material.dispose();
    });
    disposeScene = () => {
      disposeTree(scene);
      chrome.dispose();
      env.dispose();
      renderer.dispose();
    };
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(new URL('assets/models/titanium-oak-leaf.glb', scriptBase).href);
    } catch (error) {
      disposeScene();
      disposeScene = null;
      throw error;
    }
    if (disposed) { disposeTree(gltf.scene); return; }
    const leaf = gltf.scene;
    leaf.traverse((object) => {
      if (!object.isMesh) return;
      const old = Array.isArray(object.material) ? object.material : [object.material];
      old.forEach(material => material.dispose());
      object.material = chrome;
      // Texture seams split coincident vertices in the source mesh. Weld the
      // untextured surface before smoothing so polished highlights stay continuous.
      object.geometry.deleteAttribute('normal');
      const smooth = mergeVertices(object.geometry, .0001);
      smooth.computeVertexNormals();
      object.geometry.dispose();
      object.geometry = smooth;
    });
    // This leaf lies on its XZ plane. Stand it up once; the glTF remains Y-up.
    leaf.rotation.x = Math.PI / 2;
    leaf.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(leaf);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 3.55 / Math.max(size.y, size.x, .001);
    leaf.scale.setScalar(scale);
    leaf.position.copy(center).multiplyScalar(-scale);
    art.add(leaf);

    // Sparse orbits and field points share the same perspective as the leaf.
    const orbitMaterial = new THREE.LineBasicMaterial({ color: '#92c9b5', transparent: true, opacity: .16 });
    const ring = (radius, tilt, offset) => {
      const vertices = [];
      for (let i = 0; i < 160; i++) {
        const angle = i / 160 * Math.PI * 2;
        vertices.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
      }
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(vertices), orbitMaterial);
      line.rotation.set(tilt, offset, -.22);
      line.position.z = -.45;
      scene.add(line);
      return line;
    };
    const orbitA = ring(2.28, .8, .26);
    const orbitB = ring(2.55, -.5, -.55);
    const count = compact.matches ? 36 : 72;
    const pointsArray = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996323;
      const radius = 1.7 + ((i * 37) % 100) / 100 * 1.8;
      pointsArray[i * 3] = Math.cos(angle) * radius;
      pointsArray[i * 3 + 1] = Math.sin(angle) * radius * .85;
      pointsArray[i * 3 + 2] = -1 + ((i * 17) % 40) / 25;
    }
    const fieldGeometry = new THREE.BufferGeometry();
    fieldGeometry.setAttribute('position', new THREE.BufferAttribute(pointsArray, 3));
    const field = new THREE.Points(fieldGeometry, new THREE.PointsMaterial({ color: '#c4eedc', transparent: true, opacity: .46, size: .016, sizeAttenuation: true, depthWrite: false }));
    scene.add(field);

    resizeScene = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      const maxRatio = compact.matches ? 1.3 : 1.6;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 1 ? 8.8 : 8.1;
      camera.updateProjectionMatrix();
    };
    renderScene = (time, progress, cursor) => {
      const drift = reduced.matches ? 0 : Math.sin(time * .45) * .07;
      art.rotation.set(.08 + cursor.y * .09 + progress * .32, -.3 + cursor.x * .22 + progress * 1.05, Math.PI - .33 + Math.sin(time * .2) * .025 - progress * .26);
      art.position.set(cursor.x * .09 + progress * .12, drift + progress * .4, 0);
      const scale = 1 - progress * .06;
      art.scale.setScalar(scale);
      orbitA.rotation.z = -.22 + time * .015 + progress * .4;
      orbitB.rotation.z = .45 - time * .012 - progress * .25;
      field.rotation.z = time * .009 + progress * .08;
      field.position.set(cursor.x * -.055, cursor.y * .055, 0);
      camera.position.x = cursor.x * .05;
      camera.position.y = .04 - cursor.y * .04;
      camera.lookAt(0, .02, 0);
      renderer.render(scene, camera);
    };
    resizeScene();
    updateScroll();
    scrollProgress = targetScroll;
    if (!contextLost) {
      renderScene(elapsed, scrollProgress, pointer);
      canvas.style.visibility = '';
      stage.dataset.sceneState = 'ready';
      stage.dataset.sceneReady = 'true';
    }
    syncMotion();
  }

  updateScroll();
  buildScene().catch(fallback);
})();
