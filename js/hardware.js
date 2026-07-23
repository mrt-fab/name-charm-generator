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
// endType: 'none' | 'snapring' | 'carabiner'
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
  } else if (endType === 'carabiner') {
    shapes.push(...buildCarabiner(prevShape, prevPaths, prevLeftX, cy, d));
  }
  return shapes;
}


// ---- screw-lock carabiner (after the reference "Standard Carabiner" + screw knob) --
// Flat C-body. The gate bar pivots on a captured-disc joint (same mechanism as the
// letter joints) and swings OUTWARD to open. The lock: a vertical post stands on a
// round boss; the gate tip carries an open-mouthed notch collar around the post, and
// a knurled knob rides the post's discretized-helix thread. In the printed (locked)
// position the knob's skirt surrounds the collar, so its prongs jam against the skirt
// after ~0.4mm of swing. Unscrewing one turn lifts the skirt clear and frees the gate.

function threadLobe(px, py, phi, rOuter, width) {
  return G.capsule(px, py, px + rOuter * Math.cos(phi), py + rOuter * Math.sin(phi), width);
}

// 12-lobe knurled circle for the knob's grip
function knurledCircle(cx, cy, r, depth = 0.35, lobes = 12, n = 96) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r + depth * Math.cos(a * lobes);
    p.push({ X: G.mm(cx + rr * Math.cos(a)), Y: G.mm(cy + rr * Math.sin(a)) });
  }
  return [p];
}

export function buildCarabiner(prevShape, prevPaths, prevLeftX, cy, d) {
  const { cxy, cz, T } = d;
  const L = 30, W = 18, w = 3;              // body oval
  const P = 7.0;                             // Hopf weave penetration into previous piece
  const bx = prevLeftX + P - L / 2, by = cy;
  const R = (x0, y0, x1, y1) => rect(bx + x0, by + y0, bx + x1, by + y1);
  const C = (x, y, r, n) => G.circle(bx + x, by + y, r, n);

  const lipH = 1.2;
  const gateZ0 = lipH + cz, gateZ1 = T - lipH - cz;   // the whole gate lives in this band
  const Pv = { x: 9.7, y: -7.0 };            // pivot center
  const Pp = { x: 9.5, y: 5.8 };             // lock post center
  const discR = 3.2, shaftR = 2.0, armW = 3.2;
  const rCore = 1.6, rThread = 2.4, lobeW = 1.4, pitch = 2.4, hs = 0.15;
  const bossH = 1.0, bossR = 5.4;
  const knobZ0 = bossH + cz;                 // knob prints bridging one layer onto the boss
  const skirtH = 1.7, skirtInner = 3.8, knobR = 4.2, knobH = 5.0;
  const collarR = 3.4;

  // --- body: C-ring (right cap removed) + pivot pad + boss + lock post ---
  const cBody = G.diff(ovalRing(bx, by, L, W, w), R(7, -13, 17, 13));
  const body = makeShape(cBody);
  body.base.push(C(Pv.x, Pv.y, 5.2));        // pivot pad (merges with the lower body end)

  // pivot socket: lip holes + elephant relief + cavity with outward swing slot
  body.bandSubs.push({ z0: 0, z1: lipH, paths: C(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: T - lipH, z1: T, paths: C(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: 0, z1: 0.4, paths: C(Pv.x, Pv.y, shaftR + cxy + 0.15) });
  const slot = [];
  for (let k = 0; k <= 5; k++) {
    const th = Math.PI / 2 - (k / 5) * (Math.PI * 50 / 180); // 90° → 40° (outward swing)
    slot.push(...G.capsule(bx + Pv.x, by + Pv.y,
      bx + Pv.x + 7.0 * Math.cos(th), by + Pv.y + 7.0 * Math.sin(th), armW + 2 * cxy));
  }
  body.bandSubs.push({ z0: lipH, z1: T - lipH, paths: [...C(Pv.x, Pv.y, discR + cxy), ...slot] });

  // round boss under the knob (merges into the top rail) + the threaded post
  body.bandAdds.push({ z0: 0, z1: bossH, paths: C(Pp.x, Pp.y, bossR) });
  body.bandAdds.push({ z0: 0, z1: knobZ0 + knobH + 0.4, paths: C(Pp.x, Pp.y, rCore) });

  // --- gate piece: full-height shaft + one-band disc/arm/bar/collar ---
  const gate = { base: [], bandAdds: [], bandSubs: [] };
  gate.base.push(C(Pv.x, Pv.y, shaftR));
  const collar = G.diff(
    G.diff(C(Pp.x, Pp.y, collarR), C(Pp.x, Pp.y, rCore + cxy)),
    R(Pp.x - 4.4, Pp.y - (rCore + cxy), Pp.x - 0.9, Pp.y + (rCore + cxy)) // mouth opens inward (−x)
  );
  gate.bandAdds.push({ z0: gateZ0, z1: gateZ1, paths: [
    ...C(Pv.x, Pv.y, discR),
    ...G.capsule(bx + Pv.x, by + Pv.y, bx + Pv.x, by + 3.0, armW),  // arm/bar up from the pivot
    ...collar,
  ] });

  // --- knob piece: skirt + threaded bore, knurled outside ---
  const knob = { base: [], bandAdds: [], bandSubs: [] };
  const knurl = knurledCircle(bx + Pp.x, by + Pp.y, knobR);
  knob.bandAdds.push({ z0: knobZ0, z1: knobZ0 + skirtH, paths: G.diff(knurl, C(Pp.x, Pp.y, skirtInner)) });
  for (let z = knobZ0 + skirtH; z < knobZ0 + knobH - 1e-9; z += hs) {
    const z1 = Math.min(z + hs, knobZ0 + knobH);
    const phi = ((z + hs / 2) / pitch) * Math.PI * 2;
    knob.bandAdds.push({ z0: z, z1, paths: G.diff(knurl, [
      ...C(Pp.x, Pp.y, rCore + cxy),
      ...threadLobe(bx + Pp.x, by + Pp.y, phi, rThread + cxy, lobeW + 2 * cxy),
    ]) });
    // post's matching thread lobe at the same phase (engaged as printed)
    body.bandAdds.push({ z0: z, z1, paths: threadLobe(bx + Pp.x, by + Pp.y, phi, rThread, lobeW) });
  }

  weave(body, cBody, prevShape, prevPaths, d, 'y', cy);
  return [body, gate, knob];
}
