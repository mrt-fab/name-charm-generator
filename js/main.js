// main.js — state + regenerate() orchestration (same explicit-render idiom as the
// other vault apps). All UI labels Japanese.

import { FONT_DEFS, loadFont, registerFont, isLoaded, hiraToKata } from './font.js';
import { layoutString, jointDims } from './layout.js';
import { makeShape, buildJoint } from './joint.js';
import { buildSlabs } from './slabs.js';
import { slabsToTris } from './mesh.js';
import { writeSTL, zipStore, download } from './export.js';
import { initPreview, setParts, setSectionZ } from './preview.js';
import { addLoopTab, buildChain } from './hardware.js';
import './validate.js';

const state = {
  text: 'ナマエ',
  fontId: 'cherrybomb',
  letterH: 20,
  thickness: 5,
  dilate: 0.3,
  colorCount: 2,
  bandMm: [2.5, 1.5],          // thickness of band 1 (bottom) and band 2; last band = remainder
  colors: ['#4f86d6', '#f5f2ec', '#f0a8bf'],
  clearance: 0.4,
  cz: 0.2,
  swingDeg: 40,
  loop: 'loop',
  chainLinks: 0,
  endHw: 'none',
  kataAuto: true,
};

let lastExport = null; // { byColor: [tris], text }
let regenTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- pipeline ----------

function colorCuts() {
  const T = state.thickness;
  if (state.colorCount === 1) return [];
  const b1 = Math.min(state.bandMm[0], T - 0.4);
  if (state.colorCount === 2) return [b1];
  const b2 = Math.min(b1 + state.bandMm[1], T - 0.4);
  return [b1, b2];
}

async function regenerate() {
  const def = FONT_DEFS.find((f) => f.id === state.fontId);
  if (!isLoaded(def.id)) {
    if (def.userLoaded) { updateWarnings([], true); return; }
    await loadFont(def);
  }

  let text = state.text.replace(/\s+$/, '');
  if (def.coverage === 'kata' && state.kataAuto) text = hiraToKata(text);
  if (!text.trim()) { setParts([]); lastExport = null; updateStats(); return; }

  const T = state.thickness;
  const dims = jointDims(state.letterH, T, state.clearance, state.cz);
  dims.swing = (state.swingDeg * Math.PI) / 180;

  const t0 = performance.now();
  const lay = layoutString(text, def.id, state.letterH, state.dilate, dims);
  updateWarnings(lay.missing, false);
  if (!lay.placed.length) { setParts([]); lastExport = null; updateStats(); return; }

  const shapes = lay.placed.map((p) => makeShape(p.paths));
  for (const j of lay.joints) {
    buildJoint(shapes[j.left], lay.placed[j.left].bbox, shapes[j.right], lay.placed[j.right].bbox, j.C, dims);
  }

  let extraShapes = [];
  if (state.loop === 'loop') {
    const loop = addLoopTab(shapes[0], lay.placed[0].bbox, T, dims);
    extraShapes = buildChain(shapes[0], loop, T, dims, state.chainLinks, state.endHw);
  }

  const cuts = colorCuts();
  const byColor = Array.from({ length: state.colorCount }, () => []);
  for (const shape of [...shapes, ...extraShapes]) {
    for (const slab of buildSlabs(shape, T, cuts)) {
      byColor[Math.min(slab.colorIdx, state.colorCount - 1)].push(slab);
    }
  }

  const parts = byColor.map((slabs, i) => {
    const { tris } = slabsToTris(slabs);
    return { color: state.colors[i], tris };
  });
  setParts(parts);
  lastExport = { byColor: parts.map((p) => p.tris), text };
  updateStats(performance.now() - t0, lay.widthMm, parts);
}

function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => regenerate().catch(console.error), 150);
}

// ---------- export ----------

function doExport() {
  if (!lastExport) return;
  const name = lastExport.text.replace(/[^\wぁ-ゖァ-ヶー一-龠]/g, '') || 'charm';
  if (lastExport.byColor.length === 1) {
    download(new Blob([writeSTL(lastExport.byColor[0])]), `${name}.stl`);
    return;
  }
  const files = lastExport.byColor.map((tris, i) => ({
    name: `${name}_color${i + 1}.stl`,
    data: writeSTL(tris),
  }));
  files.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      `つながるネームチャーム — 複数色STLの使い方 (Bambu Studio)\n\n` +
      `1. 展開した ${lastExport.byColor.length} 個のSTLをすべて選択し、Bambu Studioへ同時にドラッグ&ドロップ\n` +
      `2. 「これらを1つのオブジェクトの複数パーツとして読み込みますか？」→「はい」\n` +
      `3. オブジェクトリストで各パーツにフィラメント(色)を割り当て\n` +
      `   ・color1 = 最下層(ビルドプレート側) … colorN = 最上層\n` +
      `4. サポートなし・レイヤー0.2mmで印刷\n\n` +
      `色の境界は水平なので、AMSなしでも「レイヤーで一時停止/フィラメント交換」で印刷できます。\n`
    ),
  });
  download(zipStore(files), `${name}_${lastExport.byColor.length}colors.zip`);
}

// ---------- UI ----------

function updateWarnings(missing, needKataFont) {
  const el = $('warnMissing');
  if (needKataFont) {
    el.textContent = 'カタカナボーイのフォントファイルが未読み込みです。下の「フォントファイルを読み込む」から選択してください。';
    el.classList.add('show');
    return;
  }
  if (missing.length) {
    const def = FONT_DEFS.find((f) => f.id === state.fontId);
    const scope = def.coverage === 'latin' ? 'このフォントは英数字専用です。' :
                  def.coverage === 'kata' ? 'カタカナボーイはカタカナ専用です。' : '';
    el.textContent = `${scope}未対応の文字を除外しました: ${missing.join(' ')}`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

function updateStats(ms, widthMm, parts) {
  const el = $('stats');
  if (!parts) { el.textContent = ''; return; }
  const nTris = parts.reduce((s, p) => s + p.tris.length / 9, 0);
  el.textContent = `全幅 約${widthMm.toFixed(0)}mm ・ ${nTris.toLocaleString()}三角形 ・ 生成 ${ms.toFixed(0)}ms`;
  $('bambuHint').style.display = state.colorCount > 1 ? 'block' : 'none';
  $('exportBtn').textContent = state.colorCount > 1 ? `STL一式をダウンロード（${state.colorCount}色 ZIP）` : 'STLをダウンロード';
}

function buildFontGrid() {
  const grid = $('fontGrid');
  grid.innerHTML = '';
  for (const def of FONT_DEFS) {
    const b = document.createElement('button');
    const sampleText = def.coverage === 'latin' ? 'ABC' : def.coverage === 'kata' ? 'アイウ' : 'あア0';
    b.innerHTML = `<span class="sample" style="font-family:'${def.family}', sans-serif">${sampleText}</span>` +
      `<span class="fname">${def.label}</span>` +
      (def.coverage === 'latin' ? '<span class="badge">英数字のみ</span>' : '') +
      (def.coverage === 'kata' ? '<span class="badge kata">カタカナ</span>' : '');
    b.addEventListener('click', () => {
      state.fontId = def.id;
      [...grid.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      $('kataRow').style.display = def.coverage === 'kata' ? 'flex' : 'none';
      $('kataLoad').style.display = def.coverage === 'kata' && !isLoaded('katakanaboy') ? 'block' : 'none';
      $('fontNote').textContent = def.note ? '※ ' + def.note : '';
      $('fontNote').style.display = def.note ? 'block' : 'none';
      scheduleRegen();
    });
    if (def.id === state.fontId) b.classList.add('on');
    grid.appendChild(b);
  }
}

function buildBandRows() {
  const rows = $('bandRows');
  rows.innerHTML = '';
  const T = state.thickness;
  const labels = ['1色目（下層・プレート側）', '2色目（中層）', '3色目（上層）'];
  for (let i = 0; i < state.colorCount; i++) {
    const row = document.createElement('div');
    row.className = 'bandRow';
    const isLast = i === state.colorCount - 1;
    const remainder = (T - colorCuts().reduce((s, c, k) => (k === 0 ? c : s), 0)); // display only
    row.innerHTML = `
      <input type="color" value="${state.colors[i]}" data-i="${i}">
      <label style="font-size:12px; flex:1;">${state.colorCount === 1 ? '本体色' : labels[i]}</label>
      ${!isLast && state.colorCount > 1
        ? `<input type="range" data-band="${i}" min="0.4" max="${(T - 0.4 * (state.colorCount - 1 - i)).toFixed(1)}" step="0.2" value="${state.bandMm[i]}" style="width:90px;">
           <output data-bandout="${i}" style="font-size:11px; color:var(--ink-2); min-width:44px; text-align:right;">${state.bandMm[i].toFixed(1)}mm</output>`
        : `<span style="font-size:11px; color:var(--ink-2);">${state.colorCount === 1 ? `${T.toFixed(1)}mm` : '残り全部'}</span>`}
    `;
    rows.appendChild(row);
  }
  rows.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.colors[+inp.dataset.i] = inp.value;
      updateBandViz();
      scheduleRegen();
    });
  });
  rows.querySelectorAll('input[type="range"][data-band]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.bandMm[+inp.dataset.band] = +inp.value;
      rows.querySelector(`[data-bandout="${inp.dataset.band}"]`).textContent = (+inp.value).toFixed(1) + 'mm';
      updateBandViz();
      scheduleRegen();
    });
  });
  updateBandViz();
}

function updateBandViz() {
  const viz = $('bandViz');
  viz.innerHTML = '';
  const T = state.thickness;
  const cuts = [0, ...colorCuts(), T];
  for (let i = 0; i < state.colorCount; i++) {
    const h = ((cuts[i + 1] - cuts[i]) / T) * 100;
    const div = document.createElement('div');
    div.style.height = h + '%';
    div.style.background = state.colors[i];
    viz.appendChild(div);
  }
}

function bindSeg(id, onPick) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      onPick(b.dataset.v);
    });
  });
}

function bindRange(id, outId, fmt, onChange) {
  const inp = $(id);
  inp.addEventListener('input', () => {
    $(outId).textContent = fmt(+inp.value);
    onChange(+inp.value);
    scheduleRegen();
  });
}

function init() {
  initPreview($('viewport'));
  buildFontGrid();
  buildBandRows();

  $('textInput').addEventListener('input', (e) => { state.text = e.target.value; scheduleRegen(); });
  bindRange('dilate', 'dilateOut', (v) => v.toFixed(2) + 'mm', (v) => (state.dilate = v));
  bindRange('letterH', 'letterHOut', (v) => v + 'mm', (v) => (state.letterH = v));
  bindRange('thickness', 'thicknessOut', (v) => v.toFixed(1) + 'mm', (v) => {
    state.thickness = v;
    $('sectionZ').max = v;
    buildBandRows();
  });
  bindSeg('colorSeg', (v) => { state.colorCount = +v; buildBandRows(); scheduleRegen(); });
  bindSeg('clearSeg', (v) => { state.clearance = +v; scheduleRegen(); });
  bindSeg('loopSeg', (v) => { state.loop = v; scheduleRegen(); });
  bindSeg('endSeg', (v) => { state.endHw = v; scheduleRegen(); });
  bindRange('chainLinks', 'chainOut', (v) => (v === 0 ? 'なし' : v + 'リンク'), (v) => (state.chainLinks = v));
  $('kataAuto').addEventListener('change', (e) => { state.kataAuto = e.target.checked; scheduleRegen(); });

  $('kataFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      registerFont('katakanaboy', await file.arrayBuffer(), 'Katakanaboy');
      $('kataLoad').style.display = 'none';
      buildFontGrid();
      scheduleRegen();
    } catch (err) {
      alert('フォントの読み込みに失敗しました: ' + err.message);
    }
  });

  $('exportBtn').addEventListener('click', doExport);

  const applySection = () => {
    setSectionZ($('sectionOn').checked ? +$('sectionZ').value : null);
  };
  $('sectionOn').addEventListener('change', applySection);
  $('sectionZ').addEventListener('input', applySection);

  regenerate().catch(console.error);
}

init();
