// preview.js — product-photo staging for the generated charm.
// RoomEnvironment IBL + ACES, canvas contact shadow, telephoto framing with view
// presets, idle turntable, and a one-shot joint wiggle that shows the articulation.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

let renderer, scene, camera, controls, group, shadowMesh, shadowTex;
let clipPlane = null;
let lastInteraction = 0;
let wiggleT = -1;          // 0..1 while the joint wiggle runs
let settleT = -1;          // 0..1 while the settle scale-in runs
let pieceGroups = [];      // [{group, pivot|null}]
const reducedMotion = typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initPreview(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
  camera.up.set(0, 0, 1);
  camera.position.set(40, -120, 80);

  // gentle key + rim on top of the IBL (kept low)
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(60, -80, 120);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.25);
  rim.position.set(-80, 40, 60);
  scene.add(rim);

  group = new THREE.Group();
  scene.add(group);

  // contact shadow: radial-gradient canvas on a ground plane
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 126);
  grad.addColorStop(0, 'rgba(20,24,34,0.30)');
  grad.addColorStop(0.65, 'rgba(20,24,34,0.10)');
  grad.addColorStop(1, 'rgba(20,24,34,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  shadowTex = new THREE.CanvasTexture(c);
  shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 })
  );
  shadowMesh.position.z = -0.05;
  scene.add(shadowMesh);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minPolarAngle = THREE.MathUtils.degToRad(22.5);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(157.5);
  const bump = () => { lastInteraction = performance.now(); };
  canvas.addEventListener('pointerdown', bump);
  canvas.addEventListener('wheel', bump, { passive: true });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  let prevT = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - prevT) / 1000);
    prevT = now;

    // idle turntable (3s after last interaction, ~10°/s)
    if (!reducedMotion && now - lastInteraction > 3000 && wiggleT < 0 && settleT < 0) {
      const a = THREE.MathUtils.degToRad(10) * dt;
      const t = controls.target;
      camera.position.sub(t).applyAxisAngle(new THREE.Vector3(0, 0, 1), a).add(t);
    }

    // settle: scale 0.96 → 1 with ease-out, shadow fades in alongside
    if (settleT >= 0) {
      settleT = Math.min(1, settleT + dt / 0.22);
      const e = 1 - Math.pow(1 - settleT, 3);
      const s = 0.96 + 0.04 * e;
      group.scale.setScalar(s);
      shadowMesh.material.opacity = e;
      if (settleT >= 1) settleT = -1;
    }

    // one-shot joint wiggle (shows that the letters articulate)
    if (wiggleT >= 0) {
      wiggleT = Math.min(1, wiggleT + dt / 1.15);
      const env = Math.sin(Math.PI * wiggleT);                 // ease in-out envelope
      const phase = Math.sin(wiggleT * Math.PI * 3);
      pieceGroups.forEach((pg, i) => {
        if (!pg.pivot) return;
        pg.group.rotation.z = THREE.MathUtils.degToRad(6) * env * phase * (i % 2 ? -1 : 1);
      });
      if (wiggleT >= 1) {
        pieceGroups.forEach((pg) => (pg.group.rotation.z = 0));
        wiggleT = -1;
      }
    }

    controls.update();
    renderer.render(scene, camera);
  })(prevT);
}

// result: { colors: Float32Array[], pieces, joints } ; colorHex: state colors
export function setParts(result, colorHex, opts = {}) {
  for (const pg of pieceGroups) {
    pg.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    group.remove(pg.group);
  }
  pieceGroups = [];
  const colors = result?.colors || [];
  const pieces = result?.pieces || [];
  const joints = result?.joints || [];
  if (!colors.length) { shadowMesh.material.opacity = 0; return; }

  const box = new THREE.Box3();
  pieces.forEach((piece, pi) => {
    const j = joints.find((jj) => jj.right === pi);
    const pivot = piece.isLetter && j ? { x: j.x, y: j.y } : null;
    const g = new THREE.Group();
    if (pivot) g.position.set(pivot.x, pivot.y, 0);
    for (const r of piece.ranges) {
      const geo = new THREE.BufferGeometry();
      const sub = colors[r.color].subarray(r.start, r.start + r.count);
      geo.setAttribute('position', new THREE.BufferAttribute(sub, 3));
      geo.computeVertexNormals();
      if (pivot) geo.translate(-pivot.x, -pivot.y, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex[r.color] ?? '#cccccc',
        roughness: 0.42, metalness: 0.0,
        envMapIntensity: 0.9,
        clippingPlanes: clipPlane ? [clipPlane] : [],
        side: THREE.DoubleSide,
      });
      mat.userData.colorIdx = r.color;
      const mesh = new THREE.Mesh(geo, mat);
      g.add(mesh);
      geo.computeBoundingBox();
      const b = geo.boundingBox.clone();
      if (pivot) b.translate(new THREE.Vector3(pivot.x, pivot.y, 0));
      box.union(b);
    }
    group.add(g);
    pieceGroups.push({ group: g, pivot });
  });

  // stage the shadow under the model
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  shadowMesh.scale.set(Math.max(size.x, 20) * 1.5, Math.max(size.y, 20) * 2.6, 1);
  shadowMesh.position.set(center.x, center.y, -0.05);

  if (opts.fit !== false) fitToBox(box);
  group.scale.setScalar(0.96);
  settleT = 0;
  if (!reducedMotion && opts.wiggle !== false) wiggleT = 0;
}

function fitToBox(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y * 1.6, size.z, 12) * 0.575; // 15% padding
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect);
  controls.target.copy(center);
  // model-viewer-ish default orbit: azimuth ~30°, polar ~75°
  const az = THREE.MathUtils.degToRad(30), pol = THREE.MathUtils.degToRad(75);
  camera.position.set(
    center.x + dist * Math.sin(pol) * Math.sin(az),
    center.y - dist * Math.sin(pol) * Math.cos(az),
    center.z + dist * Math.cos(pol)
  );
  camera.near = Math.max(0.5, dist / 60);
  camera.far = dist * 30;
  camera.updateProjectionMatrix();
  lastInteraction = performance.now();
}

// view presets: 'front' | 'top' | 'iso' | 'fit'
export function setView(kind) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y * 1.6, size.z, 12) * 0.575;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect);
  controls.target.copy(center);
  if (kind === 'front')      camera.position.set(center.x, center.y - dist, center.z + dist * 0.05);
  else if (kind === 'top')   camera.position.set(center.x, center.y - dist * 0.001, center.z + dist);
  else if (kind === 'iso')   camera.position.set(center.x + dist * 0.5, center.y - dist * 0.75, center.z + dist * 0.55);
  else { fitToBox(box); return; }
  lastInteraction = performance.now();
}

export function setDimmed(on) {
  renderer.domElement.classList.toggle('dimmed', on);
}

export function setPartColors(colors) {
  for (const pg of pieceGroups) {
    pg.group.traverse((o) => {
      if (o.isMesh && colors[o.material.userData.colorIdx]) {
        o.material.color.set(colors[o.material.userData.colorIdx]);
      }
    });
  }
}

// debug helper (console only)
window.__camTop = () => setView('top');

// z = null to disable; otherwise show only geometry below z (mm)
export function setSectionZ(z) {
  clipPlane = z == null ? null : new THREE.Plane(new THREE.Vector3(0, 0, -1), z);
  group.traverse((o) => {
    if (o.isMesh) {
      o.material.clippingPlanes = clipPlane ? [clipPlane] : [];
      o.material.needsUpdate = true;
    }
  });
}
