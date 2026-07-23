// font.js — font registry, opentype.js loading, glyph outline flattening → integer µm paths.

import { mm, SCALE } from './geom.js';

// coverage: 'jp' = kana+latin+digits, 'latin' = latin/digits only, 'kata' = katakana only
export const FONT_DEFS = [
  { id: 'cherrybomb', label: 'Cherry Bomb One', file: 'fonts/CherryBombOne-Regular.ttf', coverage: 'jp', family: 'Cherry Bomb One' },
  { id: 'potta', label: 'Potta One', file: 'fonts/PottaOne-Regular.ttf', coverage: 'jp', family: 'Potta One' },
  { id: 'mochiy', label: 'Mochiy Pop One', file: 'fonts/MochiyPopOne-Regular.ttf', coverage: 'jp', family: 'Mochiy Pop One' },
  { id: 'kiwimaru', label: 'Kiwi Maru', file: 'fonts/KiwiMaru-Medium.ttf', coverage: 'jp', family: 'Kiwi Maru' },
  { id: 'zenmaru', label: 'Zen Maru Gothic', file: 'fonts/ZenMaruGothic-Bold.ttf', coverage: 'jp', family: 'Zen Maru Gothic' },
  { id: 'dotgothic', label: 'DotGothic16', file: 'fonts/DotGothic16-Regular.ttf', coverage: 'jp', family: 'DotGothic16', note: 'ドット構成のため細部が脆い可能性（要テスト印刷）' },
  { id: 'bagel', label: 'Bagel Fat One', file: 'fonts/BagelFatOne-Regular.ttf', coverage: 'latin', family: 'Bagel Fat One' },
  { id: 'baloo', label: 'Baloo 2', file: 'fonts/Baloo2-ExtraBold.ttf', coverage: 'latin', family: 'Baloo 2' },
  { id: 'titan', label: 'Titan One', file: 'fonts/TitanOne-Regular.ttf', coverage: 'latin', family: 'Titan One' },
  { id: 'grandstander', label: 'Grandstander', file: 'fonts/Grandstander-Bold.ttf', coverage: 'latin', family: 'Grandstander' },
];

// User-loaded fonts (.ttf/.otf picked from disk; cached locally in IndexedDB only).
export const userFonts = []; // [{id, label, family, coverage}]

export function allFontDefs() {
  return [...FONT_DEFS, ...userFonts];
}

// Detect coverage of a parsed font: 'jp' | 'latin' | 'kata' | 'unknown'
function detectCoverage(font) {
  const hira = hasGlyph(font, 'あ'), kata = hasGlyph(font, 'ア'), latin = hasGlyph(font, 'A');
  if (hira) return 'jp';
  if (kata) return 'kata';
  if (latin) return 'latin';
  return 'unknown';
}

let userFontSeq = 0;

// Register a user font from raw bytes. Returns its def (throws on parse failure).
export function addUserFont(name, arrayBuffer) {
  const id = 'user_' + (userFontSeq++);
  const family = 'UserFont_' + id;
  const font = registerFont(id, arrayBuffer, family);
  const label = (font.names?.fullName?.ja || font.names?.fullName?.en || name).slice(0, 24);
  const def = { id, label, family, coverage: detectCoverage(font), userLoaded: true };
  userFonts.push(def);
  return def;
}

export function removeUserFont(id) {
  const i = userFonts.findIndex((d) => d.id === id);
  if (i >= 0) userFonts.splice(i, 1);
  loaded.delete(id);
}

const loaded = new Map();   // id -> opentype.Font
const scaleCache = new Map(); // id|letterH -> µm per font unit
const contourCache = new Map(); // id|ch|scaleKey -> paths

export function isLoaded(id) { return loaded.has(id); }

export async function loadFont(def) {
  if (loaded.has(def.id)) return loaded.get(def.id);
  const buf = await fetch(def.file).then((r) => {
    if (!r.ok) throw new Error(`フォント取得失敗: ${def.file}`);
    return r.arrayBuffer();
  });
  return registerFont(def.id, buf, def.family);
}

// Also used for the user-provided Katakanaboy OTF (never persisted).
export function registerFont(id, arrayBuffer, family) {
  const font = window.opentype.parse(arrayBuffer);
  loaded.set(id, font);
  // register for CSS previews too
  try {
    const face = new FontFace(family, arrayBuffer);
    face.load().then(() => document.fonts.add(face)).catch(() => {});
  } catch (_) { /* preview-only nicety */ }
  return font;
}

export function getFont(id) { return loaded.get(id); }

export function hasGlyph(font, ch) {
  const g = font.charToGlyph(ch);
  return g && g.index > 0;
}

// µm per font unit so that the reference glyph's bbox height equals letterH mm.
function refScale(id, font, letterHmm) {
  const key = id + '|' + letterHmm;
  if (scaleCache.has(key)) return scaleCache.get(key);
  const refChars = ['あ', 'ア', 'A', '0'];
  let hUnits = 0;
  for (const rc of refChars) {
    if (!hasGlyph(font, rc)) continue;
    const bb = font.charToGlyph(rc).getPath(0, 0, font.unitsPerEm).getBoundingBox();
    hUnits = bb.y2 - bb.y1;
    if (hUnits > 0) break;
  }
  if (!hUnits) hUnits = font.unitsPerEm * 0.7;
  const s = (letterHmm * SCALE) / hUnits;
  scaleCache.set(key, s);
  return s;
}

// Flatten one glyph to closed int-µm contours, Y flipped to Y-up, origin at pen (0, baseline 0).
export function glyphContours(id, ch, letterHmm) {
  const font = loaded.get(id);
  const s = refScale(id, font, letterHmm);
  const key = id + '|' + ch + '|' + Math.round(s * 1e6);
  if (contourCache.has(key)) return contourCache.get(key);

  const glyph = font.charToGlyph(ch);
  if (!glyph || glyph.index === 0) { contourCache.set(key, null); return null; }
  // getPath at unitsPerEm → coordinates in font units, y-down.
  const path = glyph.getPath(0, 0, font.unitsPerEm);

  const contours = [];
  let cur = null;
  let cx = 0, cy = 0; // current point (font units)
  // 0.034° rotation: invisible, but kills exact axis-aligned collinearity in blocky
  // fonts (two separate rectangular pockets on one line degenerate earcut's bridges).
  const TH = 0.0006, COS = Math.cos(TH), SIN = Math.sin(TH);
  const P = (x, y) => ({
    X: Math.round((x * COS - y * SIN) * s),
    Y: Math.round(-(x * SIN + y * COS) * s), // flip Y after rotating
  });

  const emit = (x, y) => { cur.push(P(x, y)); cx = x; cy = y; };
  const segsFor = (len) => Math.min(32, Math.max(3, Math.ceil((len * s) / (0.3 * SCALE)))); // ~0.3mm chords

  for (const c of path.commands) {
    switch (c.type) {
      case 'M':
        if (cur && cur.length >= 3) contours.push(cur);
        cur = [];
        emit(c.x, c.y);
        break;
      case 'L': emit(c.x, c.y); break;
      case 'Q': {
        const len = Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x - c.x1, c.y - c.y1);
        const n = segsFor(len);
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          emit(u * u * cx + 2 * u * t * c.x1 + t * t * c.x,
               u * u * cy + 2 * u * t * c.y1 + t * t * c.y);
        }
        break;
      }
      case 'C': {
        const len = Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
        const n = segsFor(len);
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          emit(u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
               u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
        }
        break;
      }
      case 'Z':
        if (cur && cur.length >= 3) contours.push(cur);
        cur = null;
        break;
    }
  }
  if (cur && cur.length >= 3) contours.push(cur);
  const result = contours.length ? contours : null;
  contourCache.set(key, result);
  return result;
}

// ひらがな → カタカナ (U+3041..3096 → +0x60)
export function hiraToKata(text) {
  return text.replace(/[ぁ-ゖゝゞ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}
