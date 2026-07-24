// joint.js — interlocked-ring joints (user-specified v6 design) as banded 2D shapes.
//
// X = text axis, Y = letter height, Z = layers. Each pair of neighbours links like
// two chain links at 90°:
//   TAIL (B's left end): a ring in the XZ plane (hole axis Y) half-embedded in the
//     letter wall, teardrop-tapered underside so it prints support-free.
//   HEAD (A's right end): a floating plate corbelled out of the wall (54° rails,
//     tapering back into the wall above) with a Z-axis hole; the hole's far rim is
//     a Y-parallel BAR printed as a short bridge between the rail tips.
// B's ring passes vertically through A's plate hole and A's bar passes through B's
// ring hole — a true topological link that cannot be pulled apart in any direction.
//
// Each printable piece is a BandedShape:
//   { base: [pathGroup…], bandAdds: [{z0,z1,paths}], bandSubs: [{z0,z1,paths}] }
// Per slab: solid = union(base ∪ covering adds) − covering subs.

import * as G from './geom.js';

export function makeShape(basePaths) {
  return { base: [basePaths], bandAdds: [], bandSubs: [] };
}

export function shapeZEdges(shape, T) {
  const s = new Set([0, T]);
  for (const b of [...shape.bandAdds, ...shape.bandSubs]) { s.add(b.z0); s.add(b.z1); }
  return s;
}

// Iteratively grow a capsule from (targetX,targetY) into `paths` until union is connected.
export function anchorCapsule(paths, edgeXmm, y, targetX, targetY, w) {
  const before = G.componentCount(paths);
  let embed = 2.5;
  for (let i = 0; i < 5; i++) {
    const dir = Math.sign(edgeXmm - targetX) || 1;
    const cap = G.capsule(targetX, targetY, edgeXmm + dir * embed, y, w);
    const u = G.unionAll([...paths, ...cap]);
    if (G.exPolygons(u).length <= before) return cap;
    embed += 2.0;
  }
  return G.capsule(targetX, targetY, edgeXmm, y, w); // best effort
}

export const rect = (x0, y0, x1, y1) => [[
  { X: G.mm(x0), Y: G.mm(y0) }, { X: G.mm(x1), Y: G.mm(y0) },
  { X: G.mm(x1), Y: G.mm(y1) }, { X: G.mm(x0), Y: G.mm(y1) },
]];

export const BAND = 0.25; // z band height for curved joint surfaces

// Tail-ring annulus bands in the XZ plane around (xC, cy, zc): per band the ring is
// one or two x-intervals; the side protruding PAST xLimit (toward dir) is clipped to
// a 45°-ish underside taper so nothing overhangs. dir = -1: ring protrudes toward -x.
export function ringBands(push, xC, cy, zc, Ro, Rh, tY, clip0, dir = -1, protRate = 1.2) {
  const bot = zc - Ro, top = zc + Ro;
  for (let z = Math.max(0, bot); z < top - 1e-9; z += BAND) {
    const z1 = Math.min(z + BAND, top);
    const zm = (z + z1) / 2, dz0 = Math.abs(zm - zc);
    if (dz0 >= Ro - 1e-9) continue;
    const xo = Math.sqrt(Ro * Ro - dz0 * dz0);
    const prot = Math.max(0.4, (zm - clip0) * protRate);
    const pieces = [];
    if (dz0 < Rh) {
      const xi = Math.sqrt(Rh * Rh - dz0 * dz0);
      pieces.push([-xo, -xi], [xi, xo]);
    } else {
      pieces.push([-xo, xo]);
    }
    const paths = [];
    for (let [a, b] of pieces) {
      if (dir < 0) a = Math.max(a, -prot); else b = Math.min(b, prot);
      if (b - a > 0.05) paths.push(...rect(xC + a, cy - tY / 2, xC + b, cy + tY / 2));
    }
    if (paths.length) push(z, z1, paths);
  }
}

// TAIL half: the XZ-plane ring on a piece's LEFT wall at xB (+ glyph tie + mouth
// slot for the incoming bar). glyph = the piece's base paths, for anchoring.
export function buildTail(shape, glyph, xB, cy, d, withSlot = true) {
  const { Ro, Rh, tY, zc } = d;
  ringBands((z0, z1, paths) => shape.bandAdds.push({ z0, z1, paths }),
    xB, cy, zc, Ro, Rh, tY, d.clip0);
  // tie the embedded half into the glyph (the flank may be recessed at cy);
  // pseudo-edge xB+Ro forces the capsule to grow INTO the glyph (+x)
  shape.bandAdds.push({
    z0: Math.max(0, zc - Ro), z1: zc + Ro,
    paths: anchorCapsule(glyph, xB + Ro, cy, xB + Ro * 0.55, cy, tY),
  });
  if (withSlot) {
    // mouth slot: swing room for the bar (carves the glyph — the reference's えぐれ)
    shape.bandSubs.push({
      z0: d.slotZ0, z1: d.slotZ1,
      paths: rect(xB - 0.3, cy - d.slotY, xB + d.slotX, cy + d.slotY),
    });
  }
}

// HEAD half: the corbelled floating plate on a piece's RIGHT wall at aEdge, whose
// Z-hole is threaded by the tail ring at xB and whose far rim (the BAR, a Y bridge)
// threads that ring's hole.
export function buildHead(shape, aEdge, xB, cy, d) {
  const { s } = d;
  // the bar is CENTERED on the ring (xB): its rect corners then sit at radius
  // √(0.9² + 1.2²)·s = 1.5s inside the Rh = 2s hole — 0.5s clearance all around
  const hx0 = xB - 4.15 * s, hx1 = xB - 0.9 * s, bx1 = xB + 0.9 * s;
  const x00 = aEdge - 3.0;             // embed the root into the piece
  const railY0 = 2.4 * s, railY1 = 4.0 * s;
  const omega = (z0, z1, reach, withBar) => {
    const xf = Math.min(bx1, aEdge + reach);
    const paths = [];
    if (xf > x00 + 0.05) paths.push(...rect(x00, cy - railY1, Math.min(xf, hx0), cy + railY1));
    if (xf > hx0 + 0.05) {
      paths.push(...rect(hx0, cy + railY0, xf, cy + railY1));
      paths.push(...rect(hx0, cy - railY1, xf, cy - railY0));
    }
    if (withBar && xf > hx1 + 0.05) paths.push(...rect(hx1, cy - railY0, xf, cy + railY0));
    if (paths.length) shape.bandAdds.push({ z0, z1, paths });
  };
  const fullReach = bx1 - aEdge;
  // below the mouth slot the rails must stop short of B's wall
  const preSlotReach = xB - 0.4 - aEdge;
  // corbel: rails grow out of the wall at ~54° until they reach the plate underside
  for (let z = d.corbel0; z < d.plate0 - 1e-9; z += BAND) {
    const z1 = Math.min(z + BAND, d.plate0);
    const zm = (z + z1) / 2;
    // a band ANY part of which lies below the slot must stay clear of B's wall
    const cap = z < d.slotZ0 - 1e-9 ? preSlotReach : fullReach;
    const reach = Math.min(cap, (zm - d.corbel0) * d.corbelRate);
    const xf = Math.min(bx1, aEdge + reach);
    const paths = [];
    if (xf > x00 + 0.05) {
      paths.push(...rect(x00, cy + railY0, xf, cy + railY1));
      paths.push(...rect(x00, cy - railY1, xf, cy - railY0));
      // center column under the root rim corbels alongside (short overhang)
      paths.push(...rect(x00, cy - railY0, Math.min(xf, hx0), cy + railY0));
    }
    if (paths.length) shape.bandAdds.push({ z0: z, z1, paths });
  }
  // the plate itself (the far rim of its hole is the bar — a Y bridge)
  omega(d.plate0, d.plate1, fullReach, true);
  // taper back into the wall above; NO bar up here (the ring's upper strands pass
  // through this x-range) and the rails stay clear of B's wall past the slot top
  for (let z = d.plate1; z < d.taper1 - 1e-9; z += BAND) {
    const z1 = Math.min(z + BAND, d.taper1);
    const zm = (z + z1) / 2;
    const cap = z1 > d.slotZ1 + 1e-9 ? preSlotReach : fullReach;
    omega(z, z1, Math.min(cap, Math.max(0, fullReach - (zm - d.plate1) * 2.5)), false);
  }
}

// Build one joint between A (left) and B (right). Mutates shapeA / shapeB. C in mm.
export function buildJoint(shapeA, Abbox, shapeB, Bbbox, C, d) {
  const aEdge = G.toMm(Abbox.maxX);
  const bEdge = G.toMm(Bbbox.minX);
  buildTail(shapeB, shapeB.base[0], bEdge, C.y, d);
  buildHead(shapeA, aEdge, bEdge, C.y, d);
}
