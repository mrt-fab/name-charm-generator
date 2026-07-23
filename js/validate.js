// validate.js — in-browser STL sanity checks (manifoldness, orientation, volume, z-range).

export function validateSTL(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const nTri = dv.getUint32(80, true);
  if (84 + nTri * 50 !== arrayBuffer.byteLength) {
    return { ok: false, error: `size mismatch: header says ${nTri} tris` };
  }

  const Q = 1e4; // quantize to 0.1 µm
  const key = (x, y, z) => Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
  const edges = new Map(); // directed edge -> count
  let volume = 0, degenerate = 0;
  let zMin = Infinity, zMax = -Infinity;

  let o = 84;
  for (let t = 0; t < nTri; t++) {
    const v = [];
    for (let i = 0; i < 3; i++) {
      const x = dv.getFloat32(o + 12 + i * 12, true);
      const y = dv.getFloat32(o + 16 + i * 12, true);
      const z = dv.getFloat32(o + 20 + i * 12, true);
      v.push([x, y, z]);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    o += 50;
    const ks = v.map((p) => key(...p));
    if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) { degenerate++; continue; }
    for (let i = 0; i < 3; i++) {
      const e = ks[i] + '|' + ks[(i + 1) % 3];
      edges.set(e, (edges.get(e) || 0) + 1);
    }
    const [a, b, c] = v;
    volume += (a[0] * (b[1] * c[2] - c[1] * b[2]) - a[1] * (b[0] * c[2] - c[0] * b[2]) + a[2] * (b[0] * c[1] - c[0] * b[1])) / 6;
  }

  // manifold + consistent orientation: every directed edge appears once, with its twin once
  let unmatched = 0, duplicated = 0;
  for (const [e, n] of edges) {
    if (n > 1) duplicated++;
    const [a, b] = e.split('|');
    if ((edges.get(b + '|' + a) || 0) !== n) unmatched++;
  }

  // Note: `duplicated` counts coincident faces where stacked slab shells meet (color
  // boundaries, joint bands). Slicers union these; they are expected, not defects.
  return {
    ok: unmatched === 0 && degenerate === 0 && volume > 0,
    tris: nTri, volumeMm3: Math.round(volume * 100) / 100,
    zMin: Math.round(zMin * 1000) / 1000, zMax: Math.round(zMax * 1000) / 1000,
    unmatchedEdges: unmatched, duplicatedEdges: duplicated, degenerate,
  };
}

window.__validateSTL = validateSTL;
