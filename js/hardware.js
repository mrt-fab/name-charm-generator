// hardware.js v3 — reference-faithful hardware.
//
// - Chain: real tilted-oval-link chain (links alternate ±35° about the chain axis and
//   thread each other), re-modeled after the reference pendant. Built with the
//   sphere-chain sweep (wire3d.js), prints support-free like the reference.
// - Snap ring: outline traced from the reference pendant (hook-and-eye clasp),
//   extruded 3.2mm, with a thin eyelet stub the chain threads.
// - Carabiner: body/gate outlines traced from the reference carabiner (0.6×), gate on
//   our captured-disc pivot (print-in-place), plus a SEPARATELY-printed screw knob
//   locking the gate tip (post + notch collar + skirt, discretized-helix thread).
//
// Every hardware piece carries its own zTop (thickness) independent of the letters.

import * as G from './geom.js';
import { anchorCapsule } from './joint.js';
import { sphereChainBands, ovalLinkPath, minPointDist } from './wire3d.js';
import { SNAP_RING, CARABINER } from './hw_templates.js';

function ovalRing(cx, cy, L, W, w) {
  const hl = L / 2 - W / 2;
  const outer = G.capsule(cx - hl, cy, cx + hl, cy, W);
  const inner = G.capsule(cx - hl, cy, cx + hl, cy, W - 2 * w);
  return G.diff(outer, inner);
}

// template loops (mm, centered) → int paths at scale/offset/rotation, nesting resolved
function templatePaths(loops, s, cx, cy, rotRad = 0) {
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
  const paths = loops.map((loop) => loop.map(([x, y]) => {
    const xr = x * cos - y * sin, yr = x * sin + y * cos;
    return { X: G.mm(cx + xr * s), Y: G.mm(cy + yr * s) };
  }));
  return G.normalizeEvenOdd(paths);
}

// ---- chain ------------------------------------------------------------------

export const CHAIN = {
  wireR: 0.65,       // wire radius (Ø1.3)
  Lc: 6.2, Wc: 4.2,  // link centerline dims (outer ≈ 7.5 × 5.5)
  tilt: (35 * Math.PI) / 180,
  pitch: 3.9,
  hs: 0.3,           // slab height for wire sections
};

const chainH = () => CHAIN.Wc * Math.sin(CHAIN.tilt) + 2 * CHAIN.wireR;

// Thin flat eyelet that the first/last links thread. Its bar cross-section (1.5×1.8)
// fits through the links' ~2.9mm inner aperture.
const EYELET = { L: 5.6, W: 3.8, wall: 1.5, T: 1.8 };

function addEyelet(shape, xEdge, cy, dir) {
  const cx = xEdge + dir * (EYELET.L / 2 - 1.0); // overlap 1mm into the parent
  shape.bandAdds.push({ z0: 0, z1: EYELET.T, paths: ovalRing(cx, cy, EYELET.L, EYELET.W, EYELET.wall) });
  return { barX: cx + dir * (EYELET.L / 2 - EYELET.wall / 2), cy };
}

function linkPath(cx, cy, sign) {
  const zc = (CHAIN.Wc / 2) * Math.sin(CHAIN.tilt) + CHAIN.wireR;
  return ovalLinkPath(cx, cy, zc, CHAIN.Lc, CHAIN.Wc, sign * CHAIN.tilt);
}

// ---- public API -------------------------------------------------------------

// Loop tab merged into the first character. THIN (jump rings / straps must thread
// it) and centered at mid-thickness for balance. Support-free print: a 45°
// staircase ramp grows the underside out of the letter's flank, a slim foot rises
// under the far cap, and the rails bridge the short span between them.
export function addLoopTab(shape, bbox, T, d) {
  const L = 11, W = 9, w = 2.2;
  const cy = G.toMm((bbox.minY + bbox.maxY) / 2);
  const edge = G.toMm(bbox.minX);
  const cx = edge + 1.4 - L / 2;
  const ring = ovalRing(cx, cy, L, W, w);
  const link = anchorCapsule(shape.base[0], edge, cy, cx + L / 2 - w / 2, cy, W * 0.55);
  const fp = G.unionAll([...ring, ...link]);
  const hl = L / 2 - W / 2;

  const tabT = Math.min(2.8, T);
  const zT0 = (T - tabT) / 2, zT1 = zT0 + tabT;
  const rect = (x0, x1) => [[
    { X: G.mm(x0), Y: G.mm(cy - W) }, { X: G.mm(x1), Y: G.mm(cy - W) },
    { X: G.mm(x1), Y: G.mm(cy + W) }, { X: G.mm(x0), Y: G.mm(cy + W) },
  ]];

  if (zT0 < 0.3) {
    shape.base.push(fp);                       // thin letters: tab spans full height
  } else {
    shape.bandAdds.push({ z0: zT0, z1: zT1, paths: fp });
    // 45° ramp out of the letter flank (each band reaches one step further left)
    const step = 0.25;
    for (let zb = 0; zb < zT0 - 1e-9; zb += step) {
      const zt = Math.min(zb + step, zT0);
      const reach = Math.min(zb + step, 1.7);  // stops before the loop hole
      shape.bandAdds.push({ z0: zb, z1: zt, paths: G.intersect(fp, rect(edge - reach, edge + 3)) });
    }
    // slim foot under the far cap; the rails bridge ramp → foot (~5mm, printable)
    shape.bandAdds.push({ z0: 0, z1: zT0, paths: G.intersect(fp, rect(cx - L / 2 - 1, cx - L / 2 + 1.1)) });
  }

  shape.bandSubs.push({ z0: 0, z1: T, paths: G.capsule(cx - hl, cy, cx + hl, cy, W - 2 * w) });
  return { cx, cy, L, W, w, leftX: cx - L / 2, footprint: ring };
}

// Chain + end hardware. Returns extra piece shapes (each with its own zTop).
// endType: 'none' | 'snapring' | 'carabiner'
export function buildChain(firstShape, loop, T, d, linkCount, endType) {
  const shapes = [];
  const cy = loop.cy;
  if (linkCount === 0 && endType === 'none') return shapes;
  const n = Math.max(linkCount, endType !== 'none' ? 2 : 0); // end hardware needs ≥2 links

  // eyelet on the loop tab for the first link
  const eye = addEyelet(firstShape, loop.leftX, cy, -1);

  const hl = CHAIN.Lc / 2 - CHAIN.Wc / 2;
  const paths3d = [];
  let cx = eye.barX - hl - 0.4; // first link's right cap wraps the eyelet bar
  for (let k = 0; k < n; k++) {
    const pts = linkPath(cx, cy, k % 2 === 0 ? 1 : -1);
    paths3d.push(pts);
    shapes.push({ base: [], bandAdds: sphereChainBands(pts, CHAIN.wireR, CHAIN.hs), bandSubs: [], zTop: chainH() });
    cx -= CHAIN.pitch;
  }
  const lastCx = cx + CHAIN.pitch;
  // the end piece's eyelet bar must sit inside the LAST link's left cap
  const endBarX = lastCx - hl + 0.4;
  // eyelet geometry: barX = xEdge + dir*(L/2-1.0) + dir*(L/2-wall/2)
  const endEdgeX = endBarX - (EYELET.L / 2 - 1.0) - (EYELET.L / 2 - EYELET.wall / 2);

  if (endType === 'snapring') {
    shapes.push(buildSnapRing(endEdgeX, cy));
  } else if (endType === 'carabiner') {
    shapes.push(...buildCarabiner(endEdgeX, cy, d));
  }

  buildChain._lastPaths = paths3d; // debug hook (clearance QA from the console)
  return shapes;
}

// ---- snap ring (traced from the reference pendant) --------------------------

function buildSnapRing(edgeX, cy) {
  const s = 1.0;                              // reference size ≈ Ø21.8mm
  const R = (SNAP_RING.w / 2) * s;
  const cx = edgeX + 0.6 - R;                 // eyelet embeds 0.6mm into the ring wall
  // rotate so the clasp (bottom-right in the trace) sits at the top, like the photo
  const paths = templatePaths(SNAP_RING.loops, s, cx, cy, Math.PI);
  const shape = { base: [], bandAdds: [{ z0: 0, z1: 3.2, paths }], bandSubs: [], zTop: 3.2 };
  addEyelet(shape, edgeX, cy, +1);
  return shape;
}

// ---- carabiner (traced body/gate + captured-disc pivot + separate screw knob) ----

function loopBBox(loop) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of loop) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function buildCarabiner(edgeX, cy, d) {
  const { cxy, cz } = d;
  const s = 0.6;
  const T = 5;                                 // carabiner's own thickness
  const lipH = 1.2;
  const bodyLoop = [CARABINER.loops[0]];
  const gateLoop = [CARABINER.loops[1]];
  const pin = CARABINER.loops[2];
  const pinC = {
    x: pin.reduce((a, p) => a + p[0], 0) / pin.length,
    y: pin.reduce((a, p) => a + p[1], 0) / pin.length,
  };

  const W = CARABINER.w * s, H = CARABINER.h * s;
  // hang horizontally: spine (template +y) points toward the chain (+x) → rotate -90°
  const rot = -Math.PI / 2;
  const cxB = edgeX + 0.6 - H / 2;             // rotated: template height lies along x

  const place = (loops, extra = 0) => {
    let p = templatePaths(loops, s, cxB, cy, rot);
    return extra ? G.offset(p, extra) : p;
  };
  const rotP = (p) => ({
    x: cxB + (p.x * Math.cos(rot) - p.y * Math.sin(rot)) * s,
    y: cy + (p.x * Math.sin(rot) + p.y * Math.cos(rot)) * s,
  });

  const bodyPaths = place(bodyLoop);
  const gatePaths = place(gateLoop, -0.08);    // extra print-in-place clearance
  const Pv = rotP(pinC);                       // pivot center (world)

  // body: traced outline + socket pad, minus captured-disc socket + swing slot
  const discR = 2.4, shaftR = 1.5;
  const body = {
    base: [G.unionAll([...bodyPaths, ...G.circle(Pv.x, Pv.y, discR + cxy + 1.5)])],
    bandAdds: [], bandSubs: [], zTop: T,
  };
  body.bandSubs.push({ z0: 0, z1: lipH, paths: G.circle(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: T - lipH, z1: T, paths: G.circle(Pv.x, Pv.y, shaftR + cxy) });
  body.bandSubs.push({ z0: 0, z1: 0.4, paths: G.circle(Pv.x, Pv.y, shaftR + cxy + 0.15) });
  const gb = loopBBox(CARABINER.loops[1]);
  const gateMid = rotP({ x: (gb.x0 + gb.x1) / 2, y: (gb.y0 + gb.y1) / 2 });
  const a0 = Math.atan2(gateMid.y - Pv.y, gateMid.x - Pv.x);
  const slot = [];
  for (let k = 0; k <= 5; k++) {
    const th = a0 + (k / 5) * (55 * Math.PI / 180);
    slot.push(...G.capsule(Pv.x, Pv.y, Pv.x + 6.5 * Math.cos(th), Pv.y + 6.5 * Math.sin(th), 3.0 + 2 * cxy));
  }
  body.bandSubs.push({ z0: lipH, z1: T - lipH, paths: [...G.circle(Pv.x, Pv.y, discR + cxy), ...slot] });

  // screw-lock geometry (post at the gate tip, knob printed separately)
  const tipT = rotP({ x: (gb.x0 + gb.x1) / 2, y: gb.y1 });
  const post = { x: tipT.x, y: tipT.y };
  const rCore = 1.5, rThread = 2.2, lobeW = 1.3, pitch = 2.0, hs = 0.15;
  const collarR = 3.0;

  // gate: traced outline cleared around pad+post, + shaft + disc/arm + notch collar
  const padClear = G.circle(Pv.x, Pv.y, discR + cxy + 1.5 + cxy);
  const postClear = G.circle(post.x, post.y, collarR + 1.4);
  const gateBody = G.diff(G.diff(gatePaths, padClear), postClear);
  const gate = { base: [G.circle(Pv.x, Pv.y, shaftR), gateBody], bandAdds: [], bandSubs: [], zTop: T };
  const mouthDir = a0 + Math.PI / 2; // collar mouth opens along the swing direction
  const collar = G.diff(
    G.diff(G.circle(post.x, post.y, collarR), G.circle(post.x, post.y, rCore + cxy + 0.15)),
    G.capsule(post.x, post.y, post.x + 4.5 * Math.cos(mouthDir), post.y + 4.5 * Math.sin(mouthDir), 2 * (rCore + cxy + 0.15))
  );
  gate.bandAdds.push({
    z0: lipH + cz, z1: T - lipH - cz,
    paths: [
      ...G.circle(Pv.x, Pv.y, discR),
      ...anchorCapsule(gateBody, gateMid.x, gateMid.y, Pv.x, Pv.y, 3.0),
      ...collar,
      ...anchorCapsule(gateBody, tipT.x, tipT.y, post.x, post.y, 2.4),
    ],
  });

  // body: low boss + threaded post rising past the gate
  body.bandAdds.push({ z0: 0, z1: 1.0, paths: G.circle(post.x, post.y, collarR + 2.0) });
  const postTop = T + 3.0;
  body.bandAdds.push({ z0: 0, z1: postTop, paths: G.circle(post.x, post.y, rCore) });
  for (let z = 1.2; z < postTop - 1e-9; z += hs) {
    const z1 = Math.min(z + hs, postTop);
    const phi = ((z + hs / 2) / pitch) * Math.PI * 2;
    body.bandAdds.push({ z0: z, z1, paths: G.capsule(post.x, post.y,
      post.x + rThread * Math.cos(phi), post.y + rThread * Math.sin(phi), lobeW) });
  }

  // knob: separate print, laid out beside the carabiner
  const knob = { base: [], bandAdds: [], bandSubs: [], zTop: 7.0 };
  const kx = cxB - H / 2 - 12, ky = cy;
  const kring = [];
  const nK = 96, lobes = 12, rK = 4.6;
  for (let i = 0; i < nK; i++) {
    const a = (i / nK) * Math.PI * 2;
    const rr = rK + 0.35 * Math.cos(a * lobes);
    kring.push({ X: G.mm(kx + rr * Math.cos(a)), Y: G.mm(ky + rr * Math.sin(a)) });
  }
  knob.bandAdds.push({ z0: 0, z1: 1.8, paths: G.diff([kring], G.circle(kx, ky, collarR + cxy)) });
  for (let z = 1.8; z < 7.0 - 1e-9; z += hs) {
    const z1 = Math.min(z + hs, 7.0);
    const phi = ((z + hs / 2) / pitch) * Math.PI * 2;
    knob.bandAdds.push({ z0: z, z1, paths: G.diff([kring], [
      ...G.circle(kx, ky, rCore + cxy),
      ...G.capsule(kx, ky, kx + (rThread + cxy) * Math.cos(phi), ky + (rThread + cxy) * Math.sin(phi), lobeW + 2 * cxy),
    ]) });
  }

  addEyelet(body, edgeX, cy, +1);
  return [body, gate, knob];
}

export { minPointDist };
