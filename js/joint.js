// joint.js — bar-and-tunnel joints (the reference-photo mechanism) as banded 2D
// shapes (no 3D CSG).
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

const rect = (x0, y0, x1, y1) => [[
  { X: G.mm(x0), Y: G.mm(y0) }, { X: G.mm(x1), Y: G.mm(y0) },
  { X: G.mm(x1), Y: G.mm(y1) }, { X: G.mm(x0), Y: G.mm(y1) },
]];

// Build one joint between A (left) and B (right). Mutates shapeA / shapeB. C in mm.
//
// The reference keychains articulate like a loose chain, not like a precision hinge:
// A carries a bed-level BAR along the text axis ending in a FLARED tip; B carries a
// low socket lobe whose WALL the bar passes through (a tunnel), with a POCKET cavity
// behind the wall that captures the flare. Sideways the flare cannot pass the tunnel
// (it is 2×flare wider); vertically the pocket roof holds it down. Clearance all
// around gives the floppy multi-axis dangle seen in the reference photo. Everything
// is bed-grounded: bar and flare print on the bed, the wall bridges the tunnel
// opening and the roof bridges the pocket — the same print logic as the chain, which
// survived the first test print. The letters stay full height above the joint, so
// the top face reads as pure letter shapes.
export function buildJoint(shapeA, Abbox, shapeB, Bbbox, C, d) {
  const { hRod, wRod, wallX, wFlare, flareL, pocketY, pocketX, hPocket, ceil,
          sideWall, relief, cxy, cz } = d;
  const aEdge = G.toMm(Abbox.maxX);
  const bEdge = G.toMm(Bbbox.minX);
  const glyphA = shapeA.base[0];
  const glyphB = shapeB.base[0];

  // x stations (text axis): wall around the gap midline, pocket behind it into B
  const xw0 = C.x - wallX / 2;                 // wall left face
  const xw1 = xw0 + wallX;                     // wall right face = pocket start
  const xp1 = xw1 + pocketX;                   // pocket end
  const blockEnd = xp1 + 1.8;                  // solid behind the pocket
  const hBlock = hPocket + ceil;

  // --- socket lobe on B (carries wall + pocket; cleared from A's letter) ---
  const blockW = pocketY + 2 * sideWall;
  const block = G.diff(
    G.unionAll([
      ...rect(xw0, C.y - blockW / 2, blockEnd, C.y + blockW / 2),
      ...anchorCapsule(glyphB, bEdge, C.y, xp1 - 1.0, C.y, Math.min(blockW, 6)),
    ]),
    G.offset(glyphA, cxy)
  );
  shapeB.bandAdds.push({ z0: 0, z1: hBlock, paths: block });

  // pocket cavity + tunnel opening (subs carve the block AND B's glyph — the
  // "えぐれ" seen on the reference letters)
  const pocket = rect(xw1, C.y - pocketY / 2, xp1, C.y + pocketY / 2);
  const mouthW = wRod + 2 * cxy;
  const opening = rect(xw0 - 0.6, C.y - mouthW / 2, xw1 + 0.6, C.y + mouthW / 2);
  // entrance splay: lets the bar yaw (in-plane fan) like the reference
  const splay = [];
  for (let k = -1; k <= 1; k++) {
    const th = Math.PI + k * 0.38;
    splay.push(...G.capsule(xw0 + 0.8, C.y,
      xw0 + 0.8 + 5.5 * Math.cos(th), C.y + 5.5 * Math.sin(th), mouthW));
  }
  shapeB.bandSubs.push({ z0: 0, z1: hPocket, paths: pocket });
  shapeB.bandSubs.push({ z0: 0, z1: hRod + cz, paths: G.unionAll([...opening, ...splay]) });
  // elephant-foot relief around the bar at the very bottom
  shapeB.bandSubs.push({ z0: 0, z1: relief, paths: G.offset(G.unionAll([...pocket, ...opening]), 0.15) });

  // --- bar + flare on A (bed level, z 0..hRod) ---
  const xFlareC = xw1 + flareL / 2 + 0.35;
  const bar = [
    ...anchorCapsule(glyphA, aEdge, C.y, xw0 - 1.0, C.y, wRod),
    ...G.capsule(xw0 - 1.0, C.y, xFlareC, C.y, wRod),
    // flare: stadium across Y, wFlare wide × flareL long
    ...G.capsule(xFlareC, C.y - (wFlare - flareL) / 2, xFlareC, C.y + (wFlare - flareL) / 2, flareL),
  ];
  // keep clearance to B's glyph flank (if the glyph bulges into the joint zone the
  // pocket subs already carve it, but the bar itself must not overlap B's material)
  shapeA.bandAdds.push({ z0: 0, z1: hRod, paths: G.unionAll(bar) });
}
