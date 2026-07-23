// slabs.js — the core representation: each piece becomes a stack of Z slabs,
// each slab a set of 2D polygons. Joint bands and color boundaries share one cut set.

import * as G from './geom.js';
import { shapeZEdges } from './joint.js';

const EPS = 1e-6;

function dedupeSorted(zs) {
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) if (!out.length || z - out[out.length - 1] > EPS) out.push(z);
  return out;
}

// colorCuts: interior z boundaries (0..T exclusive), e.g. [2.5] for 2 colors.
// → per shape: [{z0, z1, paths, colorIdx}]
export function buildSlabs(shape, T, colorCuts) {
  const cutSet = new Set([...shapeZEdges(shape, T)]);
  for (const z of colorCuts) if (z > EPS && z < T - EPS) cutSet.add(z);
  const cuts = dedupeSorted([...cutSet]);

  const covering = (arr, z0, z1) =>
    arr.filter((b) => b.z0 <= z0 + EPS && b.z1 >= z1 - EPS).flatMap((b) => b.paths);

  const colorIdx = (zMid) => {
    let i = 0;
    for (const c of colorCuts) if (zMid > c) i++;
    return i;
  };

  const slabs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const z0 = cuts[i], z1 = cuts[i + 1];
    const adds = covering(shape.bandAdds, z0, z1);
    const subs = covering(shape.bandSubs, z0, z1);
    let polys = G.unionAll([...shape.base.flat(), ...adds]);
    if (subs.length) polys = G.diff(polys, subs);
    polys = G.clean(polys);
    if (!polys.length) continue;
    slabs.push({ z0, z1, paths: polys, colorIdx: colorIdx((z0 + z1) / 2), hash: G.hashPaths(polys) });
  }

  // merge adjacent identical slabs within the same color band
  const merged = [];
  for (const s of slabs) {
    const last = merged[merged.length - 1];
    if (last && last.hash === s.hash && last.colorIdx === s.colorIdx && Math.abs(last.z1 - s.z0) < EPS) {
      last.z1 = s.z1;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}
