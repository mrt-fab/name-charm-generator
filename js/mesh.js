// mesh.js — slab → closed 2-manifold triangle shells (earcut caps + wall quads).
// Output: flat Float32Array-compatible triangle soup [x,y,z, x,y,z, x,y,z, …] in mm.

import * as G from './geom.js';

function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p.X * q.Y - q.X * p.Y;
  }
  return a / 2;
}

function ensureOrientation(ring, ccw) {
  return (signedArea(ring) > 0) === ccw ? ring : [...ring].reverse();
}

// One ExPolygon {outer, holes} between z0..z1 → triangles appended to out[].
function distPtSeg2(p, a, b) {
  const dx = b.X - a.X, dy = b.Y - a.Y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a.X + t * dx - p.X, qy = a.Y + t * dy - p.Y;
  return { d2: qx * qx + qy * qy, t };
}

// Rings that touch at a point (degenerate Clipper output — e.g. two enclosed pockets
// meeting at a glyph corner) break cap/wall edge pairing. Standard fix: keyhole-splice
// the touching ring into the other so the contact becomes an explicit zero-width bridge
// whose two coincident opposite edges pair up.
const TOUCH_EPS2 = 9; // (3µm)²

function ringContact(A, B) {
  for (let ia = 0; ia < A.length; ia++) {
    for (let k = 0, n = B.length; k < n; k++) {
      const r = distPtSeg2(A[ia], B[k], B[(k + 1) % n]);
      if (r.d2 <= TOUCH_EPS2) {
        const a = B[k], b = B[(k + 1) % n];
        const p = { X: Math.round(a.X + r.t * (b.X - a.X)), Y: Math.round(a.Y + r.t * (b.Y - a.Y)) };
        return { ia, k, p };
      }
    }
  }
  return null;
}

// Insert `ring` (cycled from index ia) into `base` after edge k, bridged at point p.
// p is skipped where it coincides with a neighbor — zero-length edges break the mesh.
function spliceRing(base, k, p, ring, ia) {
  const same = (a, b) => a.X === b.X && a.Y === b.Y;
  const out = base.slice(0, k + 1);
  if (!same(p, base[k]) && !same(p, ring[ia])) out.push(p);
  for (let i = 0; i <= ring.length; i++) out.push(ring[(ia + i) % ring.length]);
  if (!same(p, base[(k + 1) % base.length]) && !same(p, ring[ia])) out.push(p);
  out.push(...base.slice(k + 1));
  return out;
}

// drop consecutive duplicate vertices (incl. wrap-around)
function dedupeRing(ring) {
  const out = [];
  for (const pt of ring) {
    const last = out[out.length - 1];
    if (!last || last.X !== pt.X || last.Y !== pt.Y) out.push(pt);
  }
  while (out.length > 1 && out[0].X === out[out.length - 1].X && out[0].Y === out[out.length - 1].Y) out.pop();
  return out;
}

// Insert p into ring after edge k unless it coincides with an endpoint (avoids
// zero-length edges; vertex-vertex contacts are found directly by ringContact).
function insertPoint(ring, k, p) {
  const same = (a, b) => a.X === b.X && a.Y === b.Y;
  if (same(p, ring[k]) || same(p, ring[(k + 1) % ring.length])) return null;
  const out = ring.slice(0, k + 1);
  out.push(p);
  out.push(...ring.slice(k + 1));
  return out;
}

function mergeTouchingRings(ex) {
  let outer = ex.outer;
  let holes = ex.holes.filter((h) => Math.abs(signedArea(h)) >= G.MIN_AREA_UM2);
  for (let guard = 0; guard < 24; guard++) {
    let acted = false;
    // hole vertex on outer edge → splice hole into outer
    for (let h = 0; h < holes.length; h++) {
      const c = ringContact(holes[h], outer);
      if (c) {
        outer = spliceRing(outer, c.k, c.p, holes[h], c.ia);
        holes.splice(h, 1);
        acted = true;
        break;
      }
      // outer vertex on hole edge → add the projection to the hole, retry
      const cR = ringContact(outer, holes[h]);
      if (cR) {
        const mod = insertPoint(holes[h], cR.k, cR.p);
        if (mod) { holes[h] = mod; acted = true; break; }
      }
    }
    if (acted) continue;
    // hole vertex on another hole's edge → merge the two voids into one ring
    for (let i = 0; i < holes.length && !acted; i++) {
      for (let j = 0; j < holes.length && !acted; j++) {
        if (i === j) continue;
        const c = ringContact(holes[i], holes[j]);
        if (c) {
          holes[j] = spliceRing(holes[j], c.k, c.p, holes[i], c.ia);
          holes.splice(i, 1);
          acted = true;
        }
      }
    }
    if (!acted) break;
  }
  return { outer, holes };
}

function prepRings(exRaw, minArea) {
  if (Math.abs(signedArea(exRaw.outer)) < minArea) return null; // degenerate sliver
  const ex = mergeTouchingRings(exRaw);
  const outer = dedupeRing(ensureOrientation(ex.outer, true));
  const holes = ex.holes.map((h) => dedupeRing(ensureOrientation(h, false))).filter((h) => h.length >= 3);
  return [outer, ...holes];
}

// triangulate rings (outer + holes) as a horizontal cap at height z, facing up/down
function emitCap(rings, z, up, out) {
  const verts = [];
  const holeIdx = [];
  for (const r of rings) {
    if (r !== rings[0]) holeIdx.push(verts.length / 2);
    for (const pt of r) verts.push(G.toMm(pt.X), G.toMm(pt.Y));
  }
  const tris = window.earcut(verts, holeIdx.length ? holeIdx : null);
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const ax = verts[a * 2], ay = verts[a * 2 + 1];
    const bx = verts[b * 2], by = verts[b * 2 + 1];
    const cx = verts[c * 2], cy = verts[c * 2 + 1];
    const ccw = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) > 0;
    const [p, q, r] = ccw === up ? [a, b, c] : [a, c, b];
    out.push(verts[p * 2], verts[p * 2 + 1], z, verts[q * 2], verts[q * 2 + 1], z, verts[r * 2], verts[r * 2 + 1], z);
  }
}

// walls — outer CCW → outward normals; holes CW → normals into the hole (outward from solid)
function emitWalls(rings, z0, z1, out) {
  for (const r of rings) {
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      if (p.X === q.X && p.Y === q.Y) continue;
      const px = G.toMm(p.X), py = G.toMm(p.Y), qx = G.toMm(q.X), qy = G.toMm(q.Y);
      out.push(px, py, z0, qx, qy, z0, qx, qy, z1);
      out.push(px, py, z0, qx, qy, z1, px, py, z1);
    }
  }
}

function shellTris(exRaw, z0, z1, out) {
  const rings = prepRings(exRaw, G.MIN_AREA_UM2); // unprintable sliver shell → skip
  if (!rings) return;
  emitCap(rings, z1, true, out);
  emitCap(rings, z0, false, out);
  emitWalls(rings, z0, z1, out);
}

// slabs (one piece or many) → { tris: number[], shells: count }
// Every slab becomes an INDEPENDENTLY closed shell — fine for validation/debugging,
// but stacked shells share coincident interface caps. For export/preview use
// stackTris, which welds a piece into one watertight mesh.
export function slabsToTris(slabs) {
  const out = [];
  let shells = 0;
  for (const s of slabs) {
    const exs = G.exPolygons(s.paths);
    for (const ex of exs) {
      shellTris(ex, s.z0, s.z1, out);
      shells++;
    }
  }
  return { tris: out, shells };
}

// ---- welded piece meshing ---------------------------------------------------
// One piece's slab stack → per-slab triangle arrays forming ONE watertight mesh:
// walls as usual, but caps only where the surface is actually EXPOSED (the XOR vs
// the adjacent contiguous same-color slab). Stacked shells with coincident interface
// faces break slicer auto-repair (Bambu turns the model into a blob); with XOR caps
// the interface faces simply don't exist. Color boundaries keep FULL caps on both
// sides — per-color files must each be closed solids.
//
// The XOR boundaries introduce vertices where the two slabs' outlines cross; those
// land mid-edge on the neighbouring walls/caps (T-junctions = hairline cracks). So
// per interface we collect EVERY vertex present at that z and split every cap edge
// and wall edge that passes through one — after which all interface edges pair up.
const CAP_MIN_AREA_UM2 = 100; // keep tiny exposed steps; drop only true degenerates
const ZEPS = 1e-6;
const SPLIT_D2 = 2.25; // µm² (1.5µm): vertex-on-edge tolerance (integer-rounded crossings)
const CELL = 500;      // µm bucket size for vertex lookup

function prepPathExps(paths) {
  const out = [];
  for (const ex of G.exPolygons(paths)) {
    const rings = prepRings(ex, CAP_MIN_AREA_UM2);
    if (rings) out.push(rings);
  }
  return out;
}

function collectVerts(ringLists, into) {
  for (const rings of ringLists) for (const r of rings) for (const v of r) into.push(v);
}

function bucketize(verts) {
  const m = new Map();
  for (const v of verts) {
    const k = Math.floor(v.X / CELL) + ',' + Math.floor(v.Y / CELL);
    const a = m.get(k);
    if (a) a.push(v); else m.set(k, [v]);
  }
  return m;
}

// vertices strictly inside segment p→q lying on it, sorted along the edge (or null)
function pointsOn(p, q, bk) {
  const dx = q.X - p.X, dy = q.Y - p.Y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return null;
  let found = null;
  const x0 = Math.floor(Math.min(p.X, q.X) / CELL) - 1, x1 = Math.floor(Math.max(p.X, q.X) / CELL) + 1;
  const y0 = Math.floor(Math.min(p.Y, q.Y) / CELL) - 1, y1 = Math.floor(Math.max(p.Y, q.Y) / CELL) + 1;
  for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
    const cell = bk.get(gx + ',' + gy);
    if (!cell) continue;
    for (const v of cell) {
      if ((v.X === p.X && v.Y === p.Y) || (v.X === q.X && v.Y === q.Y)) continue;
      const cross = dx * (v.Y - p.Y) - dy * (v.X - p.X);
      if (cross * cross > SPLIT_D2 * len2) continue;
      const dot = (v.X - p.X) * dx + (v.Y - p.Y) * dy;
      if (dot <= 0 || dot >= len2) continue;
      (found || (found = [])).push({ v, t: dot / len2 });
    }
  }
  if (!found) return null;
  found.sort((a, b) => a.t - b.t);
  const out = [];
  for (const f of found) {
    const l = out[out.length - 1];
    if (!l || l.X !== f.v.X || l.Y !== f.v.Y) out.push(f.v);
  }
  return out;
}

function splitRingLists(ringLists, bk) {
  return ringLists.map((rings) => rings.map((r) => {
    const out = [];
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      out.push(p);
      const mids = pointsOn(p, q, bk);
      if (mids) out.push(...mids);
    }
    return out;
  }));
}

// walls with per-edge splitting at interface vertices (two-chain strip triangulation)
function emitWallsSplit(ringLists, z0, z1, bkLo, bkHi, out) {
  for (const rings of ringLists) for (const r of rings) {
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      if (p.X === q.X && p.Y === q.Y) continue;
      const lo = bkLo ? pointsOn(p, q, bkLo) : null;
      const hi = bkHi ? pointsOn(p, q, bkHi) : null;
      if (!lo && !hi) {
        const px = G.toMm(p.X), py = G.toMm(p.Y), qx = G.toMm(q.X), qy = G.toMm(q.Y);
        out.push(px, py, z0, qx, qy, z0, qx, qy, z1);
        out.push(px, py, z0, qx, qy, z1, px, py, z1);
        continue;
      }
      const B = [p, ...(lo || []), q];
      const Tc = [p, ...(hi || []), q];
      const dx = q.X - p.X, dy = q.Y - p.Y, len2 = dx * dx + dy * dy;
      const tOf = (v) => ((v.X - p.X) * dx + (v.Y - p.Y) * dy) / len2;
      const tri = (a, za, b, zb, c, zc) =>
        out.push(G.toMm(a.X), G.toMm(a.Y), za, G.toMm(b.X), G.toMm(b.Y), zb, G.toMm(c.X), G.toMm(c.Y), zc);
      let bi = 0, tj = 0;
      while (bi < B.length - 1 || tj < Tc.length - 1) {
        const advB = bi < B.length - 1 && (tj >= Tc.length - 1 || tOf(B[bi + 1]) <= tOf(Tc[tj + 1]));
        if (advB) { tri(B[bi], z0, B[bi + 1], z0, Tc[tj], z1); bi++; }
        else { tri(B[bi], z0, Tc[tj + 1], z1, Tc[tj], z1); tj++; }
      }
    }
  }
}

export function stackTris(slabs) {
  const N = slabs.length;
  const res = slabs.map(() => []);
  const contiguous = (a, b) => a && b && Math.abs(a.z1 - b.z0) < ZEPS && a.colorIdx === b.colorIdx;

  const walls = slabs.map((s) => prepPathExps(s.paths));
  const capDown = [], capUp = [];
  for (let i = 0; i < N; i++) {
    const s = slabs[i];
    const prev = contiguous(slabs[i - 1], s) ? slabs[i - 1] : null;
    const next = contiguous(s, slabs[i + 1]) ? slabs[i + 1] : null;
    capDown[i] = prev ? prepPathExps(G.diff(s.paths, prev.paths)) : walls[i];
    capUp[i] = next ? prepPathExps(G.diff(s.paths, next.paths)) : walls[i];
  }

  // per welded interface: split cap edges now, remember the vertex buckets for walls
  const wallBkLo = new Array(N).fill(null);
  const wallBkHi = new Array(N).fill(null);
  for (let i = 1; i < N; i++) {
    if (!contiguous(slabs[i - 1], slabs[i])) continue;
    const verts = [];
    collectVerts(capUp[i - 1], verts);
    collectVerts(capDown[i], verts);
    collectVerts(walls[i - 1], verts);
    collectVerts(walls[i], verts);
    const bk = bucketize(verts);
    capUp[i - 1] = splitRingLists(capUp[i - 1], bk);
    capDown[i] = splitRingLists(capDown[i], bk);
    wallBkHi[i - 1] = bk;
    wallBkLo[i] = bk;
  }

  for (let i = 0; i < N; i++) {
    const s = slabs[i], out = res[i];
    for (const rings of capDown[i]) emitCap(rings, s.z0, false, out);
    for (const rings of capUp[i]) emitCap(rings, s.z1, true, out);
    emitWallsSplit(walls[i], s.z0, s.z1, wallBkLo[i], wallBkHi[i], out);
  }
  return res;
}
