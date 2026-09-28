// Pure logic of the pack3 games (public/js/views/games/pack3-kit.js and the game modules).
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.Engine = require("../public/js/engine.js");
const E = globalThis.Engine;
const kit = () => import("../public/js/views/games/pack3-kit.js");
const game = (id) => import(`../public/js/views/games/${id}.js`);

// Type `words` at a steady `msPerKey`, returning a log.
function steadyLog(words, msPerKey) {
  const log = [];
  let t = 0;
  words.forEach((w, i) => {
    for (const ch of w) { log.push([t, ch]); t += msPerKey; }
    if (i < words.length - 1) { log.push([t, " "]); t += msPerKey; }
  });
  return log;
}

test("kit: dates and seeds are stable", async () => {
  const k = await kit();
  assert.equal(k.utcDateKey(Date.UTC(2026, 8, 28, 23, 59)), "2026-09-28");
  assert.equal(k.addDays("2026-09-28", 3), "2026-10-01");
  assert.equal(k.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(k.hashString("2026-09-28"), k.hashString("2026-09-28"));
  assert.notEqual(k.hashString("2026-09-28"), k.hashString("2026-09-29"));
  const a = k.seededRand("x"), b = k.seededRand("x");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const picks = k.pickN(["a", "b"], 20, k.seededRand("y"));
  assert.equal(picks.length, 20);
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1]);
});

test("kit: charPos and placeAt are inverses", async () => {
  const k = await kit();
  const words = ["the", "quick", "fox"];
  assert.equal(k.charPos(words, 0, 0), 0);
  assert.equal(k.charPos(words, 1, 2), 6);
  assert.deepEqual(k.placeAt(words, 6), { index: 1, typed: 2 });
  assert.deepEqual(k.placeAt(words, 3), { index: 0, typed: 3 });
  assert.deepEqual(k.placeAt(words, 99), { index: 2, typed: 3 });
});

test("kit: ghost gap in characters and ms", async () => {
  const k = await kit();
  const words = ["abc", "def", "ghi"];
  const s = k.progressSeries(words, steadyLog(words, 100));
  assert.equal(s.final, k.charPos(words, 2, 3)); // 11
  assert.equal(k.posAt(s, 0), 1);
  assert.equal(k.posAt(s, 450), 5);
  assert.equal(k.timeToReach(s, 5), 400);
  assert.equal(k.timeToReach(s, 50), null);
  // at 450 ms the ghost is at 5; I am at 7 -> +2 ch, and the ghost reached 7 at 600 -> I lead by 150 ms
  assert.deepEqual(k.ghostGap(s, 7, 450), { chars: 2, ms: 150 });
  // I am at 3 -> behind by 2 ch; ghost got to 3 at 200 ms -> 250 ms behind
  assert.deepEqual(k.ghostGap(s, 3, 450), { chars: -2, ms: -250 });
});

test("kit: series follows backspaces", async () => {
  const k = await kit();
  const s = k.progressSeries(["ab", "cd"], [[0, "a"], [100, "x"], [200, "\b"], [300, "b"], [400, " "], [500, "c"]]);
  assert.deepEqual(s.pos, [1, 2, 1, 2, 3, 4]);
  assert.deepEqual(s.max, [1, 2, 2, 2, 3, 4]);
  assert.equal(k.timeToReach(s, 2), 100);
});

test("kit: league placing and pb progression", async () => {
  const k = await kit();
  assert.deepEqual(k.leaguePlacing(150, [140, 160, 150, 120]), { place: 2, of: 5, beaten: 2 });
  assert.deepEqual(k.leaguePlacing(200, []), { place: 1, of: 1, beaten: 0 });
  const r = (ts, wpm, log = true) => ({ ts, wpm, acc: 100, mode: "time", target: 30, lang: "en", words: ["a"], log: log ? [[0, "a"]] : undefined });
  const res = [r(1, 100), r(2, 90), r(3, 120, false), r(4, 110), r(5, 130)];
  assert.deepEqual(k.pbProgression(res, "time:30:en").map((x) => x.ts), [1, 5]); // 120 raised the bar but has no log
});

test("ghost-race: pb pick, sources, won and gap text", async () => {
  const g = await game("ghost-race");
  const mk = (ts, wpm, target = 30, lang = "en", log = true) => ({ ts, wpm, acc: 99, mode: "time", target, lang, words: ["a"], log: log ? [[0, "a"]] : null });
  const res = [mk(1, 150), mk(2, 170, 30, "en", false), mk(3, 160), mk(4, 180, 60), mk(5, 190, 30, "de")];
  assert.equal(g.pickPB(res, { mode: "time", target: 30, lang: "en" }).ts, 3);
  assert.equal(g.pickPB(res, { mode: "words", target: 30, lang: "en" }), null);
  assert.deepEqual(g.personalBests(res).map((r) => r.ts).sort(), [3, 4, 5]);
  assert.deepEqual(g.recentGhosts(res, 2).map((r) => r.ts), [5, 4]);
  assert.equal(g.raceWon(151, 150), true);
  assert.equal(g.raceWon(150, 150), false);
  assert.deepEqual(g.gapText({ chars: 12, ms: -340 }), { ch: "+12 ch", ms: "−0.34 s" });
  assert.equal(g.gapText({ chars: 3, ms: null }).ms, "past the ghost's last key");
});

test("ghost-league: ghosts, modes and standings", async () => {
  const g = await game("ghost-league");
  const mk = (ts, wpm, target = 30) => ({ ts, wpm, acc: 100, mode: "time", target, lang: "en", words: ["a"], log: [[0, "a"]] });
  const res = [];
  for (let i = 0; i < 14; i++) res.push(mk(i, 100 + i)); // every run is a new pb
  res.push(mk(20, 50, 60));
  assert.equal(g.leagueGhosts(res, "time:30:en", "pb").length, 10);
  assert.equal(g.leagueGhosts(res, "time:30:en", "pb")[0].ts, 4);
  assert.deepEqual(g.leagueGhosts(res, "time:30:en", "top", 3).map((r) => r.wpm), [113, 112, 111]);
  assert.deepEqual(g.leagueModes(res), [{ key: "time:30:en", n: 14 }, { key: "time:60:en", n: 1 }]);
  const st = g.standings(120, [{ label: "a", wpm: 130 }, { label: "b", wpm: 110 }]);
  assert.deepEqual(st.map((x) => x.name), ["a", "you", "b"]);
});

test("tower-climb: floors get harder and faster; text is seeded", async () => {
  const t = await game("tower-climb");
  const f1 = t.floorSpec(1, 150);
  assert.deepEqual(f1, { floor: 1, kind: "common", count: 15, pct: 0.6, req: 90 });
  assert.equal(t.floorSpec(2, 150).kind, "long");
  assert.equal(t.floorSpec(3, 150).kind, "rare");
  assert.equal(t.floorSpec(6, 150).kind, "code");
  assert.equal(t.floorSpec(7, 150).kind, "rare punctuation");
  for (let n = 1; n < 30; n++) assert.ok(t.floorSpec(n + 1, 150).req >= t.floorSpec(n, 150).req);
  assert.equal(t.floorSpec(1, 0).req, 48); // no history: assumed 80 wpm
  assert.equal(t.floorPassed(90, 90), true);
  assert.equal(t.floorPassed(89.9, 90), false);
  const pools = { common: ["alpha", "beta", "gamma", "delta", "echo", "fox"], rare: ["zephyr", "syzygy"], code: ["const a = [1, 2];"] };
  const a = t.floorText(t.floorSpec(4, 150), pools, E.mulberry32(5));
  const b = t.floorText(t.floorSpec(4, 150), pools, E.mulberry32(5));
  assert.equal(a, b);
  assert.match(a, /^[A-Z"(]/);
  assert.match(a, /\.$/);
  const nums = t.floorText(t.floorSpec(5, 150), pools, E.mulberry32(1)).split(" ");
  assert.equal(nums.length, t.floorSpec(5, 150).count);
  assert.match(nums[1], /\d/);
  assert.ok(t.floorText(t.floorSpec(6, 150), pools, E.mulberry32(1)).includes("[1,"));
  assert.equal(t.floorText(t.floorSpec(1, 150), pools, E.mulberry32(1)).split(" ").length, 15);
});
