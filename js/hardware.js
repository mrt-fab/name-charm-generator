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
import { anchorCapsule, buildTail, buildHead, rect } from './joint.js';
import { sphereChainBands, ovalLinkPath, minPointDist } from './wire3d.js';
import { SNAP_RING } from './hw_templates.js';
import { CARB_H, CARB_FRAME, CARB_GATE, CARB_KNOB } from './hw_carabiner_full.js';

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

// Loop = the first letter's standard TAIL RING (the v6 interlock ring, XZ plane,
// hole axis Y, Ø4·s) — 「1文字目の左端はそのまま残し」. Doubles as the 丸カン /
// key-ring hole. With a printed chain, buildChain inserts a small ADAPTER piece
// whose right side carries a v6 HEAD interlocking this ring (a bed-lying link can
// never encircle a wall-standing ring directly — the bed blocks the underside — so
// the chain reaches the ring through the adapter: last link wraps the adapter's
// flat eyelet, the adapter's head links the ring).
export function addLoopTab(shape, bbox, T, d) {
  const cy = G.toMm((bbox.minY + bbox.maxY) / 2);
  const edge = G.toMm(bbox.minX);
  buildTail(shape, shape.base[0], edge, cy, d, true);
  return { rx: edge, cy, leftX: edge - d.Ro };
}

// Chain + end hardware. Returns extra piece shapes (each with its own zTop).
// endType: 'none' | 'snapring' | 'carabiner'
export function buildChain(firstShape, loop, T, d, linkCount, endType) {
  const shapes = [];
  const cy = loop.cy;
  if (linkCount === 0 && endType === 'none') return shapes;
  const n = Math.max(linkCount, endType !== 'none' ? 2 : 0); // end hardware needs ≥2 links

  // adapter piece: its right side carries a v6 HEAD interlocking the first letter's
  // tail ring; its left side is the proven flat eyelet the first link wraps
  const s = d.s;
  const ax1 = loop.rx - d.g;               // adapter wall facing the letter's ring
  const ax0 = ax1 - 3.4;
  const aw = 4.2 * s;
  const adapter = {
    base: [rect(ax0, cy - aw, ax1, cy + aw)],
    bandAdds: [], bandSubs: [], zTop: d.taper1,
  };
  buildHead(adapter, ax1, loop.rx, cy, d);
  const eye = addEyelet(adapter, ax0, cy, -1);
  shapes.push(adapter);

  const hl = CHAIN.Lc / 2 - CHAIN.Wc / 2;
  const paths3d = [];

  let cx = eye.barX - hl - 0.4; // first link's right cap wraps the adapter's eyelet bar
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

// ---- carabiner (full-fidelity banded copy of the reference model) -----------
//
// The frame, print-in-place gate (pivot + printed spring + gate-axis screw thread)
// and the separately-printed knurled knob are traced band-by-band from the source
// STLs at full scale (scripts/trace_carabiner_full.py) — the proven mechanism is
// reproduced as-is instead of re-modeled. Source publication permits reproduction
// (confirmed by the user). Orientation: source spine (y) rotated -90 deg so it lies
// along the chain axis; the y-max end (the spine bend) lands at the chain eyelet.

function bandsToShape(obj, cx, cy, rot) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const shape = { base: [], bandAdds: [], bandSubs: [], zTop: obj.h };
  for (const b of obj.bands) {
    if (!b.loops.length) continue;
    const paths = b.loops.map((loop) => loop.map(([x, y]) => ({
      X: G.mm(cx + (x * cos - y * sin)), Y: G.mm(cy + (x * sin + y * cos)),
    })));
    shape.bandAdds.push({ z0: b.z0, z1: b.z1, paths: G.normalizeEvenOdd(paths) });
  }
  return shape;
}

export function buildCarabiner(edgeX, cy) {
  const rot = -Math.PI / 2;                       // spine along +x, toward the chain
  const cx = edgeX + 0.6 - CARB_H / 2;            // spine bend embeds into the eyelet
  const frame = bandsToShape(CARB_FRAME, cx, cy, rot);
  const gate = bandsToShape(CARB_GATE, cx, cy, rot);
  const knob = bandsToShape(CARB_KNOB, cx - CARB_H / 2 - 10, cy, 0);
  addEyelet(frame, edgeX, cy, +1);
  return [frame, gate, knob];
}

export { minPointDist };
