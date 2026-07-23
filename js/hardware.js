// hardware.js — printed loop tab, chain links, rings. All print-in-place, coplanar pieces
// linked by complementary half-height cuts at material crossings ("weave").
//
// Two weave topologies:
//  - mode 'x' (flat chain, 4 crossings): each piece rides OVER the other near its own
//    penetrating end cap → left piece over on the RIGHT half of the overlap, etc.
//    Used for oval-to-oval links (proven flattened-chain geometry).
//  - mode 'y' (Hopf, 2 crossings): the ring's cap crosses the other piece's two rails;
//    over on the top patch, under on the bottom patch. Used for big end rings whose
//    hole swallows the neighbor's cap without touching it.

import * as G from './geom.js';
import { makeShape, anchorCapsule } from './joint.js';

const bigRect = (x0, y0, x1, y1) => [[
  { X: G.mm(x0), Y: G.mm(y0) }, { X: G.mm(x1), Y: G.mm(y0) },
  { X: G.mm(x1), Y: G.mm(y1) }, { X: G.mm(x0), Y: G.mm(y1) },
]];

function weave(shapeA, pathsA, shapeB, pathsB, d, mode, splitVal) {
  const { cxy, cz, T } = d;
  const ovA = G.intersect(pathsA, G.offset(pathsB, cxy));
  const ovB = G.intersect(pathsB, G.offset(pathsA, cxy));
  if (!ovA.length || !ovB.length) return false;
  const bb = G.bounds([...ovA, ...ovB]);
  const m = 6; // margin, mm
  const lo = { x: G.toMm(bb.minX) - m, y: G.toMm(bb.minY) - m };
  const hi = { x: G.toMm(bb.maxX) + m, y: G.toMm(bb.maxY) + m };

  // 0.137mm jitter keeps the split line off ring-cap tangent vertices — an exact hit
  // produces degenerate zero-width contacts (T-junctions) in the subtracted outline.
  const JITTER = 0.137;
  let half1, half2; // A is OVER in half1, under in half2
  if (mode === 'x') {
    const midX = (splitVal ?? G.toMm((bb.minX + bb.maxX) / 2)) + JITTER;
    half1 = bigRect(midX, lo.y, hi.x, hi.y);   // A (left piece) over on the right
    half2 = bigRect(lo.x, lo.y, midX, hi.y);
  } else {
    const midY = (splitVal ?? G.toMm((bb.minY + bb.maxY) / 2)) - JITTER;
    half1 = bigRect(lo.x, midY, hi.x, hi.y);   // A (ring) over on top
    half2 = bigRect(lo.x, lo.y, hi.x, midY);
  }

  const zTop = T / 2, zGap = T / 2 - cz;
  const a1 = G.intersect(ovA, half1), a2 = G.intersect(ovA, half2);
  if (a1.length) shapeA.bandSubs.push({ z0: 0, z1: zTop, paths: a1 });   // over → keep top
  if (a2.length) shapeA.bandSubs.push({ z0: zGap, z1: T, paths: a2 });   // under → keep bottom
  const b1 = G.intersect(ovB, half1), b2 = G.intersect(ovB, half2);
  if (b1.length) shapeB.bandSubs.push({ z0: zGap, z1: T, paths: b1 });
  if (b2.length) shapeB.bandSubs.push({ z0: 0, z1: zTop, paths: b2 });
  return true;
}

// Oval ring footprint centered at (cx, cy): outer L×W, uniform wall w.
function ovalRing(cx, cy, L, W, w) {
  const hl = L / 2 - W / 2;
  const outer = G.capsule(cx - hl, cy, cx + hl, cy, W);
  const inner = G.capsule(cx - hl + w, cy, cx + hl - w, cy, W - 2 * w);
  return G.diff(outer, inner);
}

const annulus = (cx, cy, rOut, wall) =>
  G.diff(G.circle(cx, cy, rOut), G.circle(cx, cy, rOut - wall));

const rect = (x0, y0, x1, y1) => [[
  { X: G.mm(x0), Y: G.mm(y0) }, { X: G.mm(x1), Y: G.mm(y0) },
  { X: G.mm(x1), Y: G.mm(y1) }, { X: G.mm(x0), Y: G.mm(y1) },
]];

// Openable snap ring (after the reference pendant): a C-ring whose two ends carry
// interlocking J-hooks. Printed engaged with 0.3mm clearance; flexing the ring
// slightly oval slides the hooks apart to open it. One piece, full height.
// Returns { paths } — the closure is at the TOP of the ring; attach chain on the right.
function snapRingPaths(cx, cy) {
  const rOut = 10, wall = 2.5;
  const rMid = rOut - wall / 2; // 8.75
  const ring = annulus(cx, cy, rOut, wall);
  // local closure frame: origin at top of ring (cx, cy + rMid), x = tangent, y = radial-out
  const ox = cx, oy = cy + rMid;
  const L = (x0, y0, x1, y1) => rect(ox + x0, oy + y0, ox + x1, oy + y1);
  const cut = L(-3.4, -2.8, 3.4, 2.8);
  // hook A grows from the LEFT ring end: anchor block (tall — bridges the ring's
  // curvature drop at the junction) + top arm + downward tooth
  const hookA = [
    ...L(-4.8, -2.2, -2.8, 1.8),  // anchor into the left ring end
    ...L(-3.0, 0.8, 1.4, 1.8),    // arm along the top
    ...L(0.6, -0.5, 1.4, 1.8),    // tooth reaching down past center
  ];
  // hook B = A rotated 180° about the closure center (grows from the RIGHT ring end)
  const hookB = [
    ...L(2.8, -1.8, 4.8, 2.2),    // anchor into the right ring end
    ...L(-1.4, -1.8, 3.0, -0.8),  // arm along the bottom
    ...L(-1.4, -1.8, -0.6, 0.5),  // tooth reaching up
  ];
  return G.clean(G.unionAll([...G.diff(ring, cut), ...hookA, ...hookB]));
}

// Oval loop tab merged into the first character (also the anchor for chain/rings).
// Hole ≈ 6.6×4.6mm for straps / metal rings.
export function addLoopTab(shape, bbox, T, d) {
  const L = 11, W = 9, w = 2.2;
  const cy = G.toMm((bbox.minY + bbox.maxY) / 2);
  const edge = G.toMm(bbox.minX);
  const cx = edge + 1.4 - L / 2; // right end overlaps 1.4mm into the glyph
  const ring = ovalRing(cx, cy, L, W, w);
  const link = anchorCapsule(shape.base[0], edge, cy, cx + L / 2 - w / 2, cy, W * 0.55);
  shape.base.push(G.unionAll([...ring, ...link]));
  // punch the hole through everything (incl. the anchor link)
  const hl = L / 2 - W / 2;
  shape.bandSubs.push({ z0: 0, z1: T, paths: G.capsule(cx - hl + w, cy, cx + hl - w, cy, W - 2 * w) });
  return { cx, cy, L, W, w, leftX: cx - L / 2, footprint: ring };
}

// Curb-style chain link: small rounded ring with chamfered top/bottom bands
// (octagonal profile approximating a round wire, after the reference pendant chain).
function chainLinkShape(cx, cy, L, W, w, T) {
  const mid = ovalRing(cx, cy, L, W, w);
  const cham = 0.6;
  const slim = G.offset(mid, -Math.min(cham, w / 2 - 0.3)); // shrink outer + grow hole
  const shape = { base: [], bandAdds: [], bandSubs: [] };
  shape.bandAdds.push({ z0: 0, z1: cham, paths: slim });
  shape.bandAdds.push({ z0: cham, z1: T - cham, paths: mid });
  shape.bandAdds.push({ z0: T - cham, z1: T, paths: slim });
  return { shape, mid };
}

// Chain + end hardware, extending left from the loop. Returns extra piece shapes.
// endType: 'none' | 'ring' | 'doublering'
export function buildChain(firstShape, loop, T, d, linkCount, endType) {
  const L = 9, W = 7, w = 1.8;  // chain link dims (compact curb look)
  const shapes = [];
  const cy = loop.cy;

  let prevShape = firstShape;
  let prevPaths = loop.footprint;
  let prevLeftX = loop.leftX;

  for (let k = 0; k < linkCount; k++) {
    const P = 4.5; // cap penetration past previous piece's left edge (pitch = L - P)
    const cx = prevLeftX + P - L / 2;
    const { shape, mid } = chainLinkShape(cx, cy, L, W, w, T);
    weave(shape, mid, prevShape, prevPaths, d, 'x');
    shapes.push(shape);
    prevShape = shape; prevPaths = mid; prevLeftX = cx - L / 2;
  }

  if (endType === 'snapring') {
    const rOut = 10, P = 7.0;
    const cx = prevLeftX + P - rOut;
    const paths = snapRingPaths(cx, cy);
    const shape = makeShape(paths);
    weave(shape, paths, prevShape, prevPaths, d, 'y', cy);
    shapes.push(shape);
  } else if (endType === 'ring' || endType === 'doublering') {
    const dbl = endType === 'doublering';
    const rOut = dbl ? 10 : 9, wall = 2.5, P = dbl ? 6.5 : (linkCount ? 6.5 : 7.0);
    const cx = prevLeftX + P - rOut;
    let paths = annulus(cx, cy, rOut, wall);
    if (dbl) paths = G.unionAll([...paths, ...annulus(cx - 1.2, cy, rOut, wall)]);
    const shape = makeShape(paths);
    weave(shape, paths, prevShape, prevPaths, d, 'y', cy);
    shapes.push(shape);
  } else if (endType === 'carabiner') {
    shapes.push(...buildCarabiner(prevShape, prevPaths, prevLeftX, cy, d));
  }
  return shapes;
}

// ---- screw-gate carabiner (experimental) ------------------------------------
// Flat C-ring whose gate is two overlapping half-height arms, locked by a VERTICAL
// screw pin threaded through both arms. The thread is a discretized helix: per-slab
// circular core + a lobe rotated by z/pitch·360° — pin and holes share the phase, so
// it prints pre-engaged and unscrews upward to open the gate.

function threadLobe(px, py, phi, rOuter, width) {
  return G.capsule(px, py, px + rOuter * Math.cos(phi), py + rOuter * Math.sin(phi), width);
}

export function buildCarabiner(prevShape, prevPaths, prevLeftX, cy, d) {
  const { cxy, cz, T } = d;
  const L = 22, W = 16, w = 3;           // body oval
  const P = 6.5;                          // Hopf weave penetration into previous piece
  const cx = prevLeftX + P - L / 2;

  // C-ring: oval ring minus the right cap
  const ring = ovalRing(cx, cy, L, W, w);
  const gateX = cx + L / 2 - 6;
  const gap = bigRect(gateX, cy - W / 2 - 2, cx + L / 2 + 2, cy + W / 2 + 2);
  const cBody = G.diff(ring, gap);

  const railY = W / 2 - w / 2;            // open end centers
  const px = gateX + 2.6, py = cy;        // pin axis
  const rCore = 2.2, rOuter = 3.0, lobeW = 1.5, pitch = 2.4, hs = 0.15;
  const rLug = 4.6, knobR = 4.5, knobH = 2.2;
  const zSplit = T / 2;

  const body = makeShape(cBody);
  // overlapping gate arms: top arm keeps [T/2, T], bottom arm keeps [0, T/2 - cz]
  const armTop = [...G.capsule(gateX - 1, cy + railY, px, py, w), ...G.circle(px, py, rLug)];
  const armBot = [...G.capsule(gateX - 1, cy - railY, px, py, w), ...G.circle(px, py, rLug)];
  body.bandAdds.push({ z0: zSplit, z1: T, paths: armTop });
  body.bandAdds.push({ z0: 0, z1: zSplit - cz, paths: armBot });

  const pin = makeShape([]);
  const phiAt = (z) => (z / pitch) * Math.PI * 2;
  for (let z = 0; z < T + cz - 1e-9; z += hs) {
    const z1 = Math.min(z + hs, T + cz);
    const phi = phiAt(z + hs / 2);
    // pin: core + thread lobe
    pin.bandAdds.push({ z0: z, z1, paths: [...G.circle(px, py, rCore), ...threadLobe(px, py, phi, rOuter, lobeW)] });
    // matching threaded hole through whichever arm exists at this height
    const hole = [
      ...G.circle(px, py, rCore + cxy),
      ...threadLobe(px, py, phi, rOuter + cxy, lobeW + 2 * cxy),
      ...(z < 0.4 ? G.circle(px, py, rCore + cxy + 0.15) : []), // elephant-foot relief
    ];
    body.bandSubs.push({ z0: z, z1, paths: hole });
  }
  // knob above the top arm (cz gap so it doesn't fuse to the lug's top face)
  pin.bandAdds.push({ z0: T + cz, z1: T + cz + knobH, paths: G.circle(px, py, knobR) });

  weave(body, cBody, prevShape, prevPaths, d, 'y', cy);
  return [body, pin];
}
