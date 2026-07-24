// wire3d.js — true-3D wire shapes inside the Z-slab representation.
// A wire path is approximated by a dense chain of spheres; each Z slab sections the
// spheres into circles (r' = √(r² − dz²)) whose union is the slab's 2D footprint.
// Surface ripple ≤ spacing²/(8r) — with 0.5mm spacing on r≥0.65 wire that is <0.05mm.

import * as G from './geom.js';

// points: [{x,y,z}] wire centerline (mm), r: wire radius (mm).
// Returns bandAdds: [{z0,z1,paths}] with band height hs covering the wire's z-extent.
export function sphereChainBands(points, r, hs = 0.3) {
  let zMin = Infinity, zMax = -Infinity;
  for (const p of points) {
    if (p.z - r < zMin) zMin = p.z - r;
    if (p.z + r > zMax) zMax = p.z + r;
  }
  zMin = Math.max(0, Math.floor(zMin / hs) * hs);
  const bands = [];
  for (let z0 = zMin; z0 < zMax - 1e-9; z0 += hs) {
    const z1 = Math.min(z0 + hs, zMax);
    const zm = (z0 + z1) / 2;
    const circles = [];
    for (const p of points) {
      const dz = Math.abs(p.z - zm);
      if (dz >= r) continue;
      const rr = Math.sqrt(r * r - dz * dz);
      if (rr < 0.12) continue;
      circles.push(...G.circle(p.x, p.y, rr, 20));
    }
    if (!circles.length) continue;
    bands.push({ z0, z1, paths: G.clean(G.unionAll(circles)) });
  }
  return bands;
}

// Racetrack-oval link centerline in its own plane, tilted about the X axis.
// L×W outer dims measured over the WIRE CENTERLINE + wire diameter happens outside.
// cx: link center x, cy: chain centerline y, tiltRad: rotation about x-axis,
// zc: z of link center. Returns [{x,y,z}] sampled every ~step mm.
export function ovalLinkPath(cx, cy, zc, Lc, Wc, tiltRad, step = 0.45) {
  const hl = Math.max(0.01, (Lc - Wc) / 2); // straight half-length
  const R = Wc / 2;
  const seg = [];
  // one straight + cap, mirrored (parameterize by arc length around the racetrack)
  const straight = 2 * hl, cap = Math.PI * R;
  const total = 2 * straight + 2 * cap;
  const n = Math.max(16, Math.ceil(total / step));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    let u, v; // in-plane coords (u along chain axis, v across)
    if (s < straight) { u = -hl + s; v = R; }
    else if (s < straight + cap) { const a = (s - straight) / R; u = hl + R * Math.sin(a); v = R * Math.cos(a); }
    else if (s < 2 * straight + cap) { u = hl - (s - straight - cap); v = -R; }
    else { const a = (s - 2 * straight - cap) / R; u = -hl - R * Math.sin(a); v = -R * Math.cos(a); }
    // tilt about the x (chain) axis: v spans y/z
    seg.push({
      x: cx + u,
      y: cy + v * Math.cos(tiltRad),
      z: zc + v * Math.sin(tiltRad),
    });
  }
  return seg;
}

// Minimum distance between two polyline point sets (for clearance QA).
export function minPointDist(a, b) {
  let best = Infinity;
  for (const p of a) for (const q of b) {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
