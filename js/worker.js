// worker.js — the whole geometry pipeline runs here (module worker) so the UI thread
// stays at 60fps while sliders drive live regeneration.
//
// Protocol (main → worker):
//   { type:'font',  id, buffer }            register a user font (transferred)
//   { type:'generate', id, text, params }   request a build; only the LATEST wins
// (worker → main):
//   { type:'fontinfo', id, ok, coverage, label, error? }
//   { type:'result', id, colors:[Float32Array], pieces, joints, stats } (transferred)
//   { type:'error', id, message }

import './worker_shim.js';
import '../vendor/opentype.min.js';
import '../vendor/clipper.js';
import '../vendor/earcut.min.js';

import { FONT_DEFS, loadFont, registerFont, isLoaded, getFont, hasGlyph, hiraToKata } from './font.js';
import { layoutString, jointDims } from './layout.js';
import { makeShape, buildJoint } from './joint.js';
import { buildSlabs } from './slabs.js';
import { slabsToTris } from './mesh.js';
import { addLoopTab, buildChain } from './hardware.js';

let busy = false;
let pendingGen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'font') {
    try {
      const font = registerFont(msg.id, msg.buffer, 'w_' + msg.id);
      const coverage = hasGlyph(font, 'あ') ? 'jp' : hasGlyph(font, 'ア') ? 'kata' : hasGlyph(font, 'A') ? 'latin' : 'unknown';
      const label = (font.names?.fullName?.ja || font.names?.fullName?.en || msg.name || '').slice(0, 24);
      postMessage({ type: 'fontinfo', id: msg.id, ok: true, coverage, label });
    } catch (err) {
      postMessage({ type: 'fontinfo', id: msg.id, ok: false, error: err.message });
    }
    return;
  }
  if (msg.type === 'generate') {
    pendingGen = msg;
    pump();
  }
};

async function pump() {
  if (busy) return;
  busy = true;
  while (pendingGen) {
    const req = pendingGen;
    pendingGen = null;
    try {
      const out = await generate(req.text, req.params);
      postMessage({ type: 'result', id: req.id, ...out.payload }, out.transfers);
    } catch (err) {
      postMessage({ type: 'error', id: req.id, message: err.message || String(err) });
    }
    // yield so queued messages (newer requests) can update pendingGen
    await new Promise((r) => setTimeout(r, 0));
  }
  busy = false;
}

async function generate(text, p) {
  const def = FONT_DEFS.find((f) => f.id === p.fontId);
  if (def && !isLoaded(def.id)) await loadFont(def);
  if (!isLoaded(p.fontId)) throw new Error('フォント未登録: ' + p.fontId);

  const font = getFont(p.fontId);
  if (p.kataAuto && !hasGlyph(font, 'あ') && hasGlyph(font, 'ア')) text = hiraToKata(text);

  const T = p.thickness;
  const dims = jointDims(p.letterH, T, p.clearance, p.cz);
  dims.swing = (p.swingDeg * Math.PI) / 180;

  const lay = layoutString(text, p.fontId, p.letterH, p.dilate, dims);
  if (!lay.placed.length) {
    return { payload: { colors: [], pieces: [], joints: [], stats: { missing: lay.missing } }, transfers: [] };
  }

  const shapes = lay.placed.map((pl) => makeShape(pl.paths));
  for (const j of lay.joints) {
    buildJoint(shapes[j.left], lay.placed[j.left].bbox, shapes[j.right], lay.placed[j.right].bbox, j.C, dims);
  }
  let extraShapes = [];
  if (p.loop === 'loop') {
    const loop = addLoopTab(shapes[0], lay.placed[0].bbox, T, dims);
    extraShapes = buildChain(shapes[0], loop, T, dims, p.chainLinks, p.endHw);
  }

  // build per-piece, per-color triangle soups (pieces let the UI animate joints)
  const all = [...shapes, ...extraShapes];
  const nC = p.colorCount;
  const colorArrays = Array.from({ length: nC }, () => []);
  const pieces = [];
  let volumeMm3 = 0;
  let zMax = 0;
  for (let pi = 0; pi < all.length; pi++) {
    const ranges = [];
    for (const slab of buildSlabs(all[pi], all[pi].zTop ?? T, p.colorCuts)) {
      const ci = Math.min(slab.colorIdx, nC - 1);
      const { tris } = slabsToTris([slab]);
      ranges.push({ color: ci, start: colorArrays[ci].length, count: tris.length });
      for (let k = 0; k < tris.length; k++) colorArrays[ci].push(tris[k]);
      zMax = Math.max(zMax, slab.z1);
      volumeMm3 += signedVolume(tris);
    }
    pieces.push({
      isLetter: pi < shapes.length,
      ranges,
    });
  }

  const colors = colorArrays.map((a) => new Float32Array(a));
  const bb = boundsOf(colors);
  const stats = {
    missing: lay.missing,
    widthMm: bb.w, heightMm: bb.h, thickMm: zMax,
    volumeMm3: Math.round(volumeMm3 * 10) / 10,
    weightG: Math.round(volumeMm3 * 0.00124 * 10) / 10, // PLA 1.24 g/cm³
    letterCount: shapes.length,
  };
  const joints = lay.joints.map((j) => ({ left: j.left, right: j.right, x: j.C.x, y: j.C.y }));
  return { payload: { colors, pieces, joints, stats }, transfers: colors.map((c) => c.buffer) };
}

function signedVolume(tris) {
  let v = 0;
  for (let i = 0; i < tris.length; i += 9) {
    v += (tris[i] * (tris[i + 4] * tris[i + 8] - tris[i + 7] * tris[i + 5])
        - tris[i + 1] * (tris[i + 3] * tris[i + 8] - tris[i + 6] * tris[i + 5])
        + tris[i + 2] * (tris[i + 3] * tris[i + 7] - tris[i + 6] * tris[i + 4])) / 6;
  }
  return v;
}

function boundsOf(colors) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of colors) {
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < minX) minX = a[i];
      if (a[i] > maxX) maxX = a[i];
      if (a[i + 1] < minY) minY = a[i + 1];
      if (a[i + 1] > maxY) maxY = a[i + 1];
    }
  }
  return { w: Math.round((maxX - minX) * 10) / 10, h: Math.round((maxY - minY) * 10) / 10 };
}
