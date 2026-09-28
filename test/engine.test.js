const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/js/engine.js");

const POOL = ["alpha", "beta", "gamma", "delta", "omega"];

function typeWord(s, word, t) {
  for (const ch of word) E.input(s, ch, t);
}

test("words mode: typing every word correctly ends the test with 100% accuracy", () => {
  const s = E.createTest({ mode: "words", wordCount: 3, words: POOL, seed: 1 });
  const [a, b, c] = s.words;
  typeWord(s, a, 0);
  E.space(s, 1000);
  typeWord(s, b, 2000);
  E.space(s, 3000);
  typeWord(s, c, 4000); // finishes on the last correct character
  assert.notEqual(s.finishedAt, null);
  const r = E.results(s);
  assert.equal(r.acc, 100);
  assert.equal(r.chars.incorrect, 0);
  assert.equal(r.chars.missed, 0);
});

test("wpm is correct characters / 5 per minute", () => {
  // Two five-letter words + one space = 12 correct chars over 12 seconds.
  const s = E.createTest({ mode: "words", wordCount: 2, words: ["hello", "world"], seed: 1 });
  s.words = ["hello", "world"]; // pin the sequence
  typeWord(s, "hello", 0);
  E.space(s, 6000);
  typeWord(s, "world", 12000);
  const r = E.results(s);
  // correct chars: "hello"+space = 6, "world" = 5, plus the implied final space = 12
  assert.equal(r.wpm, 12); // 12 chars / 5 = 2.4 words per 0.2 min = 12 wpm
  assert.equal(r.duration, 12);
});

test("time mode ends on tick when the clock runs out and counts the unfinished tail as missed", () => {
  const s = E.createTest({ mode: "time", duration: 15, words: POOL, seed: 7 });
  const w = s.words[0];
  E.input(s, w[0], 0);
  E.tick(s, 14999);
  assert.equal(s.finishedAt, null);
  E.tick(s, 15000);
  assert.equal(s.finishedAt, 15000);
  assert.equal(E.results(s).chars.missed, w.length - 1);
  assert.equal(E.results(s).duration, 15);
});

test("time mode tops up its word buffer", () => {
  const s = E.createTest({ mode: "time", duration: 30, words: POOL, seed: 3 });
  const before = s.words.length;
  for (let i = 0; i < 70; i++) {
    typeWord(s, s.words[s.index], i * 100);
    E.space(s, i * 100 + 50);
  }
  assert.ok(s.words.length > before);
  assert.ok(s.words.length - s.index >= 40);
});

test("wrong letters, extras and backspace are tallied", () => {
  const s = E.createTest({ mode: "words", wordCount: 2, words: ["abc", "xyz"], seed: 1 });
  s.words = ["abc", "xyz"];
  E.input(s, "a", 0);
  E.input(s, "x", 10); // wrong
  E.backspace(s);
  E.input(s, "b", 20);
  E.input(s, "c", 30);
  E.input(s, "q", 40); // extra
  assert.deepEqual(s.typed, ["abcq"]);
  assert.equal(s.correct, 3);
  assert.equal(s.incorrect, 1);
  assert.equal(s.extra, 1);
  E.space(s, 50);
  assert.equal(s.index, 1);
  // can back into the previous word because it was wrong
  E.backspace(s);
  assert.equal(s.index, 0);
  assert.equal(s.typed[0], "abcq");
});

test("cannot back into a previous word that was typed correctly", () => {
  const s = E.createTest({ mode: "words", wordCount: 3, words: ["ab", "cd", "ef"], seed: 1 });
  s.words = ["ab", "cd", "ef"];
  typeWord(s, "ab", 0);
  E.space(s, 10);
  E.backspace(s);
  assert.equal(s.index, 1);
});

test("input after finish is ignored", () => {
  const s = E.createTest({ mode: "words", wordCount: 1, words: ["ab"], seed: 1 });
  s.words = ["ab"];
  typeWord(s, "ab", 0);
  assert.notEqual(s.finishedAt, null);
  E.input(s, "z", 100);
  assert.equal(s.typed[0], "ab");
});

test("perSecond is a cumulative series with one entry per second", () => {
  const s = E.createTest({ mode: "time", duration: 3, words: ["aaaaa"], seed: 1 });
  typeWord(s, "aaaaa", 0); // 5 correct chars in the first second
  E.tick(s, 3000);
  const r = E.results(s);
  assert.equal(r.perSecond.length, 3);
  assert.equal(r.perSecond[0], 60); // 1 word in 1 s = 60 wpm
  assert.equal(r.perSecond[2], 20); // same word over 3 s
});

test("movingAverage and summarize", () => {
  assert.deepEqual(E.movingAverage([10, 20, 30, 40], 2), [10, 15, 25, 35]);
  const rs = [
    { wpm: 50, acc: 90, duration: 30, mode: "time", target: 30 },
    { wpm: 70, acc: 100, duration: 30, mode: "time", target: 30 },
    { wpm: 60, acc: 95, duration: 15, mode: "time", target: 15 },
  ];
  const sum = E.summarize(rs);
  assert.equal(sum.count, 3);
  assert.equal(sum.best, 70);
  assert.equal(sum.avgAll, 60);
  assert.equal(sum.acc, 95);
  assert.equal(sum.seconds, 75);
  assert.deepEqual(E.filterResults(rs, "time 15").map((r) => r.wpm), [60]);
  assert.equal(E.filterResults(rs, "all").length, 3);
});

test("same seed gives the same words", () => {
  const a = E.createTest({ mode: "words", wordCount: 20, words: POOL, seed: 42 });
  const b = E.createTest({ mode: "words", wordCount: 20, words: POOL, seed: 42 });
  assert.deepEqual(a.words, b.words);
  for (let i = 1; i < a.words.length; i++) assert.notEqual(a.words[i], a.words[i - 1]);
});

test("errors: per-key misses, swaps, wrong words and errors per second are recorded", () => {
  const s = E.createTest({ mode: "words", wordCount: 2, words: ["ab"], seed: 1 });
  E.input(s, "a", 0); E.input(s, "x", 500); E.space(s, 900); // "ax" for "ab": 1 miss at 0.5s, bad space at 0.9s
  E.input(s, "a", 1500); E.input(s, "b", 1600); E.space(s, 1700);
  const r = E.results(s);
  assert.deepEqual(r.errors.keyMiss, { b: 1 });
  assert.deepEqual(r.errors.keyHits, { a: 2, b: 2 });
  assert.deepEqual(r.errors.swaps, { "b>x": 1 });
  assert.deepEqual(r.errors.words, [{ word: "ab", typed: "ax" }]);
  assert.deepEqual(r.errors.perSecond, [2, 0]);
  const p = E.errorProfile([Object.assign({ ts: 1 }, r), { wpm: 50, chars: { incorrect: 3, extra: 0, missed: 0 } }]);
  assert.equal(p.tracked, 1);
  assert.deepEqual(p.keys, [{ key: "b", hits: 2, miss: 1, rate: 50 }]);
  assert.deepEqual(p.words, [{ k: "ab", n: 1 }]);
  assert.equal(p.avgErrors, 2);
});

// ── v2: keystroke log, options, text mode ─────────────────────────────────

// Feed a script of [t, key] into a test ("\b" = backspace, " " = space).
function play(s, script) {
  for (const [t, k] of script) {
    if (k === "\b") E.backspace(s, t);
    else if (k === " ") E.space(s, t);
    else E.input(s, k, t);
  }
  return s;
}

// Type words at a steady ms per keystroke; returns the script.
function steady(words, ms, start = 0) {
  const out = [];
  let t = start;
  words.forEach((w, i) => {
    for (const ch of w) { out.push([t, ch]); t += ms; }
    if (i < words.length - 1) { out.push([t, " "]); t += ms; }
  });
  return out;
}

test("every effective keystroke is logged with ms since start", () => {
  const s = E.createTest({ mode: "words", ordered: true, words: ["ab", "cd"] });
  E.space(s, 500); // leading space before start: ignored, not logged
  E.backspace(s, 600); // nothing to delete: not logged
  play(s, [[1000, "a"], [1100, "x"], [1200, "\b"], [1300, "b"], [1400, " "], [1500, "c"], [1600, "d"]]);
  assert.deepEqual(s.log, [[0, "a"], [100, "x"], [200, "\b"], [300, "b"], [400, " "], [500, "c"], [600, "d"]]);
  const r = E.results(s);
  assert.deepEqual(r.log, s.log);
  assert.deepEqual(r.words, ["ab", "cd"]);
  assert.equal(r.lang, "en");
  assert.equal(r.accents, "strict");
  // backspace without a time (older callers) is logged at the previous keystroke's time
  const s2 = E.createTest({ mode: "words", ordered: true, words: ["ab"] });
  E.input(s2, "x", 50);
  E.backspace(s2);
  assert.deepEqual(s2.log, [[0, "x"], [0, "\b"]]);
});

test("results.words is trimmed to the words reached and lang is recorded", () => {
  const s = E.createTest({ mode: "time", duration: 5, words: POOL, seed: 9, lang: "es" });
  const [a, b] = s.words;
  play(s, steady([a, b], 50));
  E.space(s, 2000);
  E.tick(s, 5000);
  const r = E.results(s);
  assert.equal(r.lang, "es");
  assert.deepEqual(r.words, s.words.slice(0, 3));
});

test("ordered word lists are used in order, not shuffled", () => {
  const list = ["one", "two", "three", "four"];
  const s = E.createTest({ mode: "words", ordered: true, words: list });
  assert.deepEqual(s.words, list);
  assert.equal(s.wordCount, 4);
  const s2 = E.createTest({ mode: "words", ordered: true, words: list, wordCount: 6 });
  assert.deepEqual(s2.words, ["one", "two", "three", "four", "one", "two"]);
  const t = E.createTest({ mode: "time", ordered: true, words: list, duration: 30 });
  assert.deepEqual(t.words.slice(0, 5), ["one", "two", "three", "four", "one"]);
  for (let i = 0; i < 70; i++) { play(t, steady([t.words[t.index]], 1, i * 50)); E.space(t, i * 50 + 20); }
  assert.ok(t.words.length > 100);
  assert.equal(t.words[100], list[100 % 4]);
});

test("text mode splits the text on whitespace and ends on the last word", () => {
  const s = E.createTest({ mode: "text", text: "  the quick\nbrown fox " });
  assert.deepEqual(s.words, ["the", "quick", "brown", "fox"]);
  play(s, steady(["the", "quick", "brown", "fox"], 60));
  assert.notEqual(s.finishedAt, null);
  const r = E.results(s);
  assert.equal(r.mode, "text");
  assert.equal(r.target, 4);
  assert.equal(r.acc, 100);
  assert.throws(() => E.createTest({ mode: "text", text: "   " }));
});

test("noBackspace ignores backspace", () => {
  const s = E.createTest({ mode: "words", ordered: true, words: ["ab", "cd"], noBackspace: true });
  play(s, [[0, "a"], [10, "x"], [20, "\b"]]);
  assert.equal(s.typed[0], "ax");
  assert.deepEqual(s.log, [[0, "a"], [10, "x"]]);
  E.space(s, 30);
  E.backspace(s, 40);
  assert.equal(s.index, 1);
  assert.equal(E.results(s).noBackspace, true);
});

test("accents: lenient accepts the base letter, strict does not", () => {
  const words = ["café", "niño", "façade"];
  const typedPlain = steady(["cafe", "nino", "facade"], 50);
  const lenient = play(E.createTest({ mode: "words", ordered: true, words, accents: "lenient" }), typedPlain);
  assert.notEqual(lenient.finishedAt, null);
  assert.deepEqual(lenient.typed, words); // the accented target is stored
  assert.equal(E.results(lenient).acc, 100);
  assert.equal(lenient.log[3][1], "e"); // the log keeps the key actually pressed
  const strict = play(E.createTest({ mode: "words", ordered: true, words }), typedPlain);
  assert.equal(strict.finishedAt, null); // "facade" never matches "façade"
  assert.equal(strict.incorrect, 3);
  assert.deepEqual(strict.swaps, { "é>e": 1, "ñ>n": 1, "ç>c": 1 });
  // the exact accented key is fine in both modes; ß and ø have no base letter
  const exact = play(E.createTest({ mode: "words", ordered: true, words: ["é"], accents: "lenient" }), [[0, "é"]]);
  assert.equal(E.results(exact).acc, 100);
  const noBase = play(E.createTest({ mode: "words", ordered: true, words: ["ßø"], accents: "lenient" }), [[0, "s"], [5, "o"]]);
  assert.equal(noBase.incorrect, 2);
});

// ── v2: replay, stateAt, verify ───────────────────────────────────────────

// A realistic run with errors, corrections, backing into a wrong word and a time limit.
function messyTimeRun() {
  const s = E.createTest({ mode: "time", duration: 3, words: POOL, seed: 5, lang: "fr" });
  let t = 0;
  const key = (k) => { E.input(s, k, t); t += 37.3; };
  for (let i = 0; i < 12; i++) {
    const w = s.words[s.index];
    if (i === 2) { key("z"); E.backspace(s, t); t += 40; }
    if (i === 4) { key(w[0]); E.space(s, t); t += 40; E.backspace(s, t); t += 40; for (const ch of w.slice(1)) key(ch); E.space(s, t); t += 40; continue; }
    for (const ch of w) key(ch);
    if (i === 6) key("q"); // extra
    E.space(s, t); t += 45;
  }
  E.tick(s, 3000);
  return E.results(s);
}

test("replay(result) rebuilds the same result from the log (time mode, messy run)", () => {
  const r = messyTimeRun();
  assert.ok(r.chars.incorrect + r.chars.extra > 0);
  const again = E.results(E.replay(r, r.log));
  for (const k of ["wpm", "raw", "acc", "chars", "perSecond", "errors", "mode", "target", "lang", "words", "log"]) {
    assert.deepEqual(again[k], r[k], k);
  }
  // replay(words, log, opts) form from the architecture doc
  const again2 = E.results(E.replay(r.words, r.log, { mode: r.mode, target: r.target }));
  assert.equal(again2.wpm, r.wpm);
});

test("replay roundtrip: words mode, text mode and lenient accents", () => {
  const w = E.createTest({ mode: "words", wordCount: 4, words: POOL, seed: 11 });
  play(w, steady(w.words, 55));
  const rw = E.results(w);
  assert.deepEqual(E.results(E.replay(rw)), rw);
  const tx = E.createTest({ mode: "text", text: "déjà vu garçon", accents: "lenient" });
  play(tx, steady(["deja", "vu", "garcon"], 70));
  const rt = E.results(tx);
  assert.equal(rt.acc, 100);
  assert.deepEqual(E.results(E.replay(rt)), rt);
});

test("stateAt gives the ghost's word and typed prefix at any time", () => {
  const words = ["ab", "cd"];
  const log = [[0, "a"], [100, "x"], [200, "\b"], [300, "b"], [400, " "], [500, "c"], [600, "d"]];
  assert.deepEqual(E.stateAt(words, log, -5), { index: 0, typed: "" });
  assert.deepEqual(E.stateAt(words, log, 0), { index: 0, typed: "a" });
  assert.deepEqual(E.stateAt(words, log, 150), { index: 0, typed: "ax" });
  assert.deepEqual(E.stateAt(words, log, 250), { index: 0, typed: "a" });
  assert.deepEqual(E.stateAt(words, log, 450), { index: 1, typed: "" });
  assert.deepEqual(E.stateAt(words, log, 99999), { index: 1, typed: "cd" });
  // fast enough per frame: 10k lookups on a long log
  const r = messyTimeRun();
  const t0 = Date.now();
  for (let i = 0; i < 10000; i++) E.stateAt(r.words, r.log, i % 3000);
  assert.ok(Date.now() - t0 < 500);
});

test("verify accepts an honest result and catches tampering", () => {
  const r = messyTimeRun();
  assert.deepEqual(E.verify(r), { ok: true, wpm: r.wpm, acc: r.acc, raw: r.raw });
  const clone = () => JSON.parse(JSON.stringify(r));
  const inflated = clone(); inflated.wpm += 5;
  assert.equal(E.verify(inflated).ok, false);
  assert.equal(E.verify(inflated).wpm, r.wpm);
  const acc = clone(); acc.acc = 100;
  assert.equal(E.verify(acc).ok, false);
  // in a time run the log decides what was typed within the limit; in a words run it decides the time taken
  const w5 = E.createTest({ mode: "words", wordCount: 5, words: POOL, seed: 4 });
  play(w5, steady(w5.words, 60));
  const rw = E.results(w5);
  assert.equal(E.verify(rw).ok, true);
  const squeezed = JSON.parse(JSON.stringify(rw));
  squeezed.log = squeezed.log.map(([t, k]) => [t / 2, k]); // same keys, claimed at the old speed
  assert.equal(E.verify(squeezed).ok, false);
  assert.ok(E.verify(squeezed).wpm > rw.wpm * 1.9);
  const late = clone(); late.log.push([9000, "a"]);
  assert.equal(E.verify(late).ok, false);
  const swapped = clone(); swapped.words[0] = "zzzzz"; // words changed under the log
  assert.equal(E.verify(swapped).ok, false);
  const target = clone(); target.target = 15;
  assert.equal(E.verify(target).ok, false);
  const bad = clone(); bad.log[3] = [bad.log[3][0], "ab"];
  assert.equal(E.verify(bad).ok, false);
  assert.equal(E.verify({ wpm: 100 }).ok, false);
  // an unfinished words run does not verify
  const w = E.createTest({ mode: "words", wordCount: 3, words: POOL, seed: 2 });
  play(w, steady(w.words.slice(0, 2), 50));
  assert.equal(E.verify(E.results(w)).ok, false);
});
