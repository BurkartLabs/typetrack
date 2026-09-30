"use strict";
// Server-side check of a submitted typing result: the claimed wpm/acc must match what the engine derives
// from the keystroke log and the word list. The engine is the same file the browser runs.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { HttpError } = require("./http.js");

const Engine = createRequire(__filename)("../public/js/engine.js");

const MAX_WPM = 350;
const MIN_TIME_S = 5;
const MAX_TIME_S = 600;
const MAX_WORDS_TARGET = 1000;
const MAX_LOG = 20000;
const MAX_WORDS = 3000;
const TOL_WPM = 1;
const TOL_ACC = 1;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{1,8})?$/;

function bad(msg) {
  return new HttpError(422, msg);
}

// Shape checks. Returns a normalised copy of the fields we use.
function checkShape(r) {
  const mode = r.mode;
  if (mode !== "time" && mode !== "words") throw bad("mode must be time or words");
  const lang = typeof r.lang === "string" ? r.lang : "en";
  if (!LANG_RE.test(lang)) throw bad("invalid lang");
  const target = Number(r.target != null ? r.target : mode === "time" ? r.duration : r.wordCount);
  if (!Number.isInteger(target)) throw bad("invalid target");
  if (mode === "time" && (target < MIN_TIME_S || target > MAX_TIME_S)) throw bad("time target out of range");
  if (mode === "words" && (target < 1 || target > MAX_WORDS_TARGET)) throw bad("words target out of range");

  const words = r.words;
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_WORDS) throw bad("words missing");
  for (const w of words) if (typeof w !== "string" || w.length < 1 || w.length > 64 || /\s/.test(w)) throw bad("invalid word");
  if (mode === "words" && words.length !== target) throw bad("words list does not match target");

  const log = r.log;
  if (!Array.isArray(log) || log.length === 0) throw bad("keystroke log missing");
  if (log.length > MAX_LOG) throw bad("keystroke log too long");
  let prev = -Infinity;
  for (const e of log) {
    if (!Array.isArray(e) || e.length < 2) throw bad("invalid log entry");
    const [t, k] = e;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t < prev) throw bad("invalid log time");
    if (typeof k !== "string" || k.length < 1 || k.length > 2) throw bad("invalid log key");
    prev = t;
  }
  for (const f of ["wpm", "acc"]) if (typeof r[f] !== "number" || !Number.isFinite(r[f])) throw bad(`${f} missing`);
  return { mode, lang, target, words, log };
}

// Replays the log through the engine. Mirrors the browser: tick before every key so keys after the clock
// ran out are ignored, then close the test at its deadline (time) or last key (words).
function replay(n) {
  const s = Engine.createTest({
    mode: n.mode,
    duration: n.mode === "time" ? n.target : undefined,
    wordCount: n.mode === "words" ? n.target : undefined,
    words: n.words,
    seed: 1,
  });
  s.words = n.words.slice();
  for (const [t, k] of n.log) {
    Engine.tick(s, t);
    if (s.finishedAt !== null) break;
    if (k === "\b") Engine.backspace(s);
    else if (k === " ") Engine.space(s, t);
    else Engine.input(s, k, t);
    pastEnd(s, n);
  }
  if (n.mode === "time") {
    Engine.tick(s, s.startedAt + n.target * 1000);
  } else if (s.finishedAt === null) {
    throw bad("words test not finished");
  }
  if (s.startedAt === null) throw bad("no keystrokes");
  return Engine.results(s);
}

// Time mode's buffer top-up appends words; anything typed must be inside the submitted list. Sitting on an
// empty word just past the list (a trailing space) is fine.
function pastEnd(s, n) {
  if (s.index > n.words.length || (s.index === n.words.length && s.typed[s.index] !== "")) {
    throw bad("log runs past the word list");
  }
}

// Returns the engine's numbers for a submitted result or throws 422.
function verifyResult(r) {
  const n = checkShape(r);
  let derived;
  if (typeof Engine.verify === "function") {
    const v = Engine.verify({ ...r, mode: n.mode, target: n.target, lang: n.lang, words: n.words, log: n.log });
    if (!v || !v.ok) throw bad("result does not match its keystroke log");
    const lastT = n.log[n.log.length - 1][0] - n.log[0][0];
    derived = {
      wpm: v.wpm,
      acc: v.acc,
      raw: v.raw,
      duration: v.duration != null ? v.duration : n.mode === "time" ? n.target : Math.round(lastT / 1000),
      chars: v.chars || r.chars,
    };
  } else {
    derived = replay(n);
  }
  if (Math.abs(derived.wpm - r.wpm) > TOL_WPM || Math.abs(derived.acc - r.acc) > TOL_ACC) {
    throw bad("result does not match its keystroke log");
  }
  if (derived.wpm > MAX_WPM) throw bad("implausible wpm");
  if (n.mode === "time" && derived.duration < MIN_TIME_S) throw bad("test too short");
  if (n.mode === "words" && derived.duration < 1) throw bad("test too short");
  return { ...n, wpm: derived.wpm, acc: derived.acc, raw: derived.raw == null ? derived.wpm : derived.raw,
    duration: derived.duration, chars: derived.chars || {} };
}

// Ranked = every word comes from the language's standard common-*.json lists, so a test of "a a a a"
// cannot top the board. Lists are read from <wordsDir>/<lang>/common-*.json; a missing language is unranked.
function wordLists(wordsDir) {
  const cache = new Map(); // lang -> {set, checked}
  return function isRanked(lang, words) {
    let entry = cache.get(lang);
    if (!entry || (!entry.set && Date.now() - entry.checked > 60000)) {
      entry = { set: load(wordsDir, lang), checked: Date.now() };
      cache.set(lang, entry);
    }
    return Boolean(entry.set) && words.every((w) => entry.set.has(w));
  };
}

function load(wordsDir, lang) {
  const dir = path.join(wordsDir, lang);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^common-[\w-]+\.json$/.test(f));
  } catch {
    return null;
  }
  const set = new Set();
  for (const f of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (Array.isArray(arr)) for (const w of arr) if (typeof w === "string") set.add(w);
    } catch {
      /* skip a broken list */
    }
  }
  return set.size ? set : null;
}

module.exports = { verifyResult, replay, checkShape, wordLists, Engine, MAX_WPM };
