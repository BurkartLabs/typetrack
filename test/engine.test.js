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
