// hardware.js v3 — reference-faithful hardware.
//
// - Chain: real tilted-oval-link chain (links alternate ±35° about the chain axis and
//   thread each other), re-modeled after the reference pendant. Built with the
//   sphere-chain sweep (wire3d.js), prints support-free like the reference.
// - Snap ring: outline traced from the reference pendant (hook-and-eye clasp),
//   extruded 3.2mm, with a thin eyelet stub the chain threads.
// - Carabiner: body/gate outlines traced from the reference carabiner (0.8×), gate on
//   our captured-disc pivot (print-in-place). Screw lock re-modeled after the real
//   reference mechanism: a male thread along the GATE AXIS (round core rod + helix
//   lobes, flat-topped by the slab like the reference's 2.5D thread), and a
//   SEPARATELY-printed knurled sleeve with a full-length internal thread. The sleeve
//   screws on over the gate tip; closing the gate aligns tip and body nose, and
//   driving the sleeve forward bridges the junction to lock the gate.
//
// Every hardware piece carries its own zTop (thickness) independent of the letters.

import * as G from './geom.js';
import { anchorCapsule } from './joint.js';
import { sphereChainBands, ovalLinkPath, minPointDist } from './wire3d.js';
import { SNAP_RING, CARABINER } from './hw_templates.js';

function ovalRing(cx, cy, L, W, w) {
  const hl = L / 2 - W / 2;
  const outer = G.capsule(cx - hl, cy, cx + hl, cy, W);
  const inner = G.capsule(cx - hl, cy, cx + hl, cy, W - 2 * w);
  return G.diff(outer, inner);
}

// template loops (mm, centered) → int paths at scale/offset/rotation, nesting resolved
function templatePaths(loops, s, cx, cy, rotRad = 0) {
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
  const paths = loops.map((loop) => loop.map(([x, y]) => {
    const xr = x * cos - y * sin, yr = x * sin + y * cos;
    return { X: G.mm(cx + xr * s), Y: G.mm(cy + yr * s) };
  }));
  return G.normalizeEvenOdd(paths);
}

// ---- chain ------------------------------------------------------------------

export const CHAIN = {
  wireR: 0.65,       // wire radius (Ø1.3)
  Lc: 6.2, Wc: 4.2,  // link centerline dims (outer ≈ 7.5 × 5.5)
  tilt: (35 * Math.PI) / 180,
  pitch: 3.9,
  hs: 0.3,           // slab height for wire sections
};

const chainH = () => CHAIN.Wc * Math.sin(CHAIN.tilt) + 2 * CHAIN.wireR;

// Thin flat eyelet that the first/last links thread. Its bar cross-section (1.5×1.8)
// fits through the links' ~2.9mm inner aperture.
const EYELET = { L: 5.6, W: 3.8, wall: 1.5, T: 1.8 };

function addEyelet(shape, xEdge, cy, dir) {
  const cx = xEdge + dir * (EYELET.L / 2 - 1.0); // overlap 1mm into the parent
  shape.bandAdds.push({ z0: 0, z1: EYELET.T, paths: ovalRing(cx, cy, EYELET.L, EYELET.W, EYELET.wall) });
  return { barX: cx + dir * (EYELET.L / 2 - EYELET.wall / 2), cy };
}

function linkPath(cx, cy, sign) {
  const zc = (CHAIN.Wc / 2) * Math.sin(CHAIN.tilt) + CHAIN.wireR;
  return ovalLinkPath(cx, cy, zc, CHAIN.Lc, CHAIN.Wc, sign * CHAIN.tilt);
}

// ---- public API -------------------------------------------------------------

// Loop tab merged into the first character (strap-friendly; unchanged mechanism).
export function addLoopTab(shape, bbox, T, d) {
  const L = 11, W = 9, w = 2.2;
  const cy = G.toMm((bbox.minY + bbox.maxY) / 2);
  const edge = G.toMm(bbox.minX);
  const cx = edge + 1.4 - L / 2;
  const ring = ovalRing(cx, cy, L, W, w);
  const link = anchorCapsule(shape.base[0], edge, cy, cx + L / 2 - w / 2, cy, W * 0.55);
  shape.base.push(G.unionAll([...ring, ...link]));
  const hl = L / 2 - W / 2;
  shape.bandSubs.push({ z0: 0, z1: T, paths: G.capsule(cx - hl, cy, cx + hl, cy, W - 2 * w) });
  return { cx, cy, L, W, w, leftX: cx - L / 2, footprint: ring };
}

// Chain + end hardware. Returns extra piece shapes (each with its own zTop).
// endType: 'none' | 'snapring' | 'carabiner'
export function buildChain(firstShape, loop, T, d, linkCount, endType) {
  const shapes = [];
  const cy = loop.cy;
  if (linkCount === 0 && endType === 'none') return shapes;
  const n = Math.max(linkCount, endType !== 'none' ? 2 : 0); // end hardware needs ≥2 links

  // eyelet on the loop tab for the first link
  const eye = addEyelet(firstShape, loop.leftX, cy, -1);

  const hl = CHAIN.Lc / 2 - CHAIN.Wc / 2;
  const paths3d = [];
  let cx = eye.barX - hl - 0.4; // first link's right cap wraps the eyelet bar
  for (let k = 0; k < n; k++) {
    const pts = linkPath(cx, cy, k % 2 === 0 ? 1 : -1);
    paths3d.push(pts);
    shapes.push({ base: [], bandAdds: sphereChainBands(pts, CHAIN.wireR, CHAIN.hs), bandSubs: [], zTop: chainH() });
    cx -= CHAIN.pitch;
  }
  const lastCx = cx + CHAIN.pitch;
  // the end piece's eyelet bar must sit inside the LAST link's left cap
  const endBarX = lastCx - hl + 0.4;
  // eyelet geometry: barX = xEdge + dir*(L/2-1.0) + dir*(L/2-wall/2)
  const endEdgeX = endBarX - (EYELET.L / 2 - 1.0) - (EYELET.L / 2 - EYELET.wall / 2);

  if (endType === 'snapring') {
    shapes.push(buildSnapRing(endEdgeX, cy));
  } else if (endType === 'carabiner') {
    shapes.push(...buildCarabiner(endEdgeX, cy, d));
  }

  buildChain._lastPaths = paths3d; // debug hook (clearance QA from the console)
  return shapes;
}

// ---- snap ring (traced from the reference pendant) --------------------------

function buildSnapRing(edgeX, cy) {
  const s = 1.0;                              // reference size ≈ Ø21.8mm
  const R = (SNAP_RING.w / 2) * s;
  const cx = edgeX + 0.6 - R;                 // eyelet embeds 0.6mm into the ring wall
  // rotate so the clasp (bottom-right in the trace) sits at the top, like the photo
  const paths = templatePaths(SNAP_RING.loops, s, cx, cy, Math.PI);
  const shape = { base: [], bandAdds: [{ z0: 0, z1: 3.2, paths }], bandSubs: [], zTop: 3.2 };
  addEyelet(shape, edgeX, cy, +1);
  return shape;
}

// ---- carabiner (traced body/gate + captured-disc pivot + separate screw knob) ----

function loopBBox(loop) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of loop) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Straight in-plane rod (horizontal cylinder) along an axis a ↦ P(a), as Z bands:
// per band the section is a capsule of half-width √(r²−dz²) — exact, and printable
// when r ≈ T/2 (the bottom touches the bed; a thin keel widens the first layers).
// Material spans exactly [aFrom, aTo] at mid-height; each end is spherical unless
// flagged flat (a straight cut at the given a for every z — used to keep a fixed
// clearance to neighbouring parts).
function rodBands(P, aFrom, aTo, r, zc, { flatFrom = false, flatTo = false, hs = 0.25 } = {}) {
  const bands = [];
  const z0r = Math.max(0, zc - r), z1r = zc + r;
  for (let z = Math.floor(z0r / hs) * hs; z < z1r - 1e-9; z += hs) {
    const z0 = Math.max(z, 0), z1 = Math.min(z + hs, z1r);
    if (z1 - z0 < 1e-6) continue;
    const dz = Math.abs((z0 + z1) / 2 - zc);
    if (dz >= r) continue;
    const w = 2 * Math.sqrt(r * r - dz * dz);
    if (w < 0.24) continue;
    const c1 = flatFrom ? aFrom + w / 2 : aFrom + r;
    const c2 = flatTo ? aTo - w / 2 : aTo - r;
    if (c2 <= c1) continue;
    const p1 = P(c1), p2 = P(c2);
    bands.push({ z0, z1, paths: G.capsule(p1.x, p1.y, p2.x, p2.y, w) });
  }
  return bands;
}

export function buildCarabiner(edgeX, cy, d) {
  const { cxy, cz } = d;
  const s = 0.8;                               // screw physics set the minimum scale
  const T = 4.0;                               // carabiner's own thickness
  const lipH = 1.1;
  const bodyLoop = [CARABINER.loops[0]];
  const gateLoop = [CARABINER.loops[1]];
  const pin = CARABINER.loops[2];
  const pinC = {
    x: pin.reduce((a, p) => a + p[0], 0) / pin.length,
    y: pin.reduce((a, p) => a + p[1], 0) / pin.length,
  };

  const W = CARABINER.w * s, H = CARABINER.h * s;
  // hang horizontally: spine (template +y) points toward the chain (+x) → rotate -90°
  const rot = -Math.PI / 2;
  const cxB = edgeX + 0.6 - H / 2;             // rotated: template height lies along x

  const place = (loops, extra = 0) => {
    let p = templatePaths(loops, s, cxB, cy, rot);
    return extra ? G.offset(p, extra) : p;
  };
  const rotP = (p) => ({
    x: cxB + (p.x * Math.cos(rot) - p.y * Math.sin(rot)) * s,
    y: cy + (p.x * Math.sin(rot) + p.y * Math.cos(rot)) * s,
  });

  const bodyPaths = place(bodyLoop);
  const gatePaths = place(gateLoop, -0.08);    // extra print-in-place clearance
  const Pv = rotP(pinC);                       // pivot center (world)

  // ---- screw axis: pivot → gate tip, continuing into the body nose ----
  const gl = CARABINER.loops[1];
  const gb = loopBBox(gl);
  const topPts = gl.filter(([, y]) => y > gb.y1 - 2);
  const tipT = rotP({
    x: topPts.reduce((a, p) => a + p[0], 0) / topPts.length,
    y: gb.y1,
  });
  const L = Math.hypot(tipT.x - Pv.x, tipT.y - Pv.y);
  const u = { x: (tipT.x - Pv.x) / L, y: (tipT.y - Pv.y) / L };
  const P = (a) => ({ x: Pv.x + u.x * a, y: Pv.y + u.y * a });

  // Screw parametrics (all mm, world). The core is a ROUND rod of r ≈ T/2 — like the
  // reference, its cross-section is a circle barely clipped by the slab's flat
  // top/bottom, so the sleeve can rotate around it AND it prints flat on the bed.
  const SCREW = {
    rodR: 1.95,          // core / gate-tip / nose rod radius (≈ T/2)
    wireR: 0.5,          // male thread wire radius
    orbit: 2.25,         // helix centerline radius (wire embeds 0.2 into the core)
    pitch: 2.2,
    boreR: 2.30,         // sleeve internal thread crest (clears rod by 0.35)
    rootR: 3.10,         // sleeve internal thread root (clears male crest 2.75 by 0.35)
    lobeW: 1.7,          // sleeve groove width (male wire Ø + 2×0.35)
    sleeveL: 8.0,
    knurlR: 3.8, knurlAmp: 0.2, knurlN: 12,
  };
  const a0 = 0.57 * L;                         // thread start (mid-arm, as in the reference)
  const aTh1 = L - 1.6;                        // thread end (plain passage before the tip)
  const noseGap = 0.4;

  // clearance corridors carved out of both traced outlines around the screw travel
  const carve = (from, to, r) => {
    const p1 = P(from), p2 = P(to);
    return G.capsule(p1.x, p1.y, p2.x, p2.y, 2 * r);
  };
  const corridor = [
    ...carve(a0 - 0.6, L + 0.8, 4.7),          // thread zone + reference's rest ledge
    ...carve(L - 1.0, L + 4.9, 4.35),          // nose zone (hook root stays intact)
  ];

  // ---- body: traced outline (corridor carved) + pivot pad + coaxial nose rod ----
  const discR = 2.4, shaftR = 1.5;
  const body = {
    base: [G.unionAll([
      ...G.diff(bodyPaths, corridor),
      ...G.circle(Pv.x, Pv.y, discR + cxy + 1.5),
    ])],
    bandAdds: [], bandSubs: [], zTop: T,
  };
  body.bandSubs.push({ z0: 0, z1: lipH, paths: G.circle(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: T - lipH, z1: T, paths: G.circle(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: 0, z1: 0.4, paths: G.circle(Pv.x, Pv.y, shaftR + cxy + 0.15) });
  const gateMid = rotP({ x: (gb.x0 + gb.x1) / 2, y: (gb.y0 + gb.y1) / 2 });
  const aArm = Math.atan2(gateMid.y - Pv.y, gateMid.x - Pv.x);
  const slot = [];
  for (let k = 0; k <= 5; k++) {
    const th = aArm + (k / 5) * (55 * Math.PI / 180);
    slot.push(...G.capsule(Pv.x, Pv.y, Pv.x + 6.5 * Math.cos(th), Pv.y + 6.5 * Math.sin(th), 3.0 + 2 * cxy));
  }
  body.bandSubs.push({ z0: lipH, z1: T - lipH, paths: [...G.circle(Pv.x, Pv.y, discR + cxy), ...slot] });

  // nose: round rod continuing the gate axis past the junction, rooted in the hook
  for (const b of rodBands(P, L + noseGap, L + 6.45, SCREW.rodR, T / 2)) body.bandAdds.push(b);
  {
    const k1 = P(L + noseGap + 0.8), k2 = P(L + 4.5);
    body.bandAdds.push({ z0: 0, z1: 0.3, paths: G.capsule(k1.x, k1.y, k2.x, k2.y, 1.4) }); // bed keel
  }

  // ---- gate: traced arm (carved) + pivot + core rod + male helix + stop blade ----
  const padClear = G.circle(Pv.x, Pv.y, discR + cxy + 1.5 + cxy);
  const gateBody = G.diff(G.diff(gatePaths, padClear), corridor);
  const gate = { base: [G.circle(Pv.x, Pv.y, shaftR), gateBody], bandAdds: [], bandSubs: [], zTop: T };
  gate.bandAdds.push({
    z0: lipH + cz, z1: T - lipH - cz,
    paths: [
      ...G.circle(Pv.x, Pv.y, discR),
      ...anchorCapsule(gateBody, gateMid.x, gateMid.y, Pv.x, Pv.y, 3.0),
    ],
  });
  // core rod: bridges the remaining traced arm and runs to the gate tip.
  // Flat rear cut at 4.8 from the pivot keeps 0.5 to the body pad (r4.3) at every z.
  for (const b of rodBands(P, 4.8, L, SCREW.rodR, T / 2, { flatFrom: true })) gate.bandAdds.push(b);
  {
    const k1 = P(6.0), k2 = P(L - 0.7);
    gate.bandAdds.push({ z0: 0, z1: 0.3, paths: G.capsule(k1.x, k1.y, k2.x, k2.y, 1.4) }); // bed keel
  }
  // stop blade: thin full-height wall the parked sleeve rests against
  {
    const c = P(a0 - 0.7);
    const n = { x: -u.y, y: u.x };
    gate.base.push(G.capsule(c.x - n.x * 2.6, c.y - n.y * 2.6, c.x + n.x * 2.6, c.y + n.y * 2.6, 1.4));
  }
  // male helix: sphere-chain wire around the core (z-clipped flat like the reference)
  {
    const helix = [];
    const step = 0.3, dphi = step / SCREW.orbit;
    const n = { x: -u.y, y: u.x };
    for (let phi = 0; ; phi += dphi) {
      const a = a0 + 1.2 + (SCREW.pitch * phi) / (2 * Math.PI);
      if (a > aTh1) break;
      const c = P(a);
      helix.push({
        x: c.x + n.x * SCREW.orbit * Math.cos(phi),
        y: c.y + n.y * SCREW.orbit * Math.cos(phi),
        z: T / 2 + SCREW.orbit * Math.sin(phi),
      });
    }
    for (const b of sphereChainBands(helix, SCREW.wireR, 0.25)) {
      if (b.z0 >= T) continue;
      gate.bandAdds.push({ z0: b.z0, z1: Math.min(b.z1, T), paths: b.paths });
    }
  }

  // ---- sleeve: separate print, stands on end beside the carabiner ----
  const sleeve = { base: [], bandAdds: [], bandSubs: [], zTop: SCREW.sleeveL };
  const kx = cxB - H / 2 - 7, ky = cy;
  const kring = [];
  const nK = 96;
  for (let i = 0; i < nK; i++) {
    const a = (i / nK) * Math.PI * 2;
    const rr = SCREW.knurlR + SCREW.knurlAmp * Math.cos(a * SCREW.knurlN);
    kring.push({ X: G.mm(kx + rr * Math.cos(a)), Y: G.mm(ky + rr * Math.sin(a)) });
  }
  const hs = 0.15;
  for (let z = 0; z < SCREW.sleeveL - 1e-9; z += hs) {
    const z1 = Math.min(z + hs, SCREW.sleeveL);
    const phi = ((z + hs / 2) / SCREW.pitch) * Math.PI * 2;
    sleeve.bandAdds.push({ z0: z, z1, paths: G.diff([kring], [
      ...G.circle(kx, ky, SCREW.boreR),
      ...G.capsule(kx, ky, kx + SCREW.rootR * Math.cos(phi), ky + SCREW.rootR * Math.sin(phi), SCREW.lobeW),
    ]) });
  }

  addEyelet(body, edgeX, cy, +1);
  return [body, gate, sleeve];
}

export { minPointDist };
