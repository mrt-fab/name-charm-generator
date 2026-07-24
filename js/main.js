// main.js — UI thread: state, realtime worker client, preview wiring.
// Geometry runs in js/worker.js; every parameter change regenerates live
// (120ms debounce). Only the TEXT needs explicit confirmation (「このテキストで生成」).

import { FONT_DEFS, allFontDefs, userFonts, addUserFont, removeUserFont } from './font.js';
import { saveUserFont, loadUserFonts, deleteUserFont } from './fontstore.js';
import { writeSTL, zipStore, download } from './export.js';
import { initPreview, setParts, setPartColors, setSectionZ, setDimmed } from './preview.js';
import './validate.js';

const state = {
  text: 'ナマエ',            // confirmed text (worker input)
  fontId: 'cherrybomb',
  sizeMm: 20,
  thickPct: 50,
  thickMmOverride: null,     // 詳細設定で直接指定した場合のみ
  dilate: 0.3,
  colorCount: 2,
  bandMm: [4.0, 3.0],
  colors: ['#4f86d6', '#f5f2ec', '#f0a8bf'],
  clearance: 0.4,
  cz: 0.2,
  swingDeg: 40,
  loop: 'loop',
  chainLinks: 0,
  endHw: 'none',
  kataAuto: true,
};
let draftText = state.text;

const thicknessMm = () =>
  state.thickMmOverride ?? Math.round(state.sizeMm * state.thickPct / 100 * 2) / 2;

function colorCuts() {
  const T = thicknessMm();
  if (state.colorCount === 1) return [];
  const b1 = Math.min(state.bandMm[0], T - 0.4);
  if (state.colorCount === 2) return [b1];
  return [b1, Math.min(b1 + state.bandMm[1], T - 0.4)];
}

// ---------- worker client ----------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let genSeq = 0;
let latestSent = 0;
let lastResult = null;   // { colors: Float32Array[], stats }
let regenTimer = null;
let progressTimer = null;

function requestGenerate() {
  const id = ++genSeq;
  latestSent = id;
  worker.postMessage({
    type: 'generate', id,
    text: state.text,
    params: {
      fontId: state.fontId,
      letterH: state.sizeMm,
      thickness: thicknessMm(),
      dilate: state.dilate,
      colorCount: state.colorCount,
      colorCuts: colorCuts(),
      clearance: state.clearance,
      cz: state.cz,
      swingDeg: state.swingDeg,
      loop: state.loop,
      chainLinks: state.chainLinks,
      endHw: state.endHw,
      kataAuto: state.kataAuto,
    },
  });
  setDimmed(true);
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => $('genProgress').classList.add('show'), 500);
}

function scheduleGenerate() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(requestGenerate, 120);
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'fontinfo') { onFontInfo(msg); return; }
  if (msg.id !== latestSent) return; // stale result — a newer request is in flight
  clearTimeout(progressTimer);
  $('genProgress').classList.remove('show');
  setDimmed(false);
  if (msg.type === 'error') {
    console.error('generate error:', msg.message);
    return;
  }
  lastResult = msg;
  setParts(msg.colors.map((tris, i) => ({ color: state.colors[i], tris })));
  updateWarnings(msg.stats.missing || []);
  updateStats(msg.stats);
  updateButtons();
};

// ---------- export ----------

function doExport() {
  if (!lastResult || !lastResult.colors.length) return;
  const name = state.text.replace(/[^\wぁ-ゖァ-ヶー一-龠]/g, '') || 'charm';
  const byColor = lastResult.colors;
  if (byColor.length === 1) {
    download(new Blob([writeSTL(byColor[0])]), `${name}.stl`);
    flashDownloaded();
    return;
  }
  const files = byColor.map((tris, i) => ({ name: `${name}_color${i + 1}.stl`, data: writeSTL(tris) }));
  files.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      `つながるネームチャーム — 複数色STLの使い方 (Bambu Studio)\n\n` +
      `1. 展開した ${byColor.length} 個のSTLをすべて選択し、Bambu Studioへ同時にドラッグ&ドロップ\n` +
      `2. 「これらを1つのオブジェクトの複数パーツとして読み込みますか？」→「はい」\n` +
      `3. オブジェクトリストで各パーツにフィラメント(色)を割り当て\n` +
      `   ・color1 = 最下層(ビルドプレート側) … colorN = 最上層\n` +
      `4. サポートなし・レイヤー0.2mmで印刷\n\n` +
      `色の境界は水平なので、AMSなしでも「レイヤーで一時停止/フィラメント交換」で印刷できます。\n`
    ),
  });
  download(zipStore(files), `${name}_${byColor.length}colors.zip`);
  flashDownloaded();
}

function flashDownloaded() {
  const b = $('exportBtn');
  const orig = b.textContent;
  b.textContent = '✓ ダウンロードしました';
  setTimeout(() => { b.textContent = orig; }, 2000);
}

// ---------- fonts ----------

const $ = (id) => document.getElementById(id);
const pendingFontInfo = new Map(); // id -> def (awaiting worker parse ack)

function sendFontToWorker(id, name, buffer) {
  worker.postMessage({ type: 'font', id, name, buffer }, [buffer]);
}

function onFontInfo(msg) {
  const def = pendingFontInfo.get(msg.id);
  pendingFontInfo.delete(msg.id);
  if (!msg.ok) {
    if (def) { removeUserFont(def.id); buildFontGrid(); }
    alert('フォントを読み込めませんでした: ' + (msg.error || ''));
    return;
  }
  if (def) {
    def.coverage = msg.coverage;
    if (msg.label) def.label = msg.label;
    buildFontGrid();
    requestGenerate();
  }
}

async function handleFontFiles(files) {
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const def = addUserFont(file.name.replace(/\.(ttf|otf)$/i, ''), buf.slice(0)); // main copy (FontFace/label)
      def.storeKey = await saveUserFont(file.name, buf.slice(0));
      pendingFontInfo.set(def.id, def);
      sendFontToWorker(def.id, file.name, buf);
      state.fontId = def.id;
    } catch (err) {
      alert(`フォント「${file.name}」を読み込めませんでした: ${err.message}`);
    }
  }
  buildFontGrid();
}

async function removeLoadedFont(def) {
  if (def.storeKey !== undefined) await deleteUserFont(def.storeKey).catch(() => {});
  removeUserFont(def.id);
  buildFontGrid();
  if (state.fontId === def.id) { state.fontId = FONT_DEFS[0].id; refreshFontSelection(); }
  scheduleGenerate();
}

async function restoreUserFonts() {
  try {
    const rows = await loadUserFonts();
    for (const row of rows) {
      try {
        const def = addUserFont(row.name.replace(/\.(ttf|otf)$/i, ''), row.data.slice(0));
        def.storeKey = row.key;
        pendingFontInfo.set(def.id, def);
        sendFontToWorker(def.id, row.name, row.data.slice(0));
      } catch (_) { /* corrupted entry */ }
    }
  } catch (_) { /* IndexedDB unavailable */ }
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
    if (e.target.classList.contains('removeFont')) { removeLoadedFont(def); return; }
    state.fontId = def.id;
    refreshFontSelection();
    scheduleGenerate();
  });
  return b;
}

function buildFontGrid() {
  const grid = $('fontGrid');
  grid.innerHTML = '';
  for (const def of allFontDefs()) grid.appendChild(fontTile(def));
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
  $('kataRow').style.display = def.coverage === 'kata' ? 'flex' : 'none';
  $('fontNote').textContent = def.note ? '※ ' + def.note : '';
  $('fontNote').style.display = def.note ? 'block' : 'none';
}

// ---------- UI ----------

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

function updateStats(s) {
  if (!s || s.widthMm === undefined) { $('stats').textContent = ''; return; }
  const mins = Math.max(5, Math.round(s.volumeMm3 / 600));  // ~10mm³/s effective + overhead → 目安
  $('stats').textContent =
    `約 ${s.widthMm} × ${s.heightMm} × ${s.thickMm}mm ・ 推定 ${s.weightG}g ・ 印刷目安 ${mins}分`;
  $('bambuHint').style.display = state.colorCount > 1 ? 'block' : 'none';
  $('exportBtn').textContent = state.colorCount > 1 ? `STL一式をダウンロード（${state.colorCount}色 ZIP）` : 'STLをダウンロード';
}

function updateButtons() {
  const dirty = draftText !== state.text;
  $('textGenBtn').classList.toggle('stale', dirty);
  $('exportBtn').disabled = !lastResult;
}

function confirmText() {
  state.text = draftText;
  updateButtons();
  requestGenerate();
}

function buildBandRows() {
  const rows = $('bandRows');
  rows.innerHTML = '';
  const T = thicknessMm();
  const labels = ['1色目（下層・プレート側）', '2色目（中層）', '3色目（上層）'];
  for (let i = 0; i < state.colorCount; i++) {
    const row = document.createElement('div');
    row.className = 'bandRow';
    const isLast = i === state.colorCount - 1;
    row.innerHTML = `
      <input type="color" value="${state.colors[i]}" data-i="${i}">
      <label style="font-size:12px; flex:1;">${state.colorCount === 1 ? '本体色' : labels[i]}</label>
      ${!isLast && state.colorCount > 1
        ? `<input type="range" data-band="${i}" min="0.4" max="${(T - 0.4 * (state.colorCount - 1 - i)).toFixed(1)}" step="0.2" value="${Math.min(state.bandMm[i], T - 0.4)}" style="width:90px;">
           <output data-bandout="${i}" style="font-size:11px; color:var(--ink-2); min-width:44px; text-align:right;">${Math.min(state.bandMm[i], T - 0.4).toFixed(1)}mm</output>`
        : `<span style="font-size:11px; color:var(--ink-2);">${state.colorCount === 1 ? `${T.toFixed(1)}mm` : '残り全部'}</span>`}
    `;
    rows.appendChild(row);
  }
  rows.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.colors[+inp.dataset.i] = inp.value;
      updateBandViz();
      setPartColors(state.colors); // instant recolor — no geometry rebuild
    });
  });
  rows.querySelectorAll('input[type="range"][data-band]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.bandMm[+inp.dataset.band] = +inp.value;
      rows.querySelector(`[data-bandout="${inp.dataset.band}"]`).textContent = (+inp.value).toFixed(1) + 'mm';
      updateBandViz();
      scheduleGenerate();
    });
  });
  updateBandViz();
}

function updateBandViz() {
  const viz = $('bandViz');
  viz.innerHTML = '';
  const T = thicknessMm();
  const cuts = [0, ...colorCuts(), T];
  for (let i = 0; i < state.colorCount; i++) {
    const div = document.createElement('div');
    div.style.height = (((cuts[i + 1] - cuts[i]) / T) * 100) + '%';
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
    scheduleGenerate();
  });
}

function updateThickReadout() {
  $('thickOut').textContent = `${state.thickPct}%（${thicknessMm().toFixed(1)}mm）`;
}

function init() {
  initPreview($('viewport'));
  buildFontGrid();
  buildBandRows();
  updateThickReadout();

  restoreUserFonts().then(() => { buildFontGrid(); requestGenerate(); });

  $('textInput').addEventListener('input', (e) => { draftText = e.target.value; updateButtons(); });
  $('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmText(); }
  });
  $('textGenBtn').addEventListener('click', confirmText);

  bindRange('dilate', 'dilateOut', (v) => v.toFixed(2) + 'mm', (v) => (state.dilate = v));
  bindRange('sizeMm', 'sizeOut', (v) => v + 'mm', (v) => {
    state.sizeMm = v;
    updateThickReadout();
    $('sectionZ').max = thicknessMm();
    buildBandRows();
  });
  bindRange('thickPct', 'thickOut', () => '', (v) => {
    state.thickPct = v;
    state.thickMmOverride = null;
    updateThickReadout();
    $('sectionZ').max = thicknessMm();
    buildBandRows();
  });
  bindSeg('colorSeg', (v) => { state.colorCount = +v; buildBandRows(); scheduleGenerate(); });
  bindSeg('clearSeg', (v) => { state.clearance = +v; scheduleGenerate(); });
  bindSeg('loopSeg', (v) => { state.loop = v; scheduleGenerate(); });
  bindSeg('endSeg', (v) => { state.endHw = v; scheduleGenerate(); });
  bindRange('chainLinks', 'chainOut', (v) => (v === 0 ? 'なし' : v + 'リンク'), (v) => (state.chainLinks = v));
  $('kataAuto').addEventListener('change', (e) => { state.kataAuto = e.target.checked; scheduleGenerate(); });

  $('fontFile').addEventListener('change', (e) => {
    if (e.target.files.length) handleFontFiles([...e.target.files]);
    e.target.value = '';
  });

  $('exportBtn').addEventListener('click', doExport);

  const applySection = () => setSectionZ($('sectionOn').checked ? +$('sectionZ').value : null);
  $('sectionOn').addEventListener('change', applySection);
  $('sectionZ').addEventListener('input', applySection);

  updateButtons();
}

init();
