// BLVCK OAK holographic voice HUD (module). Loaded on the home page only.
//
// Security rules this file follows:
//  - Spoken, typed and model text is data. It is only ever put on screen with textContent.
//  - Nothing here navigates, submits forms, calls site APIs with that text, or runs it.
//  - The Ollama call exists only for a signed-in owner, goes to one fixed loopback address,
//    and only starts when the owner presses a button. Speech never auto-sends.
//  - Nothing is stored: no localStorage, sessionStorage, cookies or analytics events.
//  - Microphone audio is only used for a level meter. Captions run on this device when the
//    browser can, and the browser's online speech service needs an explicit click first.
import * as THREE from './vendor/three.module.min.js';
import {
  OLLAMA_CHAT_URL, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS,
  buildOllamaRequest, extractReply, createRateGate, normaliseInput,
} from './voice-hud-core.js';

const STATE_LABEL = { standby: 'STANDBY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING' };
const BAR_COUNT = 18;
const SVG_NS = 'http://www.w3.org/2000/svg';

const VERTEX = `
  uniform float time; uniform float level;
  varying vec3 vN; varying vec3 vW;
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  void main(){
    float d=snoise(position*2.0+time*0.5)*(0.14+level*0.5);
    vec4 w=modelMatrix*vec4(position+normal*d,1.0);
    vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal);
    gl_Position=projectionMatrix*viewMatrix*w;
  }`;
const FRAGMENT = `
  uniform vec3 color; uniform float level;
  varying vec3 vN; varying vec3 vW;
  void main(){
    vec3 n=normalize(vN);
    float diff=max(dot(n,normalize(vec3(0.0,0.0,5.0)-vW)),0.0);
    float fres=pow(1.0-max(dot(n,normalize(cameraPosition-vW)),0.0),2.0);
    vec3 c=color*(0.25+diff)+color*fres*(0.5+level);
    gl_FragColor=vec4(c*0.5,clamp(0.3+diff*0.4+fres*0.6,0.0,1.0)*0.55);
  }`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick, pressable = false) {
  const b = el('button', 'vhud-btn', label);
  b.type = 'button';
  if (pressable) b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', onClick);
  return b;
}

function buildScene(mount, levelRef) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = () => [Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight)];
  const [w, h] = size();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 100);
  camera.position.z = 3;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);
  const geometry = new THREE.IcosahedronGeometry(1.2, 28);
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, level: { value: 0 }, color: { value: new THREE.Color().setHSL(46 / 360, 0.65, 0.52) } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    wireframe: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  let frame = 0; let smooth = 0; let time = 0; let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    smooth += (levelRef.value - smooth) * 0.18;
    time += dt * (reduce ? 0.1 : 0.3 + smooth * 1.6);
    material.uniforms.time.value = time;
    material.uniforms.level.value = reduce ? 0 : smooth;
    if (!reduce) { mesh.rotation.y += dt * (0.03 + smooth * 0.25); mesh.rotation.x += dt * 0.012; }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const ro = new ResizeObserver(() => {
    const [nw, nh] = size();
    camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
  });
  ro.observe(mount);
  return () => {
    cancelAnimationFrame(frame); ro.disconnect();
    geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

function ring() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const circle = (r, cls, stroke, op, w, dash) => {
    const g = document.createElementNS(SVG_NS, 'g');
    if (cls) g.setAttribute('class', cls);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-opacity', String(op)); c.setAttribute('stroke-width', String(w));
    if (dash) c.setAttribute('stroke-dasharray', dash);
    g.appendChild(c); return g;
  };
  svg.append(circle(47, 'vhud-ring-a', '#D4AF37', 0.55, 0.5, '2 3.2'), circle(42, 'vhud-ring-b', '#F3E5AB', 0.35, 0.4, '14 6 3 6'), circle(49, '', '#D4AF37', 0.25, 0.3));
  return svg;
}

function mount() {
  const levelRef = { value: 0 };
  let open = false; let stopScene = null; let state = 'standby';
  let micCleanup = null; let micOn = false;
  let recognition = null; let wantCaptions = false; let captionsOn = false;
  let isOwner = false; let ownerChecked = false;
  let lastCaption = '';
  const gate = createRateGate();
  let speakingUntil = 0;
  let uiLoop = 0;

  const launch = button('VOICE HUD', () => setOpen(true));
  launch.className = 'vhud-launch';
  launch.setAttribute('aria-label', 'Open holographic voice HUD');

  const panel = el('aside', 'vhud');
  panel.hidden = true;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Holographic voice HUD');
  for (const c of ['tl', 'tr', 'bl', 'br']) panel.appendChild(el('span', `vhud-corner ${c}`));

  const head = el('div', 'vhud-head');
  const close = el('button', 'vhud-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close voice HUD');
  close.addEventListener('click', () => setOpen(false));
  head.append(el('span', 'vhud-title', 'HERMES // VOICE LINK'), close);

  const orb = el('div', 'vhud-orb');
  const canvasBox = el('div', 'vhud-canvas'); canvasBox.setAttribute('aria-hidden', 'true');
  orb.append(canvasBox, el('div', 'vhud-scan'), ring());

  const body = el('div', 'vhud-body');
  const bars = el('div', 'vhud-bars'); bars.setAttribute('aria-hidden', 'true');
  const barEls = Array.from({ length: BAR_COUNT }, () => bars.appendChild(document.createElement('span')));
  const stateEl = el('p', 'vhud-state', STATE_LABEL.standby); stateEl.setAttribute('aria-live', 'polite');

  const micBtn = button('Use mic', () => (micOn ? stopMic() : startMic()), true);
  const demoBtn = button('Demo voice', () => demoVoice(), true);
  const row = el('div', 'vhud-row'); row.append(micBtn, demoBtn);
  const capBtn = button('Show what I say', () => (captionsOn || wantCaptions ? stopCaptions() : startCaptions(false)), true);

  const log = el('div', 'vhud-log'); log.hidden = true;
  log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Live captions and replies');
  const notice = el('div', 'vhud-notice'); notice.hidden = true;
  const error = el('p', 'vhud-error'); error.hidden = true; error.setAttribute('role', 'status');
  const fine = el('p', 'vhud-fine', 'The microphone level is read in this tab and nothing is recorded or stored. Captions run on this device unless you allow the online speech service.');

  // Owner-only Ask Hermes. Built only after the server confirms the signed-in owner.
  const ownerBox = el('div', 'vhud-owner'); ownerBox.hidden = true;
  const ownerLabel = el('label', '', 'ASK HERMES (LOCAL OLLAMA)'); ownerLabel.htmlFor = 'vhud-ask';
  const ask = document.createElement('textarea'); ask.id = 'vhud-ask'; ask.maxLength = 400; ask.rows = 2;
  ask.setAttribute('autocomplete', 'off'); ask.setAttribute('spellcheck', 'true');
  const sendBtn = button('Send to Hermes', () => sendToHermes(ask.value));
  const sendCapBtn = button('Send last thing I said', () => { if (lastCaption) sendToHermes(lastCaption); });
  ownerBox.append(ownerLabel, ask, sendBtn, sendCapBtn);

  body.append(bars, stateEl, row, capBtn, log, notice, error, ownerBox, fine);
  panel.append(head, orb, body);
  document.body.append(launch, panel);

  function setState(next) { state = next; stateEl.textContent = STATE_LABEL[next]; }
  function showError(msg) { error.textContent = msg || ''; error.hidden = !msg; }
  function showNotice(msg, action) {
    notice.textContent = msg || '';
    if (msg && action) { const b = button(action.label, action.run); notice.appendChild(b); }
    notice.hidden = !msg;
  }
  function logLine(text, cls = '') {
    log.hidden = false;
    const p = el('p', cls);
    p.appendChild(el('span', 'mark', '> '));
    p.appendChild(document.createTextNode(text)); // text node: never parsed as markup
    log.appendChild(p);
    while (log.children.length > 8) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    return p;
  }

  async function checkOwner() {
    if (ownerChecked) return;
    ownerChecked = true;
    try {
      const response = await fetch('/.netlify/functions/voice-hud-session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        isOwner = data && data.owner === true;
      }
    } catch { isOwner = false; }
    ownerBox.hidden = !isOwner;
  }

  async function startMic() {
    showError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        levelRef.value = Math.min(1, Math.sqrt(sum / data.length) * 4);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      micCleanup = () => { cancelAnimationFrame(frame); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); levelRef.value = 0; };
      micOn = true; micBtn.setAttribute('aria-pressed', 'true'); micBtn.textContent = 'Mute mic';
      setState('listening');
    } catch (e) {
      showError(e && e.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in the browser to use the mic.' : 'Microphone unavailable here. Try the demo voice instead.');
    }
  }
  function stopMic() {
    micCleanup?.(); micCleanup = null; micOn = false;
    micBtn.setAttribute('aria-pressed', 'false'); micBtn.textContent = 'Use mic';
    if (state === 'listening') setState('standby');
  }

  function Recognition() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  async function startCaptions(allowCloud) {
    const Ctor = Recognition();
    if (!Ctor) { showError('Captions are not supported in this browser. Try Chrome or Edge.'); return; }
    showError(''); showNotice('');
    const rec = new Ctor();
    rec.lang = 'en-AU'; rec.continuous = true; rec.interimResults = true;
    if (!allowCloud) {
      let local = false;
      try { local = typeof Ctor.available === 'function' && (await Ctor.available({ langs: ['en-AU'], processLocally: true })) === 'available'; } catch { local = false; }
      if (!local) {
        showNotice('On-device captions are not available in this browser. The online speech service sends your audio to the browser vendor.', { label: 'Allow the online speech service', run: () => startCaptions(true) });
        return;
      }
      rec.processLocally = true;
    }
    let interimEl = null;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const text = normaliseInput(r[0].transcript);
        if (r.isFinal) { if (text) { interimEl?.remove(); interimEl = null; lastCaption = text; logLine(text); } } else live += `${text} `;
      }
      live = live.trim();
      if (live) { if (!interimEl) interimEl = logLine(live, 'interim'); else interimEl.lastChild.textContent = live; }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wantCaptions = false;
      showError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone blocked. Allow it in the browser to use captions.' : 'Captions stopped.');
    };
    rec.onend = () => {
      if (wantCaptions) { try { rec.start(); return; } catch { /* stopped below */ } }
      captionsOn = false; capBtn.setAttribute('aria-pressed', 'false'); capBtn.textContent = 'Show what I say';
    };
    wantCaptions = true; recognition = rec;
    try {
      rec.start(); captionsOn = true;
      capBtn.setAttribute('aria-pressed', 'true'); capBtn.textContent = 'Hide what I say';
      if (!micOn) startMic();
      logLine('Listening. Start speaking.', 'interim');
    } catch { showError('Captions could not start.'); }
  }
  function stopCaptions() {
    wantCaptions = false; captionsOn = false;
    try { recognition?.abort(); } catch { /* already stopped */ }
    recognition = null;
    capBtn.setAttribute('aria-pressed', 'false'); capBtn.textContent = 'Show what I say';
  }

  function demoVoice() {
    if (state === 'speaking') { speechSynthesis?.cancel(); speakingUntil = 0; setState(micOn ? 'listening' : 'standby'); demoBtn.setAttribute('aria-pressed', 'false'); return; }
    speak('Hermes online. Voice link ready.');
  }
  function speak(text) {
    setState('speaking'); demoBtn.setAttribute('aria-pressed', 'true');
    speakingUntil = performance.now() + 5000;
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.pitch = 0.8;
        u.onend = () => { speakingUntil = 0; };
        u.onerror = () => { speakingUntil = performance.now() + 3500; };
        speechSynthesis.cancel(); speechSynthesis.speak(u);
        speakingUntil = performance.now() + 14000;
      }
    } catch { speakingUntil = performance.now() + 3500; }
  }

  async function sendToHermes(raw) {
    showError('');
    if (!isOwner) return; // defence in depth: the control is hidden for everyone else
    const body = buildOllamaRequest(raw);
    if (!body) { showError('Type something to send.'); return; }
    const entry = gate.tryEnter();
    if (!entry.ok) { showError(entry.reason === 'limit' ? 'Too many requests this minute. Wait a moment.' : 'Hermes is still busy. Wait a moment.'); return; }
    logLine(`You: ${normaliseInput(raw)}`);
    setState('thinking');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OLLAMA_CHAT_URL, {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new Error('status');
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('too-large');
      const reply = extractReply(JSON.parse(text));
      if (!reply) throw new Error('empty');
      logLine(reply, 'reply');
      speak(reply); // spoken aloud, never executed
    } catch {
      setState(micOn ? 'listening' : 'standby');
      showError('Ollama did not answer. Start Ollama, load the model, and allow this site with OLLAMA_ORIGINS.');
    } finally {
      clearTimeout(timer); gate.leave();
    }
  }

  function startUiLoop() {
    const t0 = performance.now();
    const loop = (now) => {
      if (state === 'speaking' && speakingUntil && now > speakingUntil) { speakingUntil = 0; demoBtn.setAttribute('aria-pressed', 'false'); setState(micOn ? 'listening' : 'standby'); }
      if (state === 'speaking' && !speakingUntil) { demoBtn.setAttribute('aria-pressed', 'false'); setState(micOn ? 'listening' : 'standby'); }
      if (!micOn) {
        const t = (now - t0) / 1000; let target = 0.04;
        if (state === 'thinking') target = 0.22 + Math.sin(t * 2.4) * 0.1;
        if (state === 'speaking') target = 0.18 + Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1)) * 0.6;
        levelRef.value += (target - levelRef.value) * 0.2;
      }
      barEls.forEach((bar, i) => {
        const wave = 0.5 + 0.5 * Math.sin(now / 160 + i * 0.7);
        bar.style.height = `${8 + Math.min(1, levelRef.value * 1.6) * wave * 34 + (i % 3) * 1.5}px`;
      });
      uiLoop = requestAnimationFrame(loop);
    };
    uiLoop = requestAnimationFrame(loop);
  }

  function setOpen(next) {
    open = next; panel.hidden = !next; launch.hidden = next;
    if (next) {
      stopScene = buildScene(canvasBox, levelRef);
      startUiLoop(); void checkOwner(); close.focus();
    } else {
      cancelAnimationFrame(uiLoop); stopScene?.(); stopScene = null;
      stopCaptions(); stopMic(); speechSynthesis?.cancel?.();
      // Nothing is kept once the HUD closes.
      log.replaceChildren(); log.hidden = true; ask.value = ''; lastCaption = '';
      showError(''); showNotice(''); setState('standby'); launch.focus();
    }
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
