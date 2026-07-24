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

// Loop = STANDING ring (torus in the YZ plane, hole axis along the text direction),
// like the reference photo — the hole is perpendicular to the print layers, so a
// metal 丸カン / key ring threads it the natural way. Built with the sphere-chain
// sweep (a wire circle in the YZ plane), resting on the bed; a low stub ties its
// bottom tube into the first letter's flank.
//
// The printed chain cannot thread the standing hole itself: the hole bottom sits a
// tube-diameter above the bed while chain links print ON the bed, and a link's
// return strand can't clear the ring's outside either — so with a chain enabled,
// buildChain hangs the first link off a flat eyelet fused under the ring's base
// (visually the chain flows straight out of the ring's foot).
export function addLoopTab(shape, bbox, T, d) {
  const rt = 1.05;                 // tube radius (Ø2.1)
  const holeR = 2.6;               // hole radius (Ø5.2, 丸カン-friendly)
  const Rc = holeR + rt;           // wire centerline radius
  const zc = Rc + rt;              // ring rests on the bed
  const cy = G.toMm((bbox.minY + bbox.maxY) / 2);
  const edge = G.toMm(bbox.minX);
  const rx = edge - 1.6 - rt;      // ring wall center, clear of the letter flank
  const pts = [];
  const nSeg = 72;
  for (let i = 0; i <= nSeg; i++) {
    const a = (i / nSeg) * Math.PI * 2;
    pts.push({ x: rx, y: cy + Rc * Math.cos(a), z: zc + Rc * Math.sin(a) });
  }
  for (const b of sphereChainBands(pts, rt, 0.25)) shape.bandAdds.push(b);
  // bed-level stub: covers under the tube bottom (bed foot) and ties into the letter
  const stub = anchorCapsule(shape.base[0], edge, cy, rx - 1.0, cy, 2.6);
  shape.bandAdds.push({ z0: 0, z1: 2.4, paths: stub });
  return { rx, cy, rt, Rc, zc, leftX: rx, footprint: null };
}

// Chain + end hardware. Returns extra piece shapes (each with its own zTop).
// endType: 'none' | 'snapring' | 'carabiner'
export function buildChain(firstShape, loop, T, d, linkCount, endType) {
  const shapes = [];
  const cy = loop.cy;
  if (linkCount === 0 && endType === 'none') return shapes;
  const n = Math.max(linkCount, endType !== 'none' ? 2 : 0); // end hardware needs ≥2 links

  // flat eyelet fused under the standing ring's base (loop.leftX = ring wall
  // center, so the eyelet's right end overlaps the tube bottom); the first link
  // wraps its bar — the chain flows straight out of the ring's foot
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

// The traced clasp (hook-and-eye tongue in a zigzag groove) has only a ~0.2mm slit —
// it fused solid in the first test print (0.42mm extrusion). Widen the seam to 0.62mm
// by carving along its stepped midline (template coords, measured from SNAP_RING).
const CLASP_SEAM = [
  [7.35, 2.51], [8.28, 2.51], [8.28, 0.12], [7.08, 1.22],
  [7.08, -1.12], [8.92, -1.12], [9.55, -1.68],
];

function buildSnapRing(edgeX, cy) {
  const s = 1.0;                              // reference size ≈ Ø21.8mm
  const R = (SNAP_RING.w / 2) * s;
  const cx = edgeX + 0.6 - R;                 // eyelet embeds 0.6mm into the ring wall
  // rotate so the clasp (bottom-right in the trace) sits at the top, like the photo
  const rot = Math.PI;
  const paths = templatePaths(SNAP_RING.loops, s, cx, cy, rot);
  const seam = [];
  const tp = (p) => ({ x: cx + (p[0] * Math.cos(rot) - p[1] * Math.sin(rot)) * s,
                       y: cy + (p[0] * Math.sin(rot) + p[1] * Math.cos(rot)) * s });
  for (let i = 0; i < CLASP_SEAM.length - 1; i++) {
    const a = tp(CLASP_SEAM[i]), b = tp(CLASP_SEAM[i + 1]);
    seam.push(...G.capsule(a.x, a.y, b.x, b.y, 0.62));
  }
  const shape = {
    base: [],
    bandAdds: [{ z0: 0, z1: 3.2, paths }],
    bandSubs: [{ z0: 0, z1: 3.2, paths: G.unionAll(seam) }],
    zTop: 3.2,
  };
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
    rodR: 1.85,          // gate-tip / nose post radius (sleeve-passable)
    wireR: 0.5,          // male thread wire radius
    orbit: 2.15,         // helix centerline radius
    pitch: 2.0,
    boreR: 2.25,         // sleeve bore (clears post 1.85 by 0.4)
    rootR: 3.00,         // sleeve thread root (clears male crest ~2.65 by 0.35)
    lobeW: 1.7,          // sleeve groove width
    sleeveL: 6.0,
    knurlR: 3.7, knurlAmp: 0.2, knurlN: 12,
  };
  const axisN = { x: -u.y, y: u.x };
  const noseGap = 0.4;
  const gPost0 = Math.max(6.5, L - 4.8);       // gate arm stays SOLID before this
  const thr0 = gPost0 + 0.5, thr1 = L - 0.7;   // thread on the gate post
  const nPost1 = L + 4.4;                       // nose round post end (sleeve-passable)
  const tongue0 = L + 3.2, tongue1 = L + 7.4;   // solid nose tongue → hook root (strength)

  // Only the sleeve barrel needs frame clearance — carve a snug channel over its
  // travel and NOTHING else, so both the gate arm and the nose tongue stay solid.
  const carve = (from, to, r) => {
    const p1 = P(from), p2 = P(to);
    return G.capsule(p1.x, p1.y, p2.x, p2.y, 2 * r);
  };
  const corridor = carve(gPost0 - 0.4, nPost1 - 0.2, SCREW.knurlR + 0.2);

  // ---- body: traced outline (barrel channel carved) + pivot pad + solid nose ----
  const discR = 2.4, shaftR = 1.5;
  const tA = P(tongue0), tB = P(tongue1);
  const body = {
    base: [G.unionAll([
      ...G.diff(bodyPaths, corridor),
      ...G.circle(Pv.x, Pv.y, discR + cxy + 1.5),
      ...G.capsule(tA.x, tA.y, tB.x, tB.y, 3.4),   // SOLID full-height nose tongue
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

  // nose round post: short cantilever bridging the solid tongue to the junction
  for (const b of rodBands(P, L + noseGap, nPost1, SCREW.rodR, T / 2)) body.bandAdds.push(b);
  {
    const k1 = P(L + 1.5), k2 = P(nPost1);  // keel kept clear of the junction gap
    body.bandAdds.push({ z0: 0, z1: 0.3, paths: G.capsule(k1.x, k1.y, k2.x, k2.y, 1.4) }); // bed keel
  }

  // ---- gate: traced arm (solid) + pivot + threaded round post toward the tip ----
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
  // gate post: rooted in the solid arm (starts before the carve), runs to the tip
  for (const b of rodBands(P, gPost0 - 1.2, L, SCREW.rodR, T / 2)) gate.bandAdds.push(b);
  {
    const k1 = P(gPost0 - 0.6), k2 = P(L - 1.4);  // keel kept clear of the junction gap
    gate.bandAdds.push({ z0: 0, z1: 0.3, paths: G.capsule(k1.x, k1.y, k2.x, k2.y, 1.4) }); // bed keel
  }
  // stop collar: full-height ring the parked sleeve seats against (also anchors the post)
  {
    const c = P(gPost0 - 0.2);
    gate.bandAdds.push({ z0: 0, z1: T, paths: G.circle(c.x, c.y, SCREW.boreR + 0.75) });
  }
  // male helix on the gate post (z-clipped flat like the reference's 2.5D thread)
  {
    const helix = [];
    const step = 0.3, dphi = step / SCREW.orbit;
    for (let phi = 0; ; phi += dphi) {
      const a = thr0 + (SCREW.pitch * phi) / (2 * Math.PI);
      if (a > thr1) break;
      const c = P(a);
      helix.push({
        x: c.x + axisN.x * SCREW.orbit * Math.cos(phi),
        y: c.y + axisN.y * SCREW.orbit * Math.cos(phi),
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
