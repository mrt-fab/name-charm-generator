// main.js — state + explicit generate() orchestration (same explicit-render idiom as the
// other vault apps). Generation runs only when the user presses 「生成する」.

import { FONT_DEFS, allFontDefs, userFonts, loadFont, addUserFont, removeUserFont, isLoaded, hiraToKata, getFont, hasGlyph } from './font.js';
import { saveUserFont, loadUserFonts, deleteUserFont } from './fontstore.js';
import { layoutString, jointDims } from './layout.js';
import { makeShape, buildJoint } from './joint.js';
import { buildSlabs } from './slabs.js';
import { slabsToTris } from './mesh.js';
import { writeSTL, zipStore, download } from './export.js';
import { initPreview, setParts, setPartColors, setSectionZ } from './preview.js';
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

let lastExport = null;   // { byColor: [tris], text }
let generating = false;
let stale = true;        // parameters changed since last generation

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

async function generate() {
  if (generating) return;
  generating = true;
  setGenerating(true);
  try {
    const def = allFontDefs().find((f) => f.id === state.fontId) || FONT_DEFS[0];
    if (!isLoaded(def.id)) await loadFont(def);

    let text = state.text.replace(/\s+$/, '');
    const font = getFont(def.id);
    const needsKata = state.kataAuto && font && !hasGlyph(font, 'あ') && hasGlyph(font, 'ア');
    if (needsKata) text = hiraToKata(text);
    if (!text.trim()) { setParts([]); lastExport = null; updateStats(); return; }

    const T = state.thickness;
    const dims = jointDims(state.letterH, T, state.clearance, state.cz);
    dims.swing = (state.swingDeg * Math.PI) / 180;

    const t0 = performance.now();
    const lay = layoutString(text, def.id, state.letterH, state.dilate, dims);
    updateWarnings(lay.missing);
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
    stale = false;
    updateStats(performance.now() - t0, lay.widthMm, parts);
  } finally {
    generating = false;
    setGenerating(false);
    updateGenerateButton();
  }
}

function markStale() {
  stale = true;
  updateGenerateButton();
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

function setGenerating(on) {
  const btn = $('generateBtn');
  btn.disabled = on;
  btn.innerHTML = on ? '<span class="spinner"></span> 生成中…' : '生成する';
}

function updateGenerateButton() {
  const btn = $('generateBtn');
  btn.classList.toggle('stale', stale && !generating);
  $('exportBtn').disabled = !lastExport || stale;
  $('exportStale').style.display = lastExport && stale ? 'block' : 'none';
}

function updateWarnings(missing) {
  const el = $('warnMissing');
  if (missing.length) {
    const def = allFontDefs().find((f) => f.id === state.fontId);
    const scope = def?.coverage === 'latin' ? 'このフォントは英数字専用です。' :
                  def?.coverage === 'kata' ? 'このフォントはカタカナ専用です。' : '';
    el.textContent = `${scope}未対応の文字を除外しました: ${missing.join(' ')}`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

function updateStats(ms, widthMm, parts) {
  const el = $('stats');
  if (!parts) { el.textContent = ''; updateGenerateButton(); return; }
  const nTris = parts.reduce((s, p) => s + p.tris.length / 9, 0);
  el.textContent = `全幅 約${widthMm.toFixed(0)}mm ・ ${nTris.toLocaleString()}三角形 ・ 生成 ${ms.toFixed(0)}ms`;
  $('bambuHint').style.display = state.colorCount > 1 ? 'block' : 'none';
  $('exportBtn').textContent = state.colorCount > 1 ? `STL一式をダウンロード（${state.colorCount}色 ZIP）` : 'STLをダウンロード';
  updateGenerateButton();
}

function fontTile(def) {
  const b = document.createElement('button');
  b.dataset.fontId = def.id;
  const sampleText = def.coverage === 'latin' ? 'ABC' : def.coverage === 'kata' ? 'アイウ' : 'あア0';
  b.innerHTML = `<span class="sample" style="font-family:'${def.family}', sans-serif">${sampleText}</span>` +
    `<span class="fname">${def.label}</span>` +
    (def.coverage === 'latin' ? '<span class="badge">英数字のみ</span>' : '') +
    (def.coverage === 'kata' ? '<span class="badge kata">カタカナ</span>' : '') +
    (def.userLoaded ? '<span class="badge user">読込</span><span class="removeFont" title="このフォントを削除">×</span>' : '');
  b.addEventListener('click', (e) => {
    if (e.target.classList.contains('removeFont')) {
      removeLoadedFont(def);
      return;
    }
    state.fontId = def.id;
    refreshFontSelection();
    markStale();
  });
  return b;
}

function buildFontGrid() {
  const grid = $('fontGrid');
  grid.innerHTML = '';
  for (const def of allFontDefs()) grid.appendChild(fontTile(def));
  // "+ load font" tile
  const add = document.createElement('button');
  add.className = 'addFont';
  add.innerHTML = '<span class="plus">＋</span><span class="fname">フォントを読み込む</span>';
  add.addEventListener('click', () => $('fontFile').click());
  grid.appendChild(add);
  refreshFontSelection();
}

function refreshFontSelection() {
  const defs = allFontDefs();
  if (!defs.find((d) => d.id === state.fontId)) state.fontId = defs[0].id;
  const grid = $('fontGrid');
  [...grid.children].forEach((c) => c.classList.toggle('on', c.dataset.fontId === state.fontId));
  const def = defs.find((d) => d.id === state.fontId);
  // kata auto-convert toggle: shown when the font lacks hiragana but has katakana
  let showKata = false;
  if (isLoaded(def.id)) {
    const f = getFont(def.id);
    showKata = !hasGlyph(f, 'あ') && hasGlyph(f, 'ア');
  } else if (def.coverage === 'kata') {
    showKata = true;
  }
  $('kataRow').style.display = showKata ? 'flex' : 'none';
  $('fontNote').textContent = def.note ? '※ ' + def.note : '';
  $('fontNote').style.display = def.note ? 'block' : 'none';
}

async function handleFontFiles(files) {
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const def = addUserFont(file.name.replace(/\.(ttf|otf)$/i, ''), buf);
      def.storeKey = await saveUserFont(file.name, buf);
      state.fontId = def.id;
    } catch (err) {
      alert(`フォント「${file.name}」を読み込めませんでした: ${err.message}`);
    }
  }
  buildFontGrid();
  markStale();
}

async function removeLoadedFont(def) {
  if (def.storeKey !== undefined) await deleteUserFont(def.storeKey).catch(() => {});
  removeUserFont(def.id);
  buildFontGrid();
  markStale();
}

async function restoreUserFonts() {
  try {
    const rows = await loadUserFonts();
    for (const row of rows) {
      try {
        const def = addUserFont(row.name.replace(/\.(ttf|otf)$/i, ''), row.data);
        def.storeKey = row.key;
      } catch (_) { /* corrupted entry — ignore */ }
    }
  } catch (_) { /* IndexedDB unavailable (private mode etc.) */ }
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
      setPartColors(state.colors); // instant — no geometry rebuild needed
    });
  });
  rows.querySelectorAll('input[type="range"][data-band]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.bandMm[+inp.dataset.band] = +inp.value;
      rows.querySelector(`[data-bandout="${inp.dataset.band}"]`).textContent = (+inp.value).toFixed(1) + 'mm';
      updateBandViz();
      markStale();
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
    markStale();
  });
}

function init() {
  initPreview($('viewport'));

  restoreUserFonts().then(() => {
    buildFontGrid();
    generate().catch(console.error); // first render with defaults
  });
  buildBandRows();

  $('textInput').addEventListener('input', (e) => { state.text = e.target.value; markStale(); });
  $('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); generate().catch(console.error); }
  });
  bindRange('dilate', 'dilateOut', (v) => v.toFixed(2) + 'mm', (v) => (state.dilate = v));
  bindRange('letterH', 'letterHOut', (v) => v + 'mm', (v) => (state.letterH = v));
  bindRange('thickness', 'thicknessOut', (v) => v.toFixed(1) + 'mm', (v) => {
    state.thickness = v;
    $('sectionZ').max = v;
    buildBandRows();
  });
  bindSeg('colorSeg', (v) => { state.colorCount = +v; buildBandRows(); markStale(); });
  bindSeg('clearSeg', (v) => { state.clearance = +v; markStale(); });
  bindSeg('loopSeg', (v) => { state.loop = v; markStale(); });
  bindSeg('endSeg', (v) => { state.endHw = v; markStale(); });
  bindRange('chainLinks', 'chainOut', (v) => (v === 0 ? 'なし' : v + 'リンク'), (v) => (state.chainLinks = v));
  $('kataAuto').addEventListener('change', (e) => { state.kataAuto = e.target.checked; markStale(); });

  $('fontFile').addEventListener('change', (e) => {
    if (e.target.files.length) handleFontFiles([...e.target.files]);
    e.target.value = '';
  });

  $('generateBtn').addEventListener('click', () => generate().catch(console.error));
  $('exportBtn').addEventListener('click', doExport);

  const applySection = () => {
    setSectionZ($('sectionOn').checked ? +$('sectionZ').value : null);
  };
  $('sectionOn').addEventListener('change', applySection);
  $('sectionZ').addEventListener('input', applySection);

  updateGenerateButton();
}

init();
