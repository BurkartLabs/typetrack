// Shared helpers for the pack3 games (ghost race, ghost league, tower climb, code golf, daily gauntlet).
// The top half is pure (no DOM; uses globalThis.Engine) and tested in test/games-pack3.test.js.
import wordsApi, { FALLBACK } from "../../core/words.js";
import { esc } from "../../core/ui.js";
import { loadCss } from "../../core/css.js";

export const Eng = () => globalThis.Engine;

// ── dates and seeding ─────────────────────────────────────────────────────
export function utcDateKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
}

export function addDays(key, n) {
  return new Date(Date.parse(key + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// FNV-1a over code points: a stable 32-bit seed from any string.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seededRand(key) {
  return Eng().mulberry32(hashString(key));
}

export function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

// n picks from list, no immediate repeats (when the list allows it).
export function pickN(list, n, rand) {
  const out = [];
  let guard = 0;
  while (out.length < n && list.length) {
    const w = pick(list, rand);
    if (w === out[out.length - 1] && list.length > 1 && guard++ < n * 4) continue;
    out.push(w);
  }
  return out;
}

// ── positions and ghosts ──────────────────────────────────────────────────
// Characters from the start of the text to (index, typedLen), counting word.length + 1 per word.
export function charPos(words, index, typedLen) {
  let p = 0;
  for (let i = 0; i < index && i < words.length; i++) p += words[i].length + 1;
  return p + (typedLen || 0);
}

// Inverse of charPos: {index, typed} for a character position (clamped to the end of the text).
export function placeAt(words, pos) {
  let p = Math.max(0, Math.floor(pos));
  for (let i = 0; i < words.length; i++) {
    const len = words[i].length + 1;
    if (p < len) return { index: i, typed: Math.min(p, words[i].length) };
    p -= len;
  }
  const last = words.length - 1;
  return { index: Math.max(0, last), typed: last >= 0 ? words[last].length : 0 };
}

// Replays a keystroke log on its words: arrays of time and character position after every keystroke,
// plus a running maximum so "when did the ghost first reach position p" is a binary search.
export function progressSeries(words, log, opts = {}) {
  const E = Eng();
  const s = E.createTest({
    mode: "words", ordered: true, words, wordCount: words.length, seed: 0,
    accents: opts.accents, noBackspace: opts.noBackspace,
  });
  const t = [], pos = [], max = [];
  let m = 0;
  for (const [ms, k] of log || []) {
    if (k === "\b") E.backspace(s, ms);
    else if (k === " ") E.space(s, ms);
    else E.input(s, k, ms);
    const p = charPos(s.words, s.index, (s.typed[s.index] || "").length);
    t.push(ms); pos.push(p); m = Math.max(m, p); max.push(m);
  }
  return { t, pos, max, end: t.length ? t[t.length - 1] : 0, final: pos.length ? pos[pos.length - 1] : 0 };
}

// Ghost position at time t (ms since its first keystroke).
export function posAt(series, t) {
  let lo = 0, hi = series.t.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.t[mid] <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at < 0 ? 0 : series.pos[at];
}

// First time the ghost reached position p, or null if it never did.
export function timeToReach(series, p) {
  if (p <= 0) return 0;
  let lo = 0, hi = series.max.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.max[mid] >= p) { at = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return at < 0 ? null : series.t[at];
}

// The live gap to a ghost. chars: your position minus the ghost's (positive = you lead).
// ms: when the ghost reached your current position minus now (positive = you got there first);
// null when the ghost never reached it (you are past everything it typed).
export function ghostGap(series, myPos, t) {
  const reach = timeToReach(series, myPos);
  return { chars: myPos - posAt(series, t), ms: reach == null ? null : Math.round(reach - t) };
}

// Your placing among ghosts by wpm: place 1 = first; ties do not count as beaten.
export function leaguePlacing(myWpm, ghostWpms) {
  const ahead = ghostWpms.filter((w) => w > myWpm).length;
  const beaten = ghostWpms.filter((w) => w < myWpm).length;
  return { place: ahead + 1, of: ghostWpms.length + 1, beaten };
}

export const hasLog = (r) => !!r && Array.isArray(r.log) && r.log.length > 0 && Array.isArray(r.words) && r.words.length > 0;
export const modeOf = (r) => `${r.mode}:${r.target}:${r.lang || "en"}`;

// Runs (with a log) for a mode key that raised the personal best when they were set, oldest first.
export function pbProgression(results, key) {
  let best = -Infinity;
  const out = [];
  for (const r of [...results].sort((a, b) => a.ts - b.ts)) {
    if (modeOf(r) !== key) continue;
    if (r.wpm > best) {
      best = r.wpm;
      if (hasLog(r)) out.push(r);
    }
  }
  return out;
}

export function avgRecentWpm(results, n = 10) {
  const xs = results.filter((r) => typeof r.wpm === "number").slice(-n).map((r) => r.wpm);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function fmtSigned(n, digits = 0) {
  const v = Number(n.toFixed(digits));
  return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(digits);
}

// ── word data with built-in fallbacks ─────────────────────────────────────
export const BUILTIN_RARE = Object.freeze((
  "quixotic ephemeral labyrinthine obsequious perfunctory sycophant mellifluous juxtapose cacophony " +
  "idiosyncrasy serendipity ubiquitous vicissitude recalcitrant pusillanimous magnanimous esoteric " +
  "surreptitious phlegmatic querulous sesquipedalian lugubrious truculent perspicacious equanimity " +
  "anachronism obfuscate proclivity quintessential rhapsody zephyr syzygy onomatopoeia bureaucracy " +
  "conscientious hierarchy rhythm mnemonic pneumatic psychology archaeology silhouette xylophone " +
  "chrysanthemum kaleidoscope paraphernalia accommodate liaison millennium questionnaire threshold"
).split(" "));

export const BUILTIN_QUOTES = Object.freeze([
  { text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.", source: "Charles Dickens" },
  { text: "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.", source: "Herman Melville" },
  { text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", source: "Jane Austen" },
  { text: "All happy families are alike; each unhappy family is unhappy in its own way.", source: "Leo Tolstoy" },
  { text: "The only thing we have to fear is fear itself.", source: "Franklin D. Roosevelt" },
  { text: "Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.", source: "Robert Frost" },
]);

export const BUILTIN_CODE = Object.freeze({
  js: [
    "const sum = (xs) => xs.reduce((a, b) => a + b, 0);",
    "function clamp(x, lo, hi) {\n  return Math.min(hi, Math.max(lo, x));\n}",
    "for (let i = 0; i < n; i++) {\n  if (a[i] !== b[i]) return false;\n}",
    "const res = await fetch(`/api/items?page=${page}`);\nconst data = await res.json();",
    "export default { mount(root) { root.innerHTML = \"<p>hi</p>\"; } };",
  ],
  py: [
    "def mean(xs):\n  return sum(xs) / len(xs) if xs else 0.0",
    "with open(path, \"r\") as f:\n  lines = [l.strip() for l in f if l]",
    "counts = {}\nfor w in words:\n  counts[w] = counts.get(w, 0) + 1",
    "if __name__ == \"__main__\":\n  main(sys.argv[1:])",
  ],
});

export function isFallbackList(list) {
  return Array.isArray(list) && list.length === FALLBACK.length && list[0] === FALLBACK[0];
}

// Common words for a language (falls back to the English FALLBACK inside words.list).
export async function commonWords(lang) {
  const list = await wordsApi.list(lang || "en", "common-1k").catch(() => null);
  return Array.isArray(list) && list.length ? list : FALLBACK.slice();
}

// Rare / long words. words.list falls back to FALLBACK silently, so detect that and use our own.
export async function rareWords(lang) {
  const list = await wordsApi.list(lang || "en", "rare").catch(() => null);
  if (Array.isArray(list) && list.length >= 20 && !isFallbackList(list)) return list;
  if ((lang || "en") === "en") return BUILTIN_RARE.slice();
  const common = await commonWords(lang);
  const long = common.filter((w) => w.length >= 7);
  return long.length >= 20 ? long : BUILTIN_RARE.slice();
}

export async function quotes(lang) {
  const list = await wordsApi.quotes(lang || "en").catch(() => []);
  const ok = (Array.isArray(list) ? list : []).filter((q) => q && typeof q.text === "string" && q.text.trim());
  return ok.length ? ok : BUILTIN_QUOTES.slice();
}

// Code snippets as strings; built-ins when words/code/<lang>.json is missing.
export async function codeSnippets(lang) {
  const list = await wordsApi.code(lang).catch(() => []);
  const ok = (Array.isArray(list) ? list : []).map((s) => (typeof s === "string" ? s : s && s.text)).filter((t) => typeof t === "string" && t.trim());
  return ok.length ? ok : (BUILTIN_CODE[lang] || BUILTIN_CODE.js).slice();
}

// ── DOM helpers shared by the games ───────────────────────────────────────
export function loadPack3Css() {
  return loadCss("css/games-pack3.css");
}

export function bestScore(store, id, lowerIsBetter = false) {
  const xs = store.gameScores(id).map((e) => Number(e.score)).filter(Number.isFinite);
  if (!xs.length) return null;
  return lowerIsBetter ? Math.min(...xs) : Math.max(...xs);
}

// Standard end panel. stats: [[label, value]]; returns HTML with [data-act=retry] and a back link.
export function endPanel({ title, score, unit, best, isBest, stats = [], extra = "", retry = "retry" }) {
  return `
    <div class="p3-end">
      <div class="p3-label">${esc(title)}</div>
      <div class="p3-score">${esc(score)}<small>${esc(unit || "")}</small></div>
      <div class="p3-best">${isBest ? '<span class="p3-newbest">new best</span>' : `best ${best == null ? "&#8212;" : esc(best)}`}</div>
      ${stats.length ? `<div class="p3-stats">${stats.map(([l, v]) => `<div><span class="p3-label">${esc(l)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
      ${extra}
      <div class="p3-actions">
        <button class="p3-btn primary" data-act="retry">${esc(retry)}</button>
        <a class="p3-btn" href="#/games">all games</a>
      </div>
      <div class="p3-hint">enter or esc: ${esc(retry)}</div>
    </div>`;
}
