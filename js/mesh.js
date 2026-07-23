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

function shellTris(exRaw, z0, z1, out) {
  if (Math.abs(signedArea(exRaw.outer)) < G.MIN_AREA_UM2) return; // unprintable sliver shell
  const ex = mergeTouchingRings(exRaw);
  const outer = dedupeRing(ensureOrientation(ex.outer, true));
  const holes = ex.holes.map((h) => dedupeRing(ensureOrientation(h, false))).filter((h) => h.length >= 3);
  const rings = [outer, ...holes];

  // earcut input
  const verts = [];
  const holeIdx = [];
  for (const r of rings) {
    if (r !== outer) holeIdx.push(verts.length / 2);
    for (const pt of r) verts.push(G.toMm(pt.X), G.toMm(pt.Y));
  }
  const tris = window.earcut(verts, holeIdx.length ? holeIdx : null);

  // caps — force top cap CCW (up normal), bottom reversed
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const ax = verts[a * 2], ay = verts[a * 2 + 1];
    const bx = verts[b * 2], by = verts[b * 2 + 1];
    const cx = verts[c * 2], cy = verts[c * 2 + 1];
    const ccw = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) > 0;
    const [p, q, r] = ccw ? [a, b, c] : [a, c, b];
    // top
    out.push(verts[p * 2], verts[p * 2 + 1], z1, verts[q * 2], verts[q * 2 + 1], z1, verts[r * 2], verts[r * 2 + 1], z1);
    // bottom (reversed)
    out.push(verts[p * 2], verts[p * 2 + 1], z0, verts[r * 2], verts[r * 2 + 1], z0, verts[q * 2], verts[q * 2 + 1], z0);
  }

  // walls — outer CCW → outward normals; holes CW → normals into the hole (outward from solid)
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

// slabs (one piece or many) → { tris: number[], shells: count }
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
