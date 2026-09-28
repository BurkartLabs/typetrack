const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../public/js/views/games/pack1-logic.js");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("pack1 registry: unique ids, lazy loaders, a module file per game", async () => {
  const fs = require("node:fs"), path = require("node:path");
  const { default: list } = await import("../public/js/views/games/pack1.js");
  const ids = list.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const g of list) {
    assert.equal(typeof g.load, "function");
    assert.ok(g.name && g.desc && Array.isArray(g.tags));
    assert.ok(fs.existsSync(path.join(__dirname, "../public/js/views/games", g.id + ".js")), g.id);
  }
});

test("wpm maths: 5 chars in 1 s is 60 wpm; charMs inverts it", async () => {
  const L = await load();
  near(L.wpmFrom(5, 1000), 60);
  assert.equal(L.wpmFrom(0, 1000), 0);
  assert.equal(L.wpmFrom(10, 0), 0);
  near(L.charMs(60), 200);
  near(L.wpmFrom(1, L.charMs(143)), 143);
  assert.equal(L.accuracy(99, 1), 99);
  assert.equal(L.accuracy(0, 0), 100);
});

test("charMatch: lenient accents fold, strict does not, spaces never fold", async () => {
  const L = await load();
  assert.ok(L.charMatch("é", "e", true));
  assert.ok(!L.charMatch("é", "e", false));
  assert.ok(L.charMatch("a", "a", false));
  assert.ok(!L.charMatch(" ", "a", true));
  assert.ok(!L.charMatch("a", "b", true));
});

test("rng and pickWord: seeded, avoids repeats, minLen narrows when enough words", async () => {
  const L = await load();
  const a = L.makeRng(7), b = L.makeRng(7);
  assert.equal(a(), b());
  const pool = Array.from({ length: 50 }, (_, i) => "w".repeat(1 + (i % 8)) + i);
  const rng = L.makeRng(1);
  for (let i = 0; i < 100; i++) assert.ok(L.pickWord(pool, rng, null, 7).length >= 7);
  const tiny = ["aa", "bb"];
  for (let i = 0; i < 50; i++) assert.notEqual(L.pickWord(tiny, rng, "aa"), "aa");
  // minLen with too few long words falls back to the whole pool
  assert.ok(pool.includes(L.pickWord(pool, rng, null, 50)));
});

test("scores: bestScore, topScores, bestWpm, recentAvgWpm", async () => {
  const L = await load();
  assert.equal(L.bestScore([]), null);
  assert.equal(L.bestScore([{ score: 3 }, { score: 9 }, { score: 1 }]), 9);
  assert.deepEqual(L.topScores([{ score: 1, ts: 1 }, { score: 5, ts: 2 }, { score: 3, ts: 3 }], 2).map((e) => e.score), [5, 3]);
  const res = [{ wpm: 150, lang: "en" }, { wpm: 190, lang: "de" }, { wpm: 170 }];
  assert.equal(L.bestWpm(res), 190);
  assert.equal(L.bestWpm(res, "en"), 170);
  assert.equal(L.bestWpm([]), null);
  near(L.recentAvgWpm([{ wpm: 100 }, { wpm: 120 }, { wpm: 140 }], 2), 130);
  assert.equal(L.recentAvgWpm([], 10), null);
});

test("sprint: phrase is 5-8 words within 24-60 chars; wpm counts keystroke intervals", async () => {
  const L = await load();
  const rng = L.makeRng(3);
  const pool = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "and", "runs", "far", "away"];
  for (let i = 0; i < 200; i++) {
    const p = L.makePhrase(pool, rng);
    const n = p.split(" ").length;
    assert.ok(n >= 5 && n <= 8, p);
    assert.ok(p.length >= 24 && p.length <= 60, p);
  }
  // 31 chars -> 30 intervals = 6 "words" in 3 s = 120 wpm
  near(L.sprintWpm("x".repeat(31), 3000), 120);
});

test("treadmill: speed steps +5 every 10 s; distance integrates the steps", async () => {
  const L = await load();
  assert.equal(L.treadmillSpeed(0), 80);
  assert.equal(L.treadmillSpeed(9999), 80);
  assert.equal(L.treadmillSpeed(10000), 85);
  assert.equal(L.treadmillSpeed(125000), 140);
  // 10 s at 80 wpm = 80*5/6 chars; then 5 s at 85
  near(L.treadmillDistance(10000), (80 * 5) / 6);
  near(L.treadmillDistance(15000), (80 * 5) / 6 + (85 * 5) / 12);
});

test("treadmill: the belt drags the pace to within `lead` chars and otherwise moves at speed", async () => {
  const L = await load();
  // 1 s at 120 wpm = 10 chars
  near(L.treadmillStep(0, 1000, 120, 100, 30), 70);  // dragged: 100 - 30
  near(L.treadmillStep(80, 1000, 120, 100, 30), 90); // free
  assert.ok(L.treadmillStep(95, 1000, 120, 100, 30) >= 100); // caught
});

test("word bomb: fuse is (len+1) chars at target + grace; target ramps and caps", async () => {
  const L = await load();
  near(L.bombFuse("hello", 120), 6 * 100 + L.BOMB.grace);
  near(L.bombTarget(150, 0), 150);
  near(L.bombTarget(150, 10), 150 * 1.04);
  near(L.bombTarget(150, 10000), 150 * 1.25);
  near(L.ema(100, 200, 0.25), 125);
});

test("word ladder: window shrinks exactly 3% per rung; need is the wpm it demands", async () => {
  const L = await load();
  const w0 = L.ladderWindow("hello", 0);
  near(w0, 6 * (12000 / 70) + 300);
  near(L.ladderWindow("hello", 1) / w0, 0.97);
  near(L.ladderWindow("hello", 30) / w0, Math.pow(0.97, 30));
  near(L.ladderNeed("hello", 600), 120);
  // by rung 40 a five-letter word needs well over 150 wpm: hard enough for the fastest players
  assert.ok(L.ladderNeed("hello", L.ladderWindow("hello", 40)) > 150);
});

test("survival: minimum word length rises one letter per 20 words, capped at 8", async () => {
  const L = await load();
  assert.equal(L.survivalMinLen(0), 2);
  assert.equal(L.survivalMinLen(19), 2);
  assert.equal(L.survivalMinLen(20), 3);
  assert.equal(L.survivalMinLen(1000), 8);
});

test("chain combo: target climbs 95%->105%; fast clean words grow the multiplier, slow or dirty reset", async () => {
  const L = await load();
  near(L.chainTarget(100, 0), 95);
  near(L.chainTarget(100, 30000), 100);
  near(L.chainTarget(100, 90000), 105);
  let s = { mult: 1, streak: 0, best: 0, points: 0 };
  s = L.chainWord(s, { chars: 6, wpm: 150, clean: true }, 120);
  assert.deepEqual([s.mult, s.streak, s.points], [2, 1, 12]);
  s = L.chainWord(s, { chars: 4, wpm: 160, clean: true }, 120);
  assert.deepEqual([s.mult, s.streak, s.points, s.best], [3, 2, 24, 2]);
  s = L.chainWord(s, { chars: 5, wpm: 100, clean: true }, 120); // slow: x1, still scores
  assert.deepEqual([s.mult, s.streak, s.points, s.best], [1, 0, 29, 2]);
  s = L.chainWord(s, { chars: 5, wpm: 200, clean: false }, 120); // errored: nothing
  assert.deepEqual([s.mult, s.streak, s.points], [1, 0, 29]);
});
