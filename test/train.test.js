const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/js/engine.js");

const load = () => import("../public/js/views/train/lib.js");

// A result typed at a fixed gap per key, so pair medians are known.
function typed(words, gapFor) {
  const s = E.createTest({ mode: "words", words, ordered: true, wordCount: words.length });
  let t = 1000;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (let k = 0; k < w.length; k++) {
      t += k ? gapFor(w[k - 1] + w[k]) : 100;
      E.input(s, w[k], t);
    }
    if (i < words.length - 1) { t += 100; E.space(s, t); }
  }
  const r = E.results(s);
  r.ts = Date.now();
  return r;
}

test("parsePairs keeps unique two-letter pairs", async () => {
  const { parsePairs } = await load();
  assert.deepEqual(parsePairs("th, CK,x,abc,th;é1,ñe"), ["th", "ck", "ñe"]);
  assert.deepEqual(parsePairs(""), []);
});

test("slowestPairs and pairMedians read Engine.pairTimes", async () => {
  const { slowestPairs, pairMedians, pairComparison } = await load();
  const words = Array(6).fill(["the", "check"]).flat();
  const r = typed(words, (p) => (p === "ck" ? 300 : 80));
  assert.equal(slowestPairs(E, [r], 1)[0], "ck");
  const m = pairMedians(E, [r], ["ck", "zz"]);
  assert.equal(m.ck, 300);
  assert.equal(m.zz, null);
  const rows = pairComparison({ ck: 300 }, { ck: 250 }, ["ck", "zz"]);
  assert.deepEqual(rows[0], { pair: "ck", before: 300, after: 250, delta: -50 });
  assert.equal(rows[1].delta, null);
  assert.deepEqual(slowestPairs(E, [], 5), []);
});

test("memoryShowMs scales with length and is clamped", async () => {
  const { memoryShowMs } = await load();
  assert.equal(memoryShowMs(""), 1500);
  assert.ok(memoryShowMs("the quick brown fox jumps over") > memoryShowMs("the quick"));
  assert.equal(memoryShowMs("x".repeat(500)), 12000);
});

test("wordAccuracy and memoryScore", async () => {
  const { wordAccuracy, memoryScore } = await load();
  assert.deepEqual(wordAccuracy(["a", "b", "c", "d"], ["a", "x", "c"]), { correct: 2, total: 4, pct: 50 });
  assert.equal(memoryScore(150, 50), 75);
});

test("metronome: beat, gaps and evenness", async () => {
  const { beatMs, gapsFromLog, evenness } = await load();
  assert.equal(beatMs(120), 100);
  assert.deepEqual(gapsFromLog([[0, "a"], [100, "b"], [150, "\b"], [300, "c"], [420, " "]]), [100, 120]);
  assert.deepEqual(evenness([100, 100, 100], 100), { mad: 0, score: 100, n: 3, meanGap: 100 });
  const e = evenness([80, 120], 100);
  assert.equal(e.mad, 20);
  assert.equal(e.score, 80);
  assert.equal(evenness([], 100).score, 0);
  assert.equal(evenness([500], 100).score, 0); // clamped
});

test("scramble changes the word but keeps its letters", async () => {
  const { scramble } = await load();
  const rand = E.mulberry32(3);
  for (const w of ["typing", "ab", "hello", "zürich"]) {
    const s = scramble(w, rand);
    assert.notEqual(s, w);
    assert.deepEqual([...s].sort(), [...w].sort());
  }
  assert.equal(scramble("aaa", rand), "aaa");
  assert.equal(scramble("a", rand), "a");
});

test("nextAccent finds the next accented char in this or later words", async () => {
  const { nextAccent, accentChars } = await load();
  const chars = accentChars("de");
  assert.deepEqual(nextAccent(["schön", "über"], 0, 0, chars), { ch: "ö", index: 0, pos: 3 });
  assert.deepEqual(nextAccent(["schön", "Über"], 0, 4, chars), { ch: "Ü", index: 1, pos: 0 });
  assert.equal(nextAccent(["hallo"], 0, 0, chars), null);
  assert.deepEqual(accentChars("en"), []);
});

test("layoutHint: US-International dead keys, AltGr and native keys", async () => {
  const { layoutHint } = await load();
  assert.deepEqual(layoutHint("é", "us-intl", "fr"), [["'"], ["e"]]);
  assert.deepEqual(layoutHint("ü", "us-intl", "de"), [["shift", "'"], ["u"]]);
  assert.deepEqual(layoutHint("ê", "us-intl", "fr"), [["shift", "6"], ["e"]]);
  assert.deepEqual(layoutHint("ñ", "us-intl", "es"), [["shift", "`"], ["n"]]);
  assert.deepEqual(layoutHint("ß", "us-intl", "de"), [["altgr", "s"]]);
  assert.deepEqual(layoutHint("É", "us-intl", "fr"), [["'"], ["shift", "e"]]);
  assert.deepEqual(layoutHint("ą", "us-intl", "pl"), [["altgr", "a"]]);
  assert.deepEqual(layoutHint("ä", "native", "de"), [["ä"]]);
  assert.deepEqual(layoutHint("á", "native", "es"), [["´"], ["a"]]);
  assert.deepEqual(layoutHint("ê", "native", "fr"), [["^"], ["e"]]);
  assert.deepEqual(layoutHint("é", "native", "fr"), [["é"]]);
  assert.deepEqual(layoutHint("é", "native", "it"), [["shift", "è"]]);
  assert.deepEqual(layoutHint("ã", "native", "pt"), [["~"], ["a"]]);
  assert.deepEqual(layoutHint("ά", "native", "el"), [[";"], ["α"]]);
  assert.equal(layoutHint("x", "native", "de"), null);
});

test("cleanTranslations and raceScore", async () => {
  const { cleanTranslations, raceScore } = await load();
  const list = cleanTranslations([{ en: "house", word: "Haus" }, { en: "x", word: "a b" }, { en: "home", word: "haus" }, null, { en: "y" }], "de", true);
  assert.deepEqual(list, [{ en: "house", word: "haus" }]);
  assert.equal(raceScore(["a", "b", "c"], ["a", "x", "c"], 2, false), 1);
  assert.equal(raceScore(["a", "b", "c"], ["a", "x", "c"], 2, true), 2);
});

test("plans: today's items, auto ticks from results, idempotent sync, completed days", async () => {
  const L = await load();
  const day0 = new Date(2026, 8, 1, 9).getTime();
  const day1 = day0 + 86400000;
  let s = L.startPlan("plus10", day0);
  const t0 = L.planToday(s, day0);
  assert.equal(t0.day, 1);
  assert.equal(t0.items.length, 3);
  assert.deepEqual(t0.done, [false, false, false]);
  const results = [
    { source: "train:pairs", ts: day0 + 1000, duration: 20 },
    { ts: day0 + 2000, duration: 30 }, // a 30 s test does not satisfy "a 60 s test"
    { ts: day1, duration: 60 }, // another day
  ];
  s = L.syncFromResults(s, results, day0 + 5000);
  assert.deepEqual(L.planToday(s, day0).done, [true, false, false]);
  assert.equal(L.syncFromResults(s, results, day0 + 5000), s); // idempotent
  results.push({ source: "train:metronome", ts: day0 + 6000, duration: 30 }, { ts: day0 + 7000, duration: 60 });
  s = L.syncFromResults(s, results, day0 + 8000);
  assert.deepEqual(L.planToday(s, day0).done, [true, true, true]);
  assert.equal(L.daysComplete(s), 1);
  const t1 = L.planToday(s, day1);
  assert.equal(t1.day, 2);
  assert.deepEqual(t1.done, [false, false, false]);
  s = L.setTick(s, t1.today, 1, true);
  assert.deepEqual(L.planToday(s, day1).done, [false, true, false]);
  assert.equal(L.planToday({ id: "nope" }, day0), null);
});
