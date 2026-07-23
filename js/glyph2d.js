// glyph2d.js — per-character watertight 2D solid: union windings, dilate, bridge disjoint parts.

import * as G from './geom.js';
import { glyphContours } from './font.js';

const solidCache = new Map();

// Returns { paths, bbox } (int µm, baseline y=0) or null if glyph missing.
export function charSolid(fontId, ch, letterHmm, dilateMm) {
  const key = fontId + '|' + ch + '|' + letterHmm + '|' + dilateMm;
  if (solidCache.has(key)) return solidCache.get(key);

  const contours = glyphContours(fontId, ch, letterHmm);
  if (!contours) { solidCache.set(key, null); return null; }

  let paths = G.unionAll(contours);
  if (dilateMm > 0) paths = G.offset(paths, dilateMm);
  // morphological close: removes zero-width slits/self-touching seams that pixel-style
  // fonts (DotGothic16) produce after union — these break cap/wall edge pairing.
  paths = G.offset(G.offset(paths, 0.02), -0.02);
  paths = bridgeComponents(paths);
  paths = G.clean(paths);
  const result = { paths, bbox: G.bounds(paths) };
  solidCache.set(key, result);
  return result;
}

// Connect disjoint components (dakuten, i-dots, …) with capsule bars via a greedy MST.
export function bridgeComponents(paths, barW = 1.5, extend = 0.8) {
  let ex = G.exPolygons(paths);
  if (ex.length <= 1) return paths;

  for (let attempt = 0; attempt < 3; attempt++) {
    const comps = ex.map((e) => [e.outer, ...e.holes]);
    // Prim's MST over components, edge weight = closest vertex distance
    const inTree = new Set([0]);
    const bars = [];
    while (inTree.size < comps.length) {
      let best = { dist: Infinity, i: -1, j: -1, a: null, b: null };
      for (const i of inTree) {
        for (let j = 0; j < comps.length; j++) {
          if (inTree.has(j)) continue;
          const c = G.closestPoints([comps[i][0]], [comps[j][0]]);
          if (c.dist < best.dist) best = { dist: c.dist, i, j, a: c.a, b: c.b };
        }
      }
      inTree.add(best.j);
      // extend the bar past both closest points to guarantee overlap
      const ax = G.toMm(best.a.X), ay = G.toMm(best.a.Y);
      const bx = G.toMm(best.b.X), by = G.toMm(best.b.Y);
      const len = Math.hypot(bx - ax, by - ay) || 1e-6;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const e = extend * (attempt + 1);
      bars.push(G.capsule(ax - ux * e, ay - uy * e, bx + ux * e, by + uy * e, barW * (attempt + 1)));
    }
    const merged = G.unionAll([...paths, ...bars.flat()]);
    ex = G.exPolygons(merged);
    if (ex.length === 1) return merged;
    paths = merged;
  }
  return paths; // give up after widening twice; caller still gets printable (if separate) shapes
}

export function clearGlyphCache() { solidCache.clear(); }
