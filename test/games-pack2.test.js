// Pure rules of the pack-2 canvas games (falling words, typing racer, laser defense, boss fight, stacking).
const test = require("node:test");
const assert = require("node:assert/strict");

const game = (id) => import("../public/js/views/games/" + id + ".js");
const lib = () => import("../public/js/views/games/lib/canvas.js");

// ── shared helpers ──────────────────────────────────────────────────────
test("canvas lib: colours parse and mix, accents match leniently, best respects order", async () => {
  const L = await lib();
  assert.deepEqual(L.parseColor("#b3202e"), [179, 32, 46]);
  assert.deepEqual(L.parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(L.parseColor("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.equal(L.alpha("#161618", 0.5), "rgba(22,22,24,0.5)");
  assert.equal(L.mix("#000000", "#ffffff", 0.5), "rgb(128,128,128)");
  assert.ok(L.prefixMatches("café", "cafe", true));
  assert.ok(!L.prefixMatches("café", "cafe", false));
  assert.ok(!L.prefixMatches("ab", "abc", true));
  assert.equal(L.bestOf([{ score: 5 }, { score: 9 }, { score: 2 }], "desc"), 9);
  assert.equal(L.bestOf([{ score: 5 }, { score: 9 }, { score: 2 }], "asc"), 2);
  assert.equal(L.bestOf([], "asc"), null);
  assert.deepEqual(L.cleanWords(["a", "ok", "ok", "two words", " fine ", 3]), ["ok", "fine"]);
  assert.equal(Math.round(L.wpmOf(500, 60000)), 100);
});

// ── falling words ───────────────────────────────────────────────────────
test("falling words: spawn rate rises forever, fall time shrinks to a floor", async () => {
  const { fwSpawnRate, fwFallTime } = await game("falling-words");
  for (let t = 0; t < 400; t += 10) {
    assert.ok(fwSpawnRate(t + 10) > fwSpawnRate(t));
    assert.ok(fwFallTime(t + 10) <= fwFallTime(t));
  }
  assert.equal(fwFallTime(1000), 2.4);
});

test("falling words: typing targets the lowest matching word", async () => {
  const { fwTarget } = await game("falling-words");
  const list = [{ text: "then", y: 50 }, { text: "there", y: 200 }, { text: "other", y: 300 }, { text: "them", y: 250, dead: 0.1 }];
  assert.equal(fwTarget(list, "th", false), 1); // "them" is lower but already dead
  assert.equal(fwTarget(list, "o", false), 2);
  assert.equal(fwTarget(list, "x", false), -1);
});

// A model, not a player: a typist clears words lowest-first at a steady wpm with a small targeting cost
// per word. It measures the difficulty curve, nothing about real players.
function survive(mod, wpm, rand) {
  const { fwSpawnRate, fwFallTime, fwPickWord } = mod;
  const pool = "the of and to in is that for it was with be on not this are from at which have had they you were one all can her has there been more when will would who".split(" ");
  const cps = (wpm * 5) / 60;
  const queue = []; // landing times
  let t = 0, acc = 0.6, busy = 0, lives = 3;
  const dt = 0.02;
  while (t < 600) {
    acc += fwSpawnRate(t) * dt;
    while (acc >= 1) { acc--; const w = fwPickWord(pool, t, rand); queue.push({ land: t + fwFallTime(t), cost: (w.length + 1.5) / cps }); }
    queue.sort((a, b) => a.land - b.land);
    busy -= dt;
    while (busy <= 0 && queue.length) { busy += queue.shift().cost; }
    while (queue.length && queue[0].land <= t) { queue.shift(); if (--lives <= 0) return t; }
    t += dt;
  }
  return t;
}

test("falling words: a 150 wpm model survives about 1-2 minutes, faster lasts longer", async () => {
  const mod = await game("falling-words");
  const { rng } = await lib();
  const s100 = survive(mod, 100, rng(1)), s150 = survive(mod, 150, rng(1)), s200 = survive(mod, 200, rng(1));
  assert.ok(s150 >= 60 && s150 <= 130, "150 wpm model survived " + s150.toFixed(0) + "s");
  assert.ok(s100 < s150 && s150 < s200, `${s100.toFixed(0)} < ${s150.toFixed(0)} < ${s200.toFixed(0)}`);
});
