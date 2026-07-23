// layout.js — character placement, joint centers, narrow-char spacing guarantees.

import * as G from './geom.js';
import { charSolid } from './glyph2d.js';

// Joint radial dimensions (mm). Z bands are derived from thickness T elsewhere (joint.js).
export function jointDims(letterH, T, cxy, cz) {
  const lipW = 1.2;
  let discR = Math.min(6, Math.max(2.7, 0.175 * letterH));
  let shaftR = discR - lipW;
  if (shaftR < 1.5) { shaftR = 1.5; discR = shaftR + lipW; }
  const wall = 1.6;
  const cavR = discR + cxy;
  const holeR = shaftR + cxy;
  const padR = cavR + wall;
  const armW = Math.min(3.5, 2 * shaftR);
  const lipH = Math.max(1.0, Math.min(2.0, 0.24 * T));
  const relief = 0.4; // z range of elephant-foot relief at the bottom
  return { lipW, discR, shaftR, wall, cavR, holeR, padR, armW, lipH, relief, cxy, cz, T,
           minSpan: cavR + discR + wall + 0.5 };
}

// chars: array of characters (spaces allowed). Returns null-solid entries dropped with warnings.
// → { placed: [{ch, paths, bbox}], joints: [{left,right,C:{x,y}mm}], missing: [ch], widthMm }
export function layoutString(text, fontId, letterH, dilate, dims) {
  const baseGap = Math.max(2.0, 2.4 * Math.min(2.5, Math.max(0.7, letterH / 20)));
  const spaceW = letterH * 0.35;

  // build solids, remember spaces as extra gap markers
  const items = [];
  const missing = [];
  let pendingSpace = 0;
  for (const ch of [...text]) {
    if (ch === ' ' || ch === '　') { pendingSpace += spaceW; continue; }
    const solid = charSolid(fontId, ch, letterH, dilate);
    if (!solid || !solid.paths.length) { missing.push(ch); continue; }
    items.push({ ch, solid, spaceBefore: pendingSpace });
    pendingSpace = 0;
  }
  if (!items.length) return { placed: [], joints: [], missing, widthMm: 0 };

  // per-char extra spacing so both joint circles fit inside the char span
  const widths = items.map((it) => G.toMm(it.solid.bbox.w));
  const extras = widths.map((w, i) => {
    if (items.length === 1) return 0;
    const hasL = i > 0, hasR = i < items.length - 1;
    if (!hasL || !hasR) return 0; // one-sided chars never collide internally
    return Math.max(0, dims.minSpan - (w + baseGap));
  });

  // gaps[i] between item i and i+1
  const gaps = [];
  for (let i = 0; i < items.length - 1; i++) {
    gaps.push(baseGap + Math.max(extras[i], extras[i + 1]) + items[i + 1].spaceBefore);
  }

  const placed = [];
  let cursor = 0; // mm, left edge of next char
  for (let i = 0; i < items.length; i++) {
    const bb = items[i].solid.bbox;
    const dx = G.mm(cursor) - bb.minX;
    const paths = G.translate(items[i].solid.paths, dx, 0);
    const bbox = G.bounds(paths);
    placed.push({ ch: items[i].ch, paths, bbox });
    if (i < items.length - 1) cursor = G.toMm(bbox.maxX) + gaps[i];
  }

  const joints = [];
  for (let i = 0; i < placed.length - 1; i++) {
    const A = placed[i], B = placed[i + 1];
    const cx = (G.toMm(A.bbox.maxX) + G.toMm(B.bbox.minX)) / 2;
    // overlap midpoint of the two Y ranges (fallback: midpoint of combined range)
    const lo = Math.max(A.bbox.minY, B.bbox.minY);
    const hi = Math.min(A.bbox.maxY, B.bbox.maxY);
    const cy = lo < hi ? G.toMm((lo + hi) / 2)
                       : G.toMm((Math.min(A.bbox.minY, B.bbox.minY) + Math.max(A.bbox.maxY, B.bbox.maxY)) / 2);
    joints.push({ left: i, right: i + 1, C: { x: cx, y: cy } });
  }

  const all = G.bounds(placed.flatMap((p) => p.paths));
  return { placed, joints, missing, widthMm: G.toMm(all.w) };
}
