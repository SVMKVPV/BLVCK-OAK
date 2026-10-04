/**
 * BLVCK-OAK — cinematic-intro.js v2.0
 * Professional 3D Oak System | Three.js r160 + WebGL2
 * Drop-in replacement for /cinematic-intro.js
 * 
 * Author: BLVCK OAK Upgrade Kit
 * Stack: Three.js, L-System, PBR, InstancedMesh, Volumetric Fog
 */

// --- IMPORTMAP (add to <head>) ---
// <script type="importmap">
// {
//   "imports": {
//     "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
//     "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
//   }
// }
// </script>

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class RealisticOak {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.barkMaterial = null;
    this.leafMaterial = null;
    this.leaves = null;
    this.branchMeshes = [];
    this.growthFactor = 0.01; // 0 -> ash, 1 -> full
    this.initMaterials();
    this.generateLSystem({
      axiom: 'X',
      rules: { 'X': 'F-[[X]+X]+F[+FX]-X', 'F': 'FF' },
      iterations: 5,
      angle: 25 * Math.PI / 180,
      length: 0.28,
      decay: 0.72
    });
    this.initLeaves();
    this.initGround();
    scene.add(this.group);
  }

  initMaterials() {
    const texLoader = new THREE.TextureLoader();
    
    // --- BARK PBR ---
    const barkNormal = texLoader.load('https://threejs.org/examples/textures/brick_bump.jpg');
    const barkRoughness = texLoader.load('https://threejs.org/examples/textures/terrain/grasslight-big.jpg');
    barkNormal.wrapS = barkNormal.wrapT = THREE.RepeatWrapping;
    
    this.barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      roughness: 0.85,
      metalness: 0.02,
      normalMap: barkNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: barkRoughness,
      envMapIntensity: 0.35
    });

    // --- LEAF SSS MATERIAL ---
    const leafAlpha = texLoader.load('/assets/oak-leaf-alpha.png');
    this.leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a4a18,
      emissive: 0x11200a,
      emissiveIntensity: 0.15,
      roughness: 0.45,
      metalness: 0.0,
      side: THREE.DoubleSide,
      alphaMap: leafAlpha,
      transparent: true,
      alphaTest: 0.5,
      // Fake SSS via emissive + transmission
    });
    this.leafMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `float sss = pow(dot(vNormal, vec3(0.0, 1.0, 0.0)), 2.0) * 0.35;
          gl_FragColor.rgb += sss * vec3(0.4, 0.7, 0.2);
          #include <dithering_fragment>`
      );
    };
  }

  // L-SYSTEM BRANCHING WITH TAPER
  generateLSystem(params) {
    let str = params.axiom;
    for(let i=0;i<params.iterations;i++){
      let next='';
      for(let c of str) next += params.rules[c] || c;
      str = next;
    }

    const stack = [];
    let pos = new THREE.Vector3(0,0,0);
    let dir = new THREE.Vector3(0,1,0);
    let depth = 0;
    let thickness = 0.22;

    const branch = (start, end, r) => {
      const h = start.distanceTo(end);
      const geo = new THREE.CylinderGeometry(r*0.62, r, h, 8);
      geo.translate(0, h/2, 0);
      const mesh = new THREE.Mesh(geo, this.barkMaterial);
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), 
        new THREE.Vector3().subVectors(end,start).normalize());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.branchMeshes.push({ mesh, baseScale: h, depth });
      
      // Collect leaf points at terminal branches
      if(depth > 3 && Math.random() > 0.3) this.leafPoints.push(end.clone());
    };

    this.leafPoints = [];
    let quaternion = new THREE.Quaternion();

    for(let c of str){
      if(c==='F'){
        const next = pos.clone().add(dir.clone().multiplyScalar(params.length * Math.pow(params.decay, depth)));
        branch(pos, next, thickness * Math.pow(0.72, depth));
        pos.copy(next);
      } else if(c==='+'){
        const axis = new THREE.Vector3(0,0,1);
        quaternion.setFromAxisAngle(axis, params.angle + (Math.random()-0.5)*0.2);
        dir.applyQuaternion(quaternion);
      } else if(c==='-'){
        const axis = new THREE.Vector3(0,0,1);
        quaternion.setFromAxisAngle(axis, -params.angle + (Math.random()-0.5)*0.2);
        dir.applyQuaternion(quaternion);
      } else if(c==='['){
        stack.push({ pos: pos.clone(), dir: dir.clone(), depth, thickness });
        depth++; thickness *= 0.7;
      } else if(c===']'){
        const s = stack.pop();
        pos.copy(s.pos); dir.copy(s.dir); depth=s.depth; thickness=s.thickness;
      }
    }
  }

  initLeaves() {
    const leafGeo = new THREE.PlaneGeometry(0.18, 0.22);
    const count = 3000;
    this.leaves = new THREE.InstancedMesh(leafGeo, this.leafMaterial, count);
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leaves.castShadow = true;
    this.leaves.frustumCulled = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    
    for(let i=0;i<count;i++){
      const p = this.leafPoints[i % this.leafPoints.length]
        .clone()
        .add(new THREE.Vector3(
          (Math.random()-0.5)*0.6,
          (Math.random()-0.5)*0.4,
          (Math.random()-0.5)*0.6
        ));
      dummy.position.copy(p);
      dummy.rotation.set(
        Math.random()*Math.PI,
        Math.random()*Math.PI,
        Math.random()*Math.PI
      );
      const s = 0.8 + Math.random()*0.6;
      dummy.scale.set(s,s,s);
      dummy.updateMatrix();
      this.leaves.setMatrixAt(i, dummy.matrix);
      
      // Variant green
      color.setHSL(0.28 + Math.random()*0.08, 0.6, 0.25 + Math.random()*0.2);
      this.leaves.setColorAt(i, color);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    if(this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
    this.group.add(this.leaves);
  }

  initGround() {
    const geo = new THREE.CircleGeometry(8, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d0f0a,
      roughness: 0.95,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Moss detail plane
    const mossGeo = new THREE.CircleGeometry(3.2, 32);
    const mossMat = new THREE.MeshStandardMaterial({
      color: 0x1e2f15, roughness: 1.0, emissive: 0x0a1a05, emissiveIntensity: 0.12
    });
    const moss = new THREE.Mesh(mossGeo, mossMat);
    moss.rotation.x = -Math.PI/2;
    moss.position.y = 0.01;
    moss.receiveShadow = true;
    this.group.add(moss);
  }

  // SCROLL GROWTH 0->1
  setGrowth(t) {
    this.growthFactor = THREE.MathUtils.clamp(t, 0.01, 1);
    this.group.scale.setScalar(this.growthFactor);
    this.barkMaterial.opacity = this.growthFactor;
    // Leaves fade in later
    if(this.leaves) this.leaves.material.opacity = THREE.MathUtils.clamp((t-0.45)*2.2, 0, 1);
  }

  // FIRE -> ASH PRESERVED IN 3D
  triggerAsh() {
    this.barkMaterial.color.set(0x0a0a0a);
    this.leafMaterial.color.set(0x2a2a2a);
    // particle leaves will handle falling
  }
}

export default class CinematicIntro {
  constructor(containerId = '#oak-canvas') {
    this.container = document.querySelector(containerId);
    this.init();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050508, 0.035);
    this.scene.background = new THREE.Color(0x050508);

    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth/window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.8, 6.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // LIGHTING — STUDIO LUXURY
    const ambient = new THREE.AmbientLight(0x404050, 0.25);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(3, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048,2048);
    key.shadow.bias = -0.0001;
    key.shadow.radius = 8;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xc9a86a, 0.8);
    rim.position.set(-2, 3, -3);
    this.scene.add(rim);

    // HDRI ENV (placeholder)
    // new RGBELoader().load('/assets/studio.hdr', (tex)=>{...})

    this.oak = new RealisticOak(this.scene);

    // VOLUMETRIC PARTICLES — falling website leaves concept
    this.initParticles();

    // SCROLL DRIVEN
    this.scrollT = 0;
    window.addEventListener('scroll', () => {
      const max = document.body.scrollHeight - window.innerHeight;
      this.scrollT = window.scrollY / Math.max(max,1);
      this.oak.setGrowth(THREE.MathUtils.smoothstep(this.scrollT*1.4, 0, 1));
    }, { passive: true });

    this.animate();
    window.addEventListener('resize', () => this.onResize());
  }

  initParticles() {
    const count = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count*3);
    const vel = new Float32Array(count*3);
    for(let i=0;i<count;i++){
      pos[i*3+0] = (Math.random()-0.5)*10;
      pos[i*3+1] = Math.random()*8 + 2;
      pos[i*3+2] = (Math.random()-0.5)*6;
      vel[i*3+1] = -0.002 - Math.random()*0.004;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.userData.vel = vel;
    const mat = new THREE.PointsMaterial({ color: 0xc9a86a, size: 0.04, transparent: true, opacity: 0.6, sizeAttenuation: true });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const time = performance.now()*0.001;

    // Particle drift
    if(this.particles){
      const pos = this.particles.geometry.attributes.position;
      const vel = this.particles.geometry.userData.vel;
      for(let i=0;i<pos.count;i++){
        pos.array[i*3+1] += vel[i*3+1];
        pos.array[i*3+0] += Math.sin(time + i)*0.0008;
        if(pos.array[i*3+1] < 0){ pos.array[i*3+1] = 8; }
      }
      pos.needsUpdate = true;
    }

    this.oak.group.rotation.y = Math.sin(time*0.08)*0.12;
    this.renderer.render(this.scene, this.camera);
  }

  onResize(){
    this.camera.aspect = window.innerWidth/window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Auto-init if #oak-canvas exists
if(typeof window !== 'undefined'){
  document.addEventListener('DOMContentLoaded', () => {
    if(document.querySelector('#oak-canvas')) new CinematicIntro();
  });
}
