// geom.js — ClipperLib wrappers. All 2D geometry is integer micrometers (1 unit = 1 µm).
// Paths are arrays of {X, Y} (ClipperLib convention). Model space is mm, Y-up.

const C = window.ClipperLib;
export const SCALE = 1000; // µm per mm

export const mm = (v) => Math.round(v * SCALE);
export const toMm = (v) => v / SCALE;

function execute(clipType, subj, clip) {
  const c = new C.Clipper();
  c.StrictlySimple = true; // split self-touching outputs (pixel fonts corner-touch)
  // keep collinear vertices: mesh welding (stackTris XOR caps) pairs cap-boundary
  // edges against wall edges by exact vertices — dropping collinear points there
  // would leave hairline T-junction cracks at every slab interface
  c.PreserveCollinear = true;
  if (subj.length) c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(clipType, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}

export const union = (a, b) => execute(C.ClipType.ctUnion, a, b);
export const unionAll = (paths) => execute(C.ClipType.ctUnion, paths, null);
export const diff = (a, b) => (b && b.length ? execute(C.ClipType.ctDifference, a, b) : a);
export const intersect = (a, b) => execute(C.ClipType.ctIntersection, a, b);

// Polygon offset (dilate > 0, erode < 0), round joins. delta in mm.
export function offset(paths, deltaMm) {
  if (Math.abs(deltaMm) < 1e-6) return paths;
  const co = new C.ClipperOffset(2, 15); // miterLimit, arcTolerance (µm)
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, deltaMm * SCALE);
  return out;
}

export function polyTreeOf(paths) {
  const c = new C.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return tree;
}

// → [{outer: path, holes: [path]}], hole nesting resolved by Clipper's PolyTree.
export function exPolygons(paths) {
  if (!paths.length) return [];
  return C.JS.PolyTreeToExPolygons(polyTreeOf(paths));
}

// Resolve loops with unknown winding (traced templates): EvenOdd fill → oriented paths.
export function normalizeEvenOdd(paths) {
  const c = new C.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const out = new C.Paths();
  c.Execute(C.ClipType.ctUnion, out, C.PolyFillType.pftEvenOdd, C.PolyFillType.pftEvenOdd);
  return out;
}

// Top-level component count (disjoint solids).
export function componentCount(paths) {
  return exPolygons(paths).length;
}

// Min meaningful feature ≈ 0.02mm² (a ~0.14mm dot is unprintable at 0.4mm nozzle).
export const MIN_AREA_UM2 = 20000;

export function clean(paths, deltaUm = 2) {
  // normalize self-intersections / bowties first (weave patch boundaries can pinch)
  const simplified = C.Clipper.SimplifyPolygons(paths, C.PolyFillType.pftNonZero);
  const out = C.Clipper.CleanPolygons(simplified, deltaUm);
  return out.filter((p) => p.length >= 3 && Math.abs(C.Clipper.Area(p)) > MIN_AREA_UM2);
}

export function bounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const pt of p) {
    if (pt.X < minX) minX = pt.X;
    if (pt.X > maxX) maxX = pt.X;
    if (pt.Y < minY) minY = pt.Y;
    if (pt.Y > maxY) maxY = pt.Y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function translate(paths, dxUm, dyUm) {
  return paths.map((p) => p.map((pt) => ({ X: pt.X + dxUm, Y: pt.Y + dyUm })));
}

// ---- shape generators (args in mm, output int µm paths) ----

export function circle(cx, cy, r, n = 64) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push({ X: mm(cx + r * Math.cos(a)), Y: mm(cy + r * Math.sin(a)) });
  }
  return [p];
}

// Capsule: rectangle with semicircular ends from (x1,y1) to (x2,y2), width w.
export function capsule(x1, y1, x2, y2, w, n = 24) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const r = w / 2;
  if (len < 1e-9) return circle(x1, y1, r, n * 2);
  const a0 = Math.atan2(dy, dx);
  const p = [];
  for (let i = 0; i <= n; i++) { // cap around end 2
    const a = a0 - Math.PI / 2 + (i / n) * Math.PI;
    p.push({ X: mm(x2 + r * Math.cos(a)), Y: mm(y2 + r * Math.sin(a)) });
  }
  for (let i = 0; i <= n; i++) { // cap around end 1
    const a = a0 + Math.PI / 2 + (i / n) * Math.PI;
    p.push({ X: mm(x1 + r * Math.cos(a)), Y: mm(y1 + r * Math.sin(a)) });
  }
  return [p];
}

export function rotatePathsAround(paths, cxMm, cyMm, angleRad) {
  const cx = mm(cxMm), cy = mm(cyMm);
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return paths.map((p) => p.map((pt) => {
    const x = pt.X - cx, y = pt.Y - cy;
    return { X: Math.round(cx + x * cos - y * sin), Y: Math.round(cy + x * sin + y * cos) };
  }));
}

// Deterministic content hash for slab compaction. Canonicalizes path start/order.
export function hashPaths(paths) {
  const canon = paths.map((p) => {
    let mi = 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i].X < p[mi].X || (p[i].X === p[mi].X && p[i].Y < p[mi].Y)) mi = i;
    }
    return { key: p[mi].X + ':' + p[mi].Y + ':' + p.length, p, mi };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let h = 5381;
  for (const { p, mi } of canon) {
    for (let i = 0; i < p.length; i++) {
      const pt = p[(mi + i) % p.length];
      h = ((h * 33) ^ pt.X) >>> 0;
      h = ((h * 33) ^ pt.Y) >>> 0;
    }
    h = ((h * 33) ^ 0x7fffffff) >>> 0;
  }
  return h + ':' + paths.length;
}

// Minimum distance between boundary vertices of two path groups + closest pair (µm).
export function closestPoints(pathsA, pathsB) {
  let best = Infinity, pa = null, pb = null;
  for (const p of pathsA) for (const a of p) {
    for (const q of pathsB) for (const b of q) {
      const d = (a.X - b.X) ** 2 + (a.Y - b.Y) ** 2;
      if (d < best) { best = d; pa = a; pb = b; }
    }
  }
  return { dist: Math.sqrt(best), a: pa, b: pb };
}
