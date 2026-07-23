// preview.js — three.js scene: per-color meshes, orbit controls, optional Z-section clipping.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

let renderer, scene, camera, controls, group;
let clipPlane = null;

export function initPreview(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.localClippingEnabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  camera.position.set(0, -120, 90);
  camera.up.set(0, 0, 1);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8c4d6, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(60, -80, 120);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  dir2.position.set(-80, 40, 40);
  scene.add(dir2);

  group = new THREE.Group();
  scene.add(group);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();
}

// parts: [{tris: number[], color: '#rrggbb'}]
export function setParts(parts, fit = true) {
  for (const child of [...group.children]) {
    child.geometry.dispose();
    child.material.dispose();
    group.remove(child);
  }
  const box = new THREE.Box3();
  for (const p of parts) {
    if (!p.tris.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.tris), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: p.color, roughness: 0.55, metalness: 0.02,
      clippingPlanes: clipPlane ? [clipPlane] : [],
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
  }
  if (fit && !box.isEmpty()) fitCamera(box);
}

function fitCamera(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  center.x += size.x * 0.16; // keep the model clear of the right-hand control panel
  const radius = Math.max(size.x, size.y, size.z, 10) * 0.62;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect);
  controls.target.copy(center);
  camera.position.set(center.x, center.y - dist * 0.82, center.z + dist * 0.72);
  camera.near = dist / 50;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
}

// Recolor existing meshes without rebuilding geometry (parts are in color order).
export function setPartColors(colors) {
  group.children.forEach((child, i) => {
    if (colors[i]) child.material.color.set(colors[i]);
  });
}

// debug helpers (console only)
window.__camTop = () => {
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  const h = (Math.max(box.getSize(new THREE.Vector3()).x, 30) * 1.15) / Math.min(1, camera.aspect);
  controls.target.copy(c);
  camera.position.set(c.x, c.y, h);
  camera.updateProjectionMatrix();
};

// z = null to disable; otherwise show only geometry below z (mm)
export function setSectionZ(z) {
  clipPlane = z == null ? null : new THREE.Plane(new THREE.Vector3(0, 0, -1), z);
  for (const child of group.children) {
    child.material.clippingPlanes = clipPlane ? [clipPlane] : [];
    child.material.needsUpdate = true;
  }
}
