// Pure maths for games pack 1 (sprint, treadmill, word bomb, word ladder, survival, chain combo).
// No DOM, no imports: test/games-pack1.test.js loads this file directly in node.

// 1 wpm = 5 characters a minute, so one character at `wpm` takes 12000 / wpm ms.
export const charMs = (wpm) => 12000 / Math.max(1, wpm);

export function wpmFrom(chars, ms) {
  return ms > 0 && chars > 0 ? (chars / 5) / (ms / 60000) : 0;
}

export const round1 = (x) => Math.round(x * 10) / 10;

export function accuracy(ok, miss) {
  const n = ok + miss;
  return n ? round1((ok / n) * 100) : 100;
}

// mulberry32: small seeded rng so a run can be reproduced
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random word from pool that isn't `avoid`; `minLen` narrows the pool when enough words qualify.
export function pickWord(pool, rng, avoid, minLen = 0) {
  let src = pool;
  if (minLen > 0) {
    const long = pool.filter((w) => w.length >= minLen);
    if (long.length >= 20) src = long;
  }
  for (let i = 0; i < 8; i++) {
    const w = src[Math.floor(rng() * src.length)];
    if (w !== avoid) return w;
  }
  return src[Math.floor(rng() * src.length)];
}

// Lenient accents: "e" counts for "é". Strict: exact character.
export function fold(c) {
  return String(c).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
export function charMatch(expected, typed, lenient = true) {
  if (expected === typed) return true;
  if (!lenient || expected === " " || typed === " ") return false;
  return fold(expected) === fold(typed);
}

// Best score from store.gameScores(game) entries ({score}); null when none.
export function bestScore(entries) {
  let best = null;
  for (const e of entries || []) {
    const s = e && typeof e.score === "number" ? e.score : NaN;
    if (Number.isFinite(s) && (best === null || s > best)) best = s;
  }
  return best;
}

// Top n entries by score, highest first.
export function topScores(entries, n = 5) {
  return (entries || []).filter((e) => e && Number.isFinite(e.score)).slice().sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, n);
}

// Typing-test results -> best wpm (optionally for one language), or null.
export function bestWpm(results, lang) {
  let best = null;
  for (const r of results || []) {
    if (!r || typeof r.wpm !== "number" || !Number.isFinite(r.wpm)) continue;
    if (lang && r.lang && r.lang !== lang) continue;
    if (best === null || r.wpm > best) best = r.wpm;
  }
  return best;
}

// Mean wpm of the last n results, or null.
export function recentAvgWpm(results, n = 10, lang) {
  const list = (results || []).filter((r) => r && Number.isFinite(r.wpm) && (!lang || !r.lang || r.lang === lang)).slice(-n);
  if (!list.length) return null;
  return list.reduce((s, r) => s + r.wpm, 0) / list.length;
}

// ── sprint ──────────────────────────────────────────────────────────────
// 5-8 words, total length kept between 24 and 60 characters so every phrase is a comparable sprint.
export function makePhrase(pool, rng) {
  for (let tries = 0; tries < 20; tries++) {
    const n = 5 + Math.floor(rng() * 4);
    const out = [];
    let prev = null;
    for (let i = 0; i < n; i++) { prev = pickWord(pool, rng, prev); out.push(prev); }
    const text = out.join(" ");
    if (text.length >= 24 && text.length <= 60) return text;
  }
  return pool.slice(0, 6).join(" ");
}

// The clock starts on the first keystroke, so the first character is free: count the intervals.
export function sprintWpm(phrase, ms) {
  return wpmFrom(Math.max(0, phrase.length - 1), ms);
}

// ── treadmill ───────────────────────────────────────────────────────────
export const TREADMILL = Object.freeze({ start: 80, step: 5, every: 10000, lead: 30, headStart: 12 });

export function treadmillSpeed(ms, cfg = TREADMILL) {
  return cfg.start + cfg.step * Math.floor(Math.max(0, ms) / cfg.every);
}

// Characters the pace has covered after ms (piecewise-constant speed), ignoring the belt clamp.
export function treadmillDistance(ms, cfg = TREADMILL) {
  ms = Math.max(0, ms);
  const full = Math.floor(ms / cfg.every);
  let chars = 0;
  for (let k = 0; k < full; k++) chars += ((cfg.start + cfg.step * k) * 5 / 60000) * cfg.every;
  chars += ((cfg.start + cfg.step * full) * 5 / 60000) * (ms - full * cfg.every);
  return chars;
}

// One step of the pace marker: it moves at speed, but is dragged along so it's never more than `lead`
// characters behind you (a belt, not a race you can bank a lead in). Returns the new position.
export function treadmillStep(pace, dtMs, speedWpm, player, lead = TREADMILL.lead) {
  const moved = pace + (speedWpm * 5 / 60000) * Math.max(0, dtMs);
  return Math.max(moved, player - lead);
}

// ── word bomb ───────────────────────────────────────────────────────────
// The fuse is set from your TYPICAL speed (median of recent standard tests), not your best: a best is a
// peak, and matching it on every single word from the first one is not a game. The target starts well
// under your typical speed and climbs to it over ~50 words, then edges past it. Each word also gets a
// reaction allowance to read it before the first key. A boom steps the ramp back.
export const BOMB = Object.freeze({
  react: 500, start: 0.65, rampWords: 50, over: 0.002, max: 1.1, boomStepBack: 6, alpha: 0.25, fallback: 80, recent: 20,
});

// Median wpm of the last `recent` standard tests (words source, time/words mode) in this language, or null.
export function typicalWpm(results, lang, cfg = BOMB) {
  const list = (results || []).filter((r) => r && Number.isFinite(r.wpm) && r.wpm > 0 && r.wpm <= 300 &&
    (r.mode === "time" || r.mode === "words") && (!r.source || r.source === "words") &&
    (!lang || !r.lang || r.lang === lang)).slice(-cfg.recent).map((r) => r.wpm).sort((x, y) => x - y);
  if (!list.length) return null;
  const m = list.length >> 1;
  return list.length % 2 ? list[m] : (list[m - 1] + list[m]) / 2;
}
// Target wpm after `progress` words: start × base rising linearly to base, then slowly past it, capped.
export function bombTarget(base, progress, cfg = BOMB) {
  const p = Math.max(0, progress);
  const f = p <= cfg.rampWords ? cfg.start + (1 - cfg.start) * (p / cfg.rampWords) : 1 + (p - cfg.rampWords) * cfg.over;
  return base * Math.min(cfg.max, f);
}
// Fuse for a word: its characters plus the space after it at target wpm, plus time to read it.
export function bombFuse(word, targetWpm, cfg = BOMB) {
  return (word.length + 1) * charMs(targetWpm) + cfg.react;
}
export function ema(avg, x, alpha = BOMB.alpha) {
  return avg + alpha * (x - avg);
}

// ── word ladder ─────────────────────────────────────────────────────────
export const LADDER = Object.freeze({ startWpm: 70, react: 300, shrink: 0.97 });

// Window for a word on rung n: (chars at startWpm + reaction time), shrinking 3% per rung.
export function ladderWindow(word, rung, cfg = LADDER) {
  return ((word.length + 1) * charMs(cfg.startWpm) + cfg.react) * Math.pow(cfg.shrink, rung);
}
// The speed a window demands for a word (reaction time included, so it's the honest number).
export function ladderNeed(word, windowMs) {
  return wpmFrom(word.length + 1, windowMs);
}

// ── survival ────────────────────────────────────────────────────────────
// Words get longer as you survive: minimum length 2 + one letter per 20 words, up to 8.
export function survivalMinLen(score) {
  return Math.min(8, 2 + Math.floor(score / 20));
}

// ── chain combo ─────────────────────────────────────────────────────────
export const CHAIN = Object.freeze({ duration: 60000, from: 0.95, to: 1.05, fallback: 100 });

// Target climbs from 95% to 105% of your average over the minute.
export function chainTarget(base, elapsedMs, cfg = CHAIN) {
  const f = Math.min(1, Math.max(0, elapsedMs / cfg.duration));
  return base * (cfg.from + (cfg.to - cfg.from) * f);
}

// One finished word -> new chain state. state = {mult, streak, best, points}. A fast, clean word grows the
// multiplier by one and scores chars x multiplier; a slow one scores chars x1 and resets; an errored one
// scores nothing and resets.
export function chainWord(state, { chars, wpm, clean }, target) {
  const s = Object.assign({ mult: 1, streak: 0, best: 0, points: 0 }, state);
  if (clean && wpm >= target) {
    s.streak += 1;
    s.mult = 1 + s.streak;
    s.best = Math.max(s.best, s.streak);
    s.gained = chars * s.mult;
    s.hit = true;
  } else {
    s.streak = 0;
    s.mult = 1;
    s.gained = clean ? chars : 0;
    s.hit = false;
  }
  s.points += s.gained;
  return s;
}
