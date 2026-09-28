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

// ── typing racer ────────────────────────────────────────────────────────
test("typing racer: PB comes from word-list tests only; opponents are PB+10, PB, PB-10", async () => {
  const { racerPB, racerOpponents } = await game("typing-racer");
  assert.equal(racerPB([]), null);
  assert.equal(racerPB([{ mode: "time", wpm: 142.3 }, { mode: "words", wpm: 150 }, { mode: "text", wpm: 190 }, { mode: "time", wpm: 170, source: "quotes" }]), 150);
  assert.deepEqual(racerOpponents(null).map((o) => o.wpm), [110, 100, 90]);
  assert.deepEqual(racerOpponents(151.6).map((o) => o.wpm), [162, 152, 142]);
});

test("typing racer: progress counts correct words plus the correct prefix; places and times", async () => {
  const { racerDone, racerTotal, racerTime, racerPlace } = await game("typing-racer");
  const words = ["the", "cat", "sat"];
  assert.equal(racerTotal(words), 11);
  assert.equal(racerDone(words, ["the", "cat", "s"], 2), 9);
  assert.equal(racerDone(words, ["the", "cbt", "sa"], 2), 6); // a wrong word earns nothing
  assert.equal(racerDone(words, ["thx"], 0), 2);
  assert.equal(racerTime(500, 100), 60);
  assert.equal(racerPlace(30, [29, 31, 40]), 2);
  assert.equal(racerPlace(30, [30, 31, 40]), 1);
});

// ── laser defense ───────────────────────────────────────────────────────
test("laser defense: waves grow, drones get faster to a floor, elites are faster and arrive later", async () => {
  const { ldWave, ldQueue, ldDemandWpm } = await game("laser-defense");
  const { rng } = await lib();
  for (let n = 1; n < 30; n++) {
    const a = ldWave(n), b = ldWave(n + 1);
    assert.ok(b.count > a.count && b.elites >= a.elites && b.travel <= a.travel && b.gap <= a.gap);
    assert.ok(a.eliteTravel < a.travel && a.elites <= a.count / 2);
  }
  assert.equal(ldWave(1).elites, 0);
  assert.equal(ldWave(40).travel, 3.8);
  assert.equal(ldWave(40).gap, 0.4);
  const q = ldQueue(6, rng(3));
  assert.equal(q.length, ldWave(6).count);
  assert.equal(q.filter(Boolean).length, ldWave(6).elites);
  assert.ok(q.slice(0, Math.floor(q.length / 3)).every((e) => !e), "no elites in the first third");
  // the demand curve (a model, not players): wave 1 is a warm-up, wave 10 asks for more than 150 wpm
  assert.ok(ldDemandWpm(1) < 80, "wave 1 " + ldDemandWpm(1).toFixed(0));
  assert.ok(ldDemandWpm(10) > 150, "wave 10 " + ldDemandWpm(10).toFixed(0));
});

test("laser defense: wave bonus doubles for a clean wave; lock-on picks the drone nearest the base", async () => {
  const { ldWaveBonus, ldTarget } = await game("laser-defense");
  assert.equal(ldWaveBonus(3, 1), 15);
  assert.equal(ldWaveBonus(3, 0), 30);
  const list = [{ text: "stone", y: 40 }, { text: "state", y: 120 }, { text: "steam", y: 300, dead: 0.1 }, { text: "apple", y: 200 }];
  assert.equal(ldTarget(list, "st", true), 1);
  assert.equal(ldTarget(list, "sto", true), 0);
  assert.equal(ldTarget(list, "q", true), -1);
});

// ── boss fight ──────────────────────────────────────────────────────────
test("boss fight: damage scales with live wpm, clamped; 150 wpm fells it in about a minute", async () => {
  const { bossDamage, bossLiveWpm, BOSS_HP } = await game("boss-fight");
  assert.equal(bossDamage("hello", 100), 6);
  assert.equal(bossDamage("hello", 200), 12);
  assert.equal(bossDamage("hello", 10), 2.4); // floor 0.4x
  assert.equal(bossDamage("hello", 900), 15); // ceiling 2.5x
  // 60 correct keys in the last 4 s = 12 words in 4 s = 180 wpm; older keys do not count
  const times = [0.1, 0.2].concat(Array.from({ length: 60 }, (_, i) => 6.01 + i * (3.9 / 60)));
  assert.equal(Math.round(bossLiveWpm(times, 10)), 180);
  assert.equal(Math.round(bossLiveWpm([0.5], 0.5)), 12); // span is at least a second
  // a model: steady wpm w on 5-letter words deals w*w/1200 hp per second
  const secs = (w) => BOSS_HP / (((w * 5) / 60 / 6) * bossDamage("xxxxx", w));
  assert.ok(secs(150) > 45 && secs(150) < 65, "150 wpm: " + secs(150).toFixed(0) + "s");
  assert.ok(secs(200) < secs(150) && secs(150) < secs(100));
});

test("boss fight: idle heal after 1.5 s, heal never climbs back over a phase line, phases at 66/33", async () => {
  const { bossHealRate, bossHeal, bossPhase, BOSS_HP } = await game("boss-fight");
  assert.equal(bossHealRate(1.4), 0);
  assert.ok(bossHealRate(1.6) > 0);
  assert.equal(bossPhase(1), 0); assert.equal(bossPhase(0.67), 0); assert.equal(bossPhase(0.66), 1);
  assert.equal(bossPhase(0.34), 1); assert.equal(bossPhase(0.33), 2); assert.equal(bossPhase(0), 2);
  assert.equal(bossHeal(900, 50, 0), 950);
  assert.equal(bossHeal(990, 50, 0), BOSS_HP);
  assert.equal(bossHeal(650, 50, 1), 660);
  assert.equal(bossHeal(300, 10, 2), 310);
  assert.equal(bossHeal(329, 10, 2), 330);
});

test("boss fight: phase text is common, then long, then punctuated with the letters kept", async () => {
  const { bossWord, bossPunctuate } = await game("boss-fight");
  const { rng } = await lib();
  const common = ["the", "and", "people", "between", "government", "for"];
  const rare = ["quixotic", "syzygy", "chrysanthemums"];
  const r = rng(7);
  for (let i = 0; i < 50; i++) {
    assert.ok(common.includes(bossWord(0, common, rare, r)));
    const w1 = bossWord(1, common, rare, r);
    assert.ok(w1.length >= 6 && w1 !== "chrysanthemums", w1);
    const w2 = bossWord(2, common, rare, r);
    assert.ok(/[^a-z]/.test(w2), w2);
    assert.ok(common.some((c) => w2.toLowerCase().includes(c)), w2);
  }
  assert.ok(bossPunctuate("word", () => 0).length > 4);
});
