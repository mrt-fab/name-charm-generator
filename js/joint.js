// joint.js — captured-disc rotation joints as banded 2D shapes (no 3D CSG).
//
// Each printable piece is a BandedShape:
//   { base: [pathGroup…]      unioned at every z,
//     bandAdds: [{z0,z1,paths}], bandSubs: [{z0,z1,paths}] }
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
// side: -1 = paths lie to the left of target (grow leftwards), +1 = to the right.
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

// Build one joint: knob on A's right side, socket on B's left side.
// Mutates shapeA / shapeB. C in mm.
export function buildJoint(shapeA, Abbox, shapeB, Bbbox, C, d) {
  const { discR, shaftR, cavR, holeR, padR, armW, lipH, relief, cxy, T } = d;
  const zCav0 = lipH, zCav1 = T - lipH;
  const zDisc0 = lipH + d.cz, zDisc1 = T - lipH - d.cz;

  // --- knob (A) ---
  const aEdge = G.toMm(Abbox.maxX);
  const glyphA = shapeA.base[0];
  const arm = anchorCapsule(glyphA, aEdge, C.y, C.x, C.y, armW);
  shapeA.base.push(G.circle(C.x, C.y, shaftR));                    // shaft, full height
  shapeA.bandAdds.push({ z0: zDisc0, z1: zDisc1, paths: [...G.circle(C.x, C.y, discR), ...arm] });

  // --- socket (B) ---
  const bEdge = G.toMm(Bbbox.minX);
  const glyphB = shapeB.base[0];
  const padCore = G.circle(C.x, C.y, padR);
  const padLink = anchorCapsule(glyphB, bEdge, C.y, C.x, C.y, Math.min(padR, armW * 1.6));
  // keep clearance to A's glyph body (pad reaches into A's territory)
  const pad = G.diff(G.unionAll([...padCore, ...padLink]), G.offset(glyphA, cxy));
  shapeB.base.push(pad);

  // lip holes (shaft passage) + elephant-foot relief + cavity with swing slot
  shapeB.bandSubs.push({ z0: 0, z1: zCav0, paths: G.circle(C.x, C.y, holeR) });
  shapeB.bandSubs.push({ z0: zCav1, z1: T, paths: G.circle(C.x, C.y, holeR) });
  shapeB.bandSubs.push({ z0: 0, z1: relief, paths: G.circle(C.x, C.y, holeR + 0.15) });

  const slot = [];
  const swing = d.swing ?? (40 * Math.PI / 180);
  const towardA = Math.sign(G.toMm(Abbox.maxX) - C.x) <= 0 ? Math.PI : 0; // A is left → π
  for (let k = -3; k <= 3; k++) {
    const th = towardA + (k / 3) * swing;
    slot.push(...G.capsule(C.x, C.y,
      C.x + (padR + 1.5) * Math.cos(th), C.y + (padR + 1.5) * Math.sin(th),
      armW + 2 * cxy));
  }
  shapeB.bandSubs.push({ z0: zCav0, z1: zCav1, paths: [...G.circle(C.x, C.y, cavR), ...slot] });
}
