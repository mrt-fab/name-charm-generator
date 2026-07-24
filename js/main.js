// main.js — UI thread: state, realtime worker client, presets, URL-encoded state.
// Geometry runs in js/worker.js. Every parameter change regenerates live (120ms
// debounce); only the TEXT needs explicit confirmation (「このテキストで生成」).

import { FONT_DEFS, allFontDefs, addUserFont, removeUserFont } from './font.js';
import { saveUserFont, loadUserFonts, deleteUserFont } from './fontstore.js';
import { writeSTL, zipStore, download } from './export.js';
import { initPreview, setParts, setPartColors, setSectionZ, setDimmed, setView } from './preview.js';
import './validate.js';

const state = {
  text: 'ナマエ',
  fontId: 'cherrybomb',
  sizeMm: 20,
  thickPct: 50,
  thickMmOverride: null,
  dilate: 0.3,
  colorCount: 2,
  bandMm: [4.0, 3.0],
  colors: ['#4f86d6', '#f5f2ec', '#f0a8bf'],
  clearance: 0.4,
  cz: 0.2,
  jointPct: 65,
  swingDeg: 40,
  loop: 'loop',
  chainLinks: 0,
  endHw: 'none',
  kataAuto: true,
};
let draftText = state.text;

// curated starting points (font × palette × hardware) + gacha
const PRESETS = [
  { name: 'ポップ',   fontId: 'cherrybomb', colors: ['#4f86d6', '#f5f2ec'], colorCount: 2, endHw: 'none', chainLinks: 0 },
  { name: 'レトロ',   fontId: 'potta',      colors: ['#d95d39', '#f2e8d5'], colorCount: 2, endHw: 'snapring', chainLinks: 3 },
  { name: 'ミルク',   fontId: 'mochiy',     colors: ['#f7cad0', '#fdf6f0', '#84a59d'], colorCount: 3, endHw: 'none', chainLinks: 0 },
  { name: 'シック',   fontId: 'zenmaru',    colors: ['#2b2d31', '#c9b79c'], colorCount: 2, endHw: 'carabiner', chainLinks: 2 },
  { name: 'Y2K',     fontId: 'dotgothic',  colors: ['#7f5af0', '#e4f222'], colorCount: 2, endHw: 'snapring', chainLinks: 4 },
];
const GACHA_COLORS = ['#4f86d6', '#d95d39', '#f7cad0', '#84a59d', '#2b2d31', '#e8b931', '#7f5af0', '#3aa17e', '#f2e8d5', '#f5f2ec', '#e4f222', '#c9b79c'];

const thicknessMm = () =>
  state.thickMmOverride ?? Math.round(state.sizeMm * state.thickPct / 100 * 2) / 2;

function colorCuts() {
  const T = thicknessMm();
  if (state.colorCount === 1) return [];
  const b1 = Math.min(state.bandMm[0], T - 0.4);
  if (state.colorCount === 2) return [b1];
  return [b1, Math.min(b1 + state.bandMm[1], T - 0.4)];
}

// ---------- URL = state ----------

const HW_CODE = { none: 0, snapring: 1, carabiner: 2 };
const HW_DECODE = ['none', 'snapring', 'carabiner'];
let hashTimer = null;

function encodeHash() {
  const p = new URLSearchParams();
  p.set('n', state.text);
  p.set('f', state.fontId);
  p.set('s', state.sizeMm);
  p.set('t', state.thickPct);
  if (state.thickMmOverride != null) p.set('tm', state.thickMmOverride);
  p.set('d', state.dilate);
  p.set('cc', state.colorCount);
  p.set('c', state.colors.map((c) => c.replace('#', '')).join('.'));
  p.set('b', state.bandMm.map((b) => b.toFixed(1)).join('.'));
  p.set('cl', state.clearance);
  p.set('jh', state.jointPct);
  p.set('lp', state.loop === 'loop' ? 1 : 0);
  p.set('ch', state.chainLinks);
  p.set('hw', HW_CODE[state.endHw] ?? 0);
  return '#' + p.toString();
}

function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', encodeHash()), 300);
}

function decodeHash() {
  if (!location.hash || location.hash.length < 3) return;
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('n')) { state.text = p.get('n').slice(0, 20); draftText = state.text; }
    if (p.get('f')) state.fontId = p.get('f');
    if (p.get('s')) state.sizeMm = Math.min(40, Math.max(12, +p.get('s')));
    if (p.get('t')) state.thickPct = Math.min(70, Math.max(30, +p.get('t')));
    if (p.get('tm')) state.thickMmOverride = Math.min(28, Math.max(3, +p.get('tm')));
    if (p.get('d')) state.dilate = Math.min(0.8, Math.max(0, +p.get('d')));
    if (p.get('cc')) state.colorCount = Math.min(3, Math.max(1, +p.get('cc')));
    if (p.get('c')) {
      const cs = p.get('c').split('.').map((c) => '#' + c.replace(/[^0-9a-f]/gi, '').slice(0, 6));
      cs.forEach((c, i) => { if (c.length === 7 && i < 3) state.colors[i] = c; });
    }
    if (p.get('b')) p.get('b').split('.').forEach((b, i) => { if (i < 2 && +b > 0) state.bandMm[i] = +b; });
    if (p.get('cl')) state.clearance = [0.3, 0.4, 0.5].includes(+p.get('cl')) ? +p.get('cl') : 0.4;
    if (p.get('jh')) state.jointPct = Math.min(100, Math.max(40, +p.get('jh') || 65));
    if (p.get('lp') != null) state.loop = p.get('lp') === '0' ? 'none' : 'loop';
    if (p.get('ch')) state.chainLinks = Math.min(12, Math.max(0, +p.get('ch')));
    if (p.get('hw')) state.endHw = HW_DECODE[+p.get('hw')] || 'none';
  } catch (_) { /* malformed hash — ignore */ }
}

// ---------- worker client ----------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let genSeq = 0;
let latestSent = 0;
let lastResult = null;
let regenTimer = null;
let progressTimer = null;
let lastFitW = 0;
let wiggleNext = true;

function buildParams() {
  return {
    fontId: state.fontId,
    letterH: state.sizeMm,
    thickness: thicknessMm(),
    dilate: state.dilate,
    colorCount: state.colorCount,
    colorCuts: colorCuts(),
    clearance: state.clearance,
    cz: state.cz,
    jointPct: state.jointPct,
    swingDeg: state.swingDeg,
    loop: state.loop,
    chainLinks: state.chainLinks,
    endHw: state.endHw,
    kataAuto: state.kataAuto,
  };
}

function requestGenerate() {
  const id = ++genSeq;
  latestSent = id;
  worker.postMessage({ type: 'generate', id, text: state.text, params: buildParams() });
  setDimmed(true);
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => $('genProgress').classList.add('show'), 500);
  syncHash();
}

// welded (watertight) build for STL export — heavier, so it runs on demand only
let exportSeq = 0;
const exportWaiters = new Map();

function requestWeldedBuild() {
  return new Promise((resolve, reject) => {
    const id = ++exportSeq;
    exportWaiters.set(id, { resolve, reject });
    worker.postMessage({ type: 'export', id, text: state.text, params: buildParams() });
  });
}

function scheduleGenerate() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(requestGenerate, 120);
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'fontinfo') { onFontInfo(msg); return; }
  if (msg.type === 'exported') {
    const w = exportWaiters.get(msg.id);
    if (w) {
      exportWaiters.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error)); else w.resolve(msg);
    }
    return;
  }
  if (msg.id !== latestSent) return; // stale — a newer request is in flight
  clearTimeout(progressTimer);
  $('genProgress').classList.remove('show');
  setDimmed(false);
  if (msg.type === 'error') { console.error('generate error:', msg.message); return; }
  lastResult = msg;
  const w = msg.stats.widthMm || 0;
  const refit = !lastFitW || Math.abs(w - lastFitW) / lastFitW > 0.08;
  if (refit) lastFitW = w;
  setParts(msg, state.colors, { fit: refit, wiggle: wiggleNext });
  wiggleNext = false;
  updateWarnings(msg.stats.missing || []);
  updateStats(msg.stats);
  updateButtons();
};

// ---------- export / share ----------

async function doExport() {
  if (!lastResult || !lastResult.colors.length) return;
  const name = state.text.replace(/[^\wぁ-ゖァ-ヶー一-龠]/g, '') || 'charm';
  const btn = $('exportBtn');
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = '書き出し中…';
  let byColor;
  try {
    // welded watertight meshes — the preview's stacked shells break slicer repair
    byColor = (await requestWeldedBuild()).colors;
  } catch (err) {
    console.error('export error:', err);
    btn.textContent = prevLabel;
    btn.disabled = false;
    return;
  }
  btn.textContent = prevLabel;
  btn.disabled = false;
  if (byColor.length === 1) {
    download(new Blob([writeSTL(byColor[0])]), `${name}.stl`);
    flashBtn('exportBtn', '✓ ダウンロードしました');
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
      `4. サポートなし・レイヤー0.2mmで印刷（カラビナのねじノブは印刷後にねじ込み）\n\n` +
      `色の境界は水平なので、AMSなしでも「レイヤーで一時停止/フィラメント交換」で印刷できます。\n`
    ),
  });
  download(zipStore(files), `${name}_${byColor.length}colors.zip`);
  flashBtn('exportBtn', '✓ ダウンロードしました');
}

async function doShare() {
  const url = location.origin + location.pathname + encodeHash();
  if (navigator.share && matchMedia('(max-width: 760px)').matches) {
    try { await navigator.share({ title: 'つながるネームチャーム', url }); return; } catch (_) { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    flashBtn('shareBtn', '✓ コピーしました');
  } catch (_) {
    prompt('このURLをコピーしてください', url);
  }
}

function flashBtn(id, text) {
  const b = $(id);
  const orig = b.textContent;
  b.textContent = text;
  setTimeout(() => { b.textContent = orig; }, 2000);
}

// ---------- fonts ----------

const $ = (id) => document.getElementById(id);
const pendingFontInfo = new Map();

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
      const def = addUserFont(file.name.replace(/\.(ttf|otf)$/i, ''), buf.slice(0));
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

// ---------- presets ----------

function applyPreset(p) {
  state.fontId = p.fontId;
  state.colorCount = p.colorCount;
  p.colors.forEach((c, i) => (state.colors[i] = c));
  state.endHw = p.endHw;
  state.chainLinks = p.chainLinks;
  syncControls();
  wiggleNext = true;
  requestGenerate();
}

function gacha() {
  const defs = allFontDefs().filter((d) => d.coverage !== 'latin' || /[\w ]/.test(state.text));
  state.fontId = defs[Math.floor(Math.random() * defs.length)].id;
  state.colorCount = 1 + Math.floor(Math.random() * 3);
  const pool = [...GACHA_COLORS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < state.colorCount; i++) state.colors[i] = pool[i];
  state.endHw = HW_DECODE[Math.floor(Math.random() * 3)];
  state.chainLinks = state.endHw === 'none' ? 0 : 2 + Math.floor(Math.random() * 3);
  syncControls();
  wiggleNext = true;
  requestGenerate();
}

function buildPresetRow() {
  const row = $('presetRow');
  row.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="dots">${p.colors.slice(0, p.colorCount).map((c) => `<i style="background:${c}"></i>`).join('')}</span>${p.name}`;
    b.addEventListener('click', () => applyPreset(p));
    row.appendChild(b);
  }
  const g = document.createElement('button');
  g.className = 'gacha';
  g.textContent = '⚄ ランダム';
  g.addEventListener('click', gacha);
  row.appendChild(g);
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
  const mins = Math.max(5, Math.round(s.volumeMm3 / 600));
  $('stats').textContent =
    `約 ${s.widthMm} × ${s.heightMm} × ${s.thickMm}mm ・ 推定 ${s.weightG}g ・ 印刷目安 ${mins}分`;
  $('bambuHint').style.display = state.colorCount > 1 ? 'block' : 'none';
  $('exportBtn').textContent = state.colorCount > 1 ? `STL一式をダウンロード（${state.colorCount}色 ZIP）` : 'STLをダウンロード';
}

function updateButtons() {
  $('textGenBtn').classList.toggle('stale', draftText !== state.text);
  $('exportBtn').disabled = !lastResult;
}

function confirmText() {
  state.text = draftText;
  wiggleNext = true;
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
      <label style="font-size:0.75rem; flex:1;">${state.colorCount === 1 ? '本体色' : labels[i]}</label>
      ${!isLast && state.colorCount > 1
        ? `<input type="range" data-band="${i}" min="0.4" max="${(T - 0.4 * (state.colorCount - 1 - i)).toFixed(1)}" step="0.2" value="${Math.min(state.bandMm[i], T - 0.4)}" style="width:90px;">
           <output data-bandout="${i}" style="font-size:0.6875rem; color:var(--ink-2); min-width:44px; text-align:right;">${Math.min(state.bandMm[i], T - 0.4).toFixed(1)}mm</output>`
        : `<span style="font-size:0.6875rem; color:var(--ink-2);">${state.colorCount === 1 ? `${T.toFixed(1)}mm` : '残り全部'}</span>`}
    `;
    rows.appendChild(row);
  }
  rows.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.colors[+inp.dataset.i] = inp.value;
      updateBandViz();
      setPartColors(state.colors);
      syncHash();
    });
  });
  rows.querySelectorAll('input[type="range"][data-band]').forEach((inp) => {
    fillTrack(inp);
    inp.addEventListener('input', () => {
      state.bandMm[+inp.dataset.band] = +inp.value;
      rows.querySelector(`[data-bandout="${inp.dataset.band}"]`).textContent = (+inp.value).toFixed(1) + 'mm';
      fillTrack(inp);
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

function fillTrack(inp) {
  const pct = ((+inp.value - +inp.min) / (+inp.max - +inp.min)) * 100;
  inp.style.setProperty('--p', pct + '%');
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

function setSeg(id, val) {
  $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(val)));
}

function bindRange(id, outId, fmt, onChange) {
  const inp = $(id);
  fillTrack(inp);
  inp.addEventListener('input', () => {
    if (outId) $(outId).textContent = fmt(+inp.value);
    fillTrack(inp);
    onChange(+inp.value);
    scheduleGenerate();
  });
}

function updateThickReadout() {
  $('thickOut').textContent = state.thickMmOverride != null
    ? `${thicknessMm().toFixed(1)}mm（指定）`
    : `${state.thickPct}%（${thicknessMm().toFixed(1)}mm）`;
}

// push current state into every control (used by presets / gacha / URL restore)
function syncControls() {
  $('textInput').value = draftText;
  $('sizeMm').value = state.sizeMm; $('sizeOut').textContent = state.sizeMm + 'mm';
  $('thickPct').value = state.thickPct;
  $('dilate').value = state.dilate; $('dilateOut').textContent = state.dilate.toFixed(2) + 'mm';
  $('jointPct').value = state.jointPct; $('jointPctOut').textContent = state.jointPct + '%';
  $('chainLinks').value = state.chainLinks;
  $('chainOut').textContent = state.chainLinks === 0 ? 'なし' : state.chainLinks + 'リンク';
  $('thickMm').value = state.thickMmOverride ?? '';
  ['sizeMm', 'thickPct', 'dilate', 'jointPct', 'chainLinks'].forEach((id) => fillTrack($(id)));
  setSeg('colorSeg', state.colorCount);
  setSeg('clearSeg', state.clearance);
  setSeg('loopSeg', state.loop);
  setSeg('endSeg', state.endHw);
  updateThickReadout();
  $('sectionZ').max = thicknessMm();
  buildBandRows();
  refreshFontSelection();
}

function init() {
  decodeHash();
  initPreview($('viewport'));
  buildPresetRow();
  buildFontGrid();
  syncControls();

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
  bindRange('thickPct', null, () => '', (v) => {
    state.thickPct = v;
    state.thickMmOverride = null;
    $('thickMm').value = '';
    updateThickReadout();
    $('sectionZ').max = thicknessMm();
    buildBandRows();
  });
  $('thickMm').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.thickMmOverride = Number.isFinite(v) ? Math.min(28, Math.max(3, v)) : null;
    updateThickReadout();
    buildBandRows();
    scheduleGenerate();
  });
  bindSeg('colorSeg', (v) => { state.colorCount = +v; buildBandRows(); scheduleGenerate(); });
  bindSeg('clearSeg', (v) => { state.clearance = +v; scheduleGenerate(); });
  bindRange('jointPct', 'jointPctOut', (v) => v + '%', (v) => (state.jointPct = v));
  bindSeg('loopSeg', (v) => { state.loop = v; scheduleGenerate(); });
  bindSeg('endSeg', (v) => { state.endHw = v; scheduleGenerate(); });
  bindRange('chainLinks', 'chainOut', (v) => (v === 0 ? 'なし' : v + 'リンク'), (v) => (state.chainLinks = v));
  $('kataAuto').addEventListener('change', (e) => { state.kataAuto = e.target.checked; scheduleGenerate(); });

  $('fontFile').addEventListener('change', (e) => {
    if (e.target.files.length) handleFontFiles([...e.target.files]);
    e.target.value = '';
  });

  $('exportBtn').addEventListener('click', doExport);
  $('shareBtn').addEventListener('click', doShare);

  const applySection = () => setSectionZ($('sectionOn').checked ? +$('sectionZ').value : null);
  $('sectionOn').addEventListener('change', applySection);
  $('sectionZ').addEventListener('input', applySection);

  document.querySelectorAll('#viewBar button').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  updateButtons();
}

init();
