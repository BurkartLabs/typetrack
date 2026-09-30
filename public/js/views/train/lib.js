// Pure helpers for the Train section: no DOM, no window. Engine is passed in where needed (E), so node
// tests can hand it the CommonJS engine. Covered by test/train.test.js.

export const FALLBACK_PAIRS = ["ck", "ou", "ea", "ly", "wh"];

// "th, CK,x,abc,th" -> ["th", "ck"]: unique two-letter pairs, at most 8
export function parsePairs(s) {
  const out = [];
  for (const raw of String(s || "").toLowerCase().split(/[\s,;]+/)) {
    const p = raw.trim();
    if ([...p].length === 2 && /^\p{L}\p{L}$/u.test(p) && !out.includes(p)) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// The user's slowest letter pairs (letters only), slowest first.
export function slowestPairs(E, results, n = 5, minSamples = 5) {
  if (!results || !results.length) return [];
  return E.pairTimes(results, minSamples).filter((p) => /^\p{L}\p{L}$/u.test(p.pair)).slice(0, n).map((p) => p.pair);
}

// { pair: medianMs | null } for the given pairs.
export function pairMedians(E, results, pairs) {
  const rows = results && results.length ? E.pairTimes(results, 1) : [];
  const by = Object.fromEntries(rows.map((r) => [r.pair, r]));
  return Object.fromEntries(pairs.map((p) => [p, by[p] ? by[p].medianMs : null]));
}

// Rows for the before/after table; delta < 0 means faster.
export function pairComparison(before, after, pairs) {
  return pairs.map((pair) => {
    const b = before[pair] == null ? null : before[pair];
    const a = after[pair] == null ? null : after[pair];
    return { pair, before: b, after: a, delta: a != null && b != null ? Math.round((a - b) * 10) / 10 : null };
  });
}

// Memory mode: how long a line stays on screen, scaled to its length (fast readers, but it has to stick).
export function memoryShowMs(text) {
  const chars = String(text || "").length;
  return Math.round(Math.min(12000, Math.max(1500, 1200 + 90 * chars)));
}

// Whole-word accuracy of a recalled line.
export function wordAccuracy(targets, typed) {
  const total = targets.length;
  let correct = 0;
  for (let i = 0; i < total; i++) if ((typed[i] || "") === targets[i]) correct++;
  return { correct, total, pct: total ? Math.round((correct / total) * 1000) / 10 : 0 };
}

// Memory score: speed that stuck = wpm weighted by recalled words.
export function memoryScore(wpm, wordPct) {
  return Math.round((wpm || 0) * (wordPct || 0) / 100);
}

// Metronome: keystrokes per minute = wpm * 5, so one beat per key.
export function beatMs(wpm) {
  return 60000 / (wpm * 5);
}

// Inter-key gaps from an engine log [[t, k], ...]; backspaces and the gap right after one are dropped.
export function gapsFromLog(log) {
  const gaps = [];
  for (let i = 1; i < (log || []).length; i++) {
    if (log[i][1] === "\b" || log[i - 1][1] === "\b") continue;
    gaps.push(log[i][0] - log[i - 1][0]);
  }
  return gaps;
}

// Timing evenness: mean absolute deviation of the gaps from the beat (ms), and a 0-100 score
// (100 = every gap exactly on the beat, 0 = off by a whole beat on average).
export function evenness(gaps, beat) {
  if (!gaps.length || !(beat > 0)) return { mad: 0, score: 0, n: 0, meanGap: 0 };
  const mad = gaps.reduce((a, g) => a + Math.abs(g - beat), 0) / gaps.length;
  const meanGap = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  return {
    mad: Math.round(mad * 10) / 10,
    score: Math.round(Math.max(0, Math.min(100, 100 * (1 - mad / beat)))),
    n: gaps.length,
    meanGap: Math.round(meanGap * 10) / 10,
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Letters of a word shuffled; differs from the word whenever the word has two different letters.
export function scramble(word, rand = Math.random) {
  const chars = [...word];
  if (new Set(chars).size < 2) return word;
  for (let tries = 0; tries < 8; tries++) {
    const s = shuffle(chars, rand).join("");
    if (s !== word) return s;
  }
  return chars.slice(1).join("") + chars[0];
}

// ── accents and layout hints ──────────────────────────────────────────────

export const ACCENTS = {
  de: "äöüß",
  es: "áéíóúñü",
  fr: "éèêàâçùûîïôëœ",
  pt: "áâãàçéêíóôõú",
  it: "àèéìòù",
  nl: "éëïöèá",
  pl: "ąćęłńóśźż",
  el: "άέήίόύώϊϋ",
};
export const LANG_NAMES = { en: "english", de: "german", es: "spanish", fr: "french", pt: "portuguese",
  it: "italian", nl: "dutch", pl: "polish", el: "greek", ru: "russian", uk: "ukrainian" };

export function accentChars(lang) {
  return [...(ACCENTS[lang] || "")];
}

// The next accented character still to type: in the current word from typedLen on, else in later words.
export function nextAccent(words, index, typedLen, chars) {
  const set = new Set(chars.map((c) => c.toLowerCase()));
  for (let i = index; i < Math.min(words.length, index + 4); i++) {
    const w = words[i] || "";
    const from = i === index ? typedLen : 0;
    for (let k = from; k < w.length; k++) if (set.has(w[k].toLowerCase())) return { ch: w[k], index: i, pos: k };
  }
  return null;
}

const MARK_US_INTL = { "́": ["'"], "̀": ["`"], "̂": ["shift", "6"], "̈": ["shift", "'"], "̃": ["shift", "`"] };
const ALTGR_US_INTL = { "ç": ",", "ß": "s", "œ": "k", "ø": "l", "å": "w", "æ": "z" };
const ALTGR_PL = { "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "x", "ż": "z" };

// Native layouts: a letter with its own key is [[key]]; a dead key is [[dead...], [letter]].
const NATIVE = {
  de: { name: "german qwertz", keys: { "ä": [["ä"]], "ö": [["ö"]], "ü": [["ü"]], "ß": [["ß"]] } },
  es: { name: "spanish", own: "ñ", marks: { "́": ["´"], "̈": ["shift", "´"] } },
  fr: { name: "french azerty", own: "éèàçù", marks: { "̂": ["^"], "̈": ["shift", "^"] },
    keys: { "œ": [["altgr", "o"]] } },
  pt: { name: "portuguese", own: "ç", marks: { "́": ["´"], "̀": ["shift", "´"], "̃": ["~"], "̂": ["shift", "~"] } },
  it: { name: "italian", own: "àèìòù", keys: { "é": [["shift", "è"]] } },
  pl: { name: "polish programmer", altgr: ALTGR_PL },
  el: { name: "greek", marks: { "́": [";"], "̈": ["shift", ";"] } },
};
export const LAYOUT_NAMES = Object.fromEntries(Object.entries(NATIVE).map(([k, v]) => [k, v.name]));

// How to type ch: an array of steps, each step the keys pressed together, e.g. [["'"], ["e"]].
// layout: "native" (the language's own layout) or "us-intl" (US-International). null if unknown.
export function layoutHint(ch, layout, lang) {
  if (!ch) return null;
  const lower = ch.toLowerCase();
  const upper = lower !== ch;
  const withShift = (steps) => {
    if (!upper || !steps) return steps;
    const last = steps[steps.length - 1];
    return steps.slice(0, -1).concat([last.includes("shift") ? last : ["shift"].concat(last)]);
  };
  const d = lower.normalize("NFD");
  const base = d[0], mark = d.length === 2 ? d[1] : null;
  if (layout === "native" && NATIVE[lang]) {
    const n = NATIVE[lang];
    if (n.keys && n.keys[lower]) return withShift(n.keys[lower]);
    if (n.own && n.own.includes(lower)) return withShift([[lower]]);
    if (n.altgr && n.altgr[lower]) return withShift([["altgr", n.altgr[lower]]]);
    if (mark && n.marks && n.marks[mark]) return withShift([n.marks[mark], [base]]);
    return null;
  }
  if (lang === "pl" && ALTGR_PL[lower]) return withShift([["altgr", ALTGR_PL[lower]]]);
  if (ALTGR_US_INTL[lower]) return withShift([["altgr", ALTGR_US_INTL[lower]]]);
  if (lower === "ñ") return withShift([["shift", "`"], ["n"]]);
  if (mark && MARK_US_INTL[mark] && /[a-z]/.test(base)) return withShift([MARK_US_INTL[mark], [base]]);
  return null;
}

// ── translations ──────────────────────────────────────────────────────────

// [{en, word}] -> single-token entries, deduped by word; lower-cased when lower is set.
export function cleanTranslations(list, lang, lower = false) {
  const seen = new Set(), out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.en !== "string" || typeof e.word !== "string") continue;
    let word = e.word.trim();
    if (!word || /\s/.test(word)) continue;
    if (lower) word = word.toLocaleLowerCase(lang || undefined);
    if (seen.has(word)) continue;
    seen.add(word);
    out.push({ en: e.en.trim(), word });
  }
  return out;
}

// Correct translations in a race: committed words typed exactly (the engine already folded lenient accents).
export function raceScore(words, typed, index, finished) {
  let n = 0;
  const upto = finished ? Math.min(typed.length, words.length) : index;
  for (let i = 0; i < upto; i++) if (typed[i] === words[i]) n++;
  return n;
}

// ── training plans ────────────────────────────────────────────────────────
// An item matches a saved result: { drill: 'pairs' } -> source 'train:pairs'; { test: seconds } -> a plain
// test (no source) of at least that many seconds.

const D = {
  pairs: { drill: "pairs", label: "pair drill: your slowest pairs" },
  metronome: { drill: "metronome", label: "metronome: hold an even beat" },
  memory: { drill: "memory", label: "memory: a line from memory" },
  blind: { drill: "blind", label: "blind run" },
  mirror: { drill: "mirror", label: "mirror: reversed or scrambled" },
  test30: { test: 30, label: "a 30 s test" },
  test60: { test: 60, label: "a 60 s test" },
  test120: { test: 120, label: "a 120 s test" },
};

export const PLANS = [
  {
    id: "plus10", name: "+10 wpm in 4 weeks", days: 28,
    desc: "pairs and rhythm first, then speed. finish each day with a test to see it move.",
    cycle: [
      [D.pairs, D.metronome, D.test60],
      [D.pairs, D.memory, D.test30],
      [D.metronome, D.mirror, D.test60],
      [D.pairs, D.blind, D.test30],
      [D.pairs, D.metronome, D.memory, D.test60],
      [D.mirror, D.pairs, D.test30],
      [D.metronome, D.blind, D.test60],
    ],
  },
  {
    id: "accuracy", name: "accuracy at speed", days: 21,
    desc: "trust your fingers: blind runs and memory lines, an even beat, no looking back.",
    cycle: [
      [D.blind, D.metronome, D.test30],
      [D.memory, D.blind, D.test60],
      [D.metronome, D.memory, D.pairs],
      [D.blind, D.mirror, D.test30],
    ],
  },
  {
    id: "stamina", name: "stamina", days: 21,
    desc: "hold your speed for minutes, not seconds.",
    cycle: [
      [D.test120, D.metronome, D.pairs],
      [D.test60, D.blind, D.test120],
      [D.metronome, D.memory, D.test120],
    ],
  },
];

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(fromKey, toKey) {
  const p = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(toKey) - p(fromKey)) / 86400000);
}

export function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

export function startPlan(id, now) {
  return { id, start: dayKey(now), done: {} };
}

// { plan, day (1-based), items, done: [bool], over } for the state's plan on the day of `now`.
export function planToday(state, now) {
  const plan = state && planById(state.id);
  if (!plan) return null;
  const today = dayKey(now);
  const idx = Math.max(0, daysBetween(state.start, today));
  const items = plan.cycle[idx % plan.cycle.length];
  const doneIdx = (state.done && state.done[today]) || [];
  return { plan, day: idx + 1, items, done: items.map((_, i) => doneIdx.includes(i)), over: idx >= plan.days, today };
}

export function itemMatches(item, r) {
  if (!r) return false;
  if (item.drill) return r.source === "train:" + item.drill;
  if (item.test) return !r.source && Number(r.duration) >= item.test - 1;
  return false;
}

// Which of today's items today's results satisfy: each result ticks the first item it matches that no
// earlier result ticked. Deterministic, so re-running it over the same results changes nothing.
export function autoTicks(items, results) {
  const done = new Set();
  for (const r of results || []) {
    const i = items.findIndex((item, k) => !done.has(k) && itemMatches(item, r));
    if (i >= 0) done.add(i);
  }
  return done;
}

export function setTick(state, key, i, on) {
  const done = Object.assign({}, state.done);
  const list = new Set(done[key] || []);
  if (on) list.add(i); else list.delete(i);
  done[key] = [...list].sort((a, b) => a - b);
  return Object.assign({}, state, { done });
}

// Merge the ticks today's saved results earn into the state (manual ticks are kept). Idempotent.
export function syncFromResults(state, results, now) {
  const t = planToday(state, now);
  if (!t) return state;
  const todays = (results || []).filter((r) => r && dayKey(r.ts) === t.today);
  const auto = autoTicks(t.items, todays);
  const have = new Set((state.done && state.done[t.today]) || []);
  if ([...auto].every((i) => have.has(i))) return state;
  auto.forEach((i) => have.add(i));
  return Object.assign({}, state, { done: Object.assign({}, state.done, { [t.today]: [...have].sort((a, b) => a - b) }) });
}

// Days on which every item was done, for the plan's progress bar.
export function daysComplete(state) {
  const plan = state && planById(state.id);
  if (!plan) return 0;
  let n = 0;
  for (const [key, list] of Object.entries(state.done || {})) {
    const idx = daysBetween(state.start, key);
    if (idx < 0) continue;
    if (list.length >= plan.cycle[idx % plan.cycle.length].length) n++;
  }
  return n;
}
