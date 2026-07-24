// layout.js — character placement, joint centers, narrow-char spacing guarantees.

import * as G from './geom.js';
import { charSolid } from './glyph2d.js';

// Interlocked-ring joint dimensions (mm) — user-approved v6 design, dimensioned at
// T=10 and scaled by s = clamp(T/10, 0.72, 1.2). z-placement anchors on the tail
// ring: its top clears the letter's top face by 0.3mm, and the head plate (whose far
// rim is the bar) is centered on the ring so the bar sits in the middle of the hole.
export function jointDims(letterH, T, cxy, cz) {
  const s = Math.min(1.2, Math.max(0.72, T / 10));
  const Ro = 3.6 * s;                 // tail ring outer radius
  const Rh = 2.0 * s;                 // tail ring hole radius
  const tY = 2.6 * s;                 // tail ring thickness along Y
  const zc = Math.max(Ro + 0.4, Math.min(0.61 * T, T - 0.3 - Ro));
  const plate0 = zc - 1.2 * s;        // head plate z-range (bar cross 1.8s × 2.4s)
  const plate1 = zc + 1.2 * s;
  const taper1 = Math.min(T - 0.3, plate1 + 2.0 * s);
  const corbelRate = 1.38;            // ~54° corbel out of the wall
  const corbel0 = Math.max(0.3, plate0 - (5.95 * s + 3.0) / corbelRate);
  const clip0 = Math.max(0.2, zc - Ro - 1.3); // ring underside taper start
  return { s, Ro, Rh, tY, zc, plate0, plate1, taper1, corbel0, corbelRate, clip0,
           slotX: 1.4 * s, slotY: 4.6 * s, slotZ0: plate0 - 0.55 * s, slotZ1: plate1 + 0.55 * s,
           g: 5.6 * s, cxy, cz, T,
           minSpan: 9.0 * s };
}

// chars: array of characters (spaces allowed). Returns null-solid entries dropped with warnings.
// → { placed: [{ch, paths, bbox}], joints: [{left,right,C:{x,y}mm}], missing: [ch], widthMm }
export function layoutString(text, fontId, letterH, dilate, dims) {
  const baseGap = dims.g; // wall-to-wall gap is dictated by the interlock geometry
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
