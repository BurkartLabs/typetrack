import test from "node:test";
import assert from "node:assert/strict";
import {
  xpForResult,
  xpForGame,
  xpForLevel,
  levelFor,
  dayKey,
  streak,
  summarize,
  BADGES,
  earnedBadges,
  dailyGoals,
} from "../public/js/core/progress.js";

const DAY = 86400000;
const T0 = new Date(2026, 8, 1, 12).getTime(); // 1 Sep 2026, local noon

// A typing result as stored: Engine.results() fields that progress reads, plus ts.
const R = (wpm, acc, o = {}) =>
  Object.assign({ wpm, acc, duration: 30, mode: "time", target: 30, lang: "en", ts: T0, chars: { correct: Math.round(wpm * 5 * 0.5) } }, o);

test("xpForResult: scales with correct chars, pays for accuracy and PBs", () => {
  const base = R(150, 97); // 375 correct chars → 75 XP
  assert.equal(xpForResult(base), 75);
  assert.equal(xpForResult(R(150, 98)), 86); // × 1.15
  assert.equal(xpForResult(R(150, 100)), 98); // × 1.3
  assert.equal(xpForResult(R(150, 85)), 38); // × 0.5
  assert.equal(xpForResult(R(150, 100), { pb: true }), 141); // 97.5 + 25 + 25% of the 75 base
  assert.equal(xpForResult(R(150, 100, { pb: true })), 141);
  assert.ok(xpForResult(R(180, 100)) > xpForResult(R(150, 100)));
  assert.equal(xpForResult({ wpm: 120, acc: 100, duration: 60 }), 156); // no tally: wpm × minutes
  assert.equal(xpForResult(null), 0);
});

test("xpForGame: base, log-scaled score, win bonus", () => {
  assert.equal(xpForGame("sprint", 0), 10);
  assert.equal(xpForGame("sprint", 1), 14);
  assert.ok(xpForGame("sprint", 1000) > xpForGame("sprint", 100));
  assert.equal(xpForGame("sprint", 1e12), 50); // capped
  assert.equal(xpForGame("ghost-race", 10, { won: true }), xpForGame("ghost-race", 10) + 15);
  assert.equal(xpForGame("ghost-race", { score: 10, meta: { won: true } }), xpForGame("ghost-race", 10) + 15);
});

test("levelFor: smooth, monotonic, level 10 in about a week, 50 long-term", () => {
  assert.deepEqual(levelFor(0), { level: 1, into: 0, next: 75 });
  assert.deepEqual(levelFor(75), { level: 2, into: 0, next: 225 });
  assert.deepEqual(levelFor(100), { level: 2, into: 25, next: 225 });
  let prev = 1;
  for (let xp = 0; xp < 400000; xp += 37) {
    const l = levelFor(xp);
    assert.ok(l.level >= prev);
    assert.ok(l.into >= 0 && l.into < l.next);
    prev = l.level;
  }
  for (let L = 1; L < 80; L++) {
    assert.equal(levelFor(xpForLevel(L)).level, L);
    assert.equal(levelFor(xpForLevel(L) - 1).level, Math.max(1, L - 1));
  }
  // a week of ten 30 s tests a day at 150 wpm, 100%, plus 3 games a day
  const week = 7 * (10 * xpForResult(R(150, 100)) + 3 * xpForGame("sprint", 50));
  assert.ok(levelFor(week).level >= 9 && levelFor(week).level <= 11);
  assert.ok(xpForLevel(50) / week > 20); // level 50: five months or more of that
  assert.equal(levelFor(-5).level, 1);
});

test("streak: current (today or yesterday) and best", () => {
  assert.deepEqual(streak([]), { current: 0, best: 0 });
  const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05", "2026-09-06", "2026-09-06"];
  assert.deepEqual(streak(days, "2026-09-06"), { current: 2, best: 3 });
  assert.deepEqual(streak(days, "2026-09-07"), { current: 2, best: 3 }); // today not practised yet
  assert.deepEqual(streak(days, "2026-09-08"), { current: 0, best: 3 });
  // timestamps, across a month boundary
  const ts = [0, 1, 2, 3].map((i) => new Date(2026, 8, 29 + i, 9).getTime());
  assert.deepEqual(streak(ts, new Date(2026, 9, 2, 20)), { current: 4, best: 4 });
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("summarize builds the documented shape", () => {
  const rs = [
    R(130, 100, { ts: T0 }),
    R(155, 100, { ts: T0 + DAY }),
    R(170, 97, { ts: T0 + 2 * DAY, lang: "es" }),
    R(125, 100, { ts: T0 + 3 * DAY, duration: 200, mode: "time", target: 200 }),
  ];
  const games = { "ghost-race": [{ score: 5, ts: T0, meta: { won: true } }], sprint: [{ score: 3, ts: T0 + 5 * DAY }] };
  const s = summarize(rs, games, { games: ["ghost-race", "sprint"], today: T0 + 5 * DAY });
  assert.equal(s.tests, 4);
  assert.equal(s.bestWpm, 170);
  assert.equal(s.bestCleanWpm, 155);
  assert.equal(s.cleanStreak, 2);
  assert.equal(s.cleanStreakNow, 1);
  assert.equal(s.secondsTyped, 290);
  assert.equal(s.longestTest, 200);
  assert.equal(s.stamina, 200);
  assert.equal(s.languages, 2);
  assert.equal(s.days.length, 5);
  assert.deepEqual(s.streak, { current: 1, best: 4 });
  assert.deepEqual(s.gamesPlayed, { "ghost-race": 1, sprint: 1 });
  assert.equal(s.gamesDistinct, 2);
  assert.equal(s.allGames, true);
  assert.equal(s.ghostWins, 1);
  const xp = rs.reduce((a, r) => a + xpForResult(r), 0) + xpForGame("ghost-race", 5, { won: true }) + xpForGame("sprint", 3);
  assert.equal(s.xp, xp);
  assert.equal(s.level, levelFor(xp).level);
  // overrides and array-form game scores
  const t = summarize([], [{ game: "sprint", score: 1, ts: T0 }], { xp: 6075, ghostWins: 12, games: ["sprint", "duel"] });
  assert.equal(t.level, 10);
  assert.equal(t.ghostWins, 12);
  assert.equal(t.allGames, false);
  assert.equal(summarize().tests, 0);
});

test("BADGES: about 30, well formed, unique", () => {
  assert.ok(BADGES.length >= 28 && BADGES.length <= 34);
  const ids = new Set();
  for (const b of BADGES) {
    assert.ok(b.id && b.name && b.desc);
    assert.equal(Array.from(b.icon).length, 1, b.id + " icon is one glyph");
    assert.equal(typeof b.test, "function");
    assert.ok(!ids.has(b.id));
    ids.add(b.id);
  }
  assert.deepEqual(earnedBadges(summarize()), []); // nothing for nothing
});

test("badges fire on the right summaries", () => {
  const has = (s, id) => earnedBadges(s).includes(id);
  const at = (wpm, acc) => summarize([R(wpm, acc)]);
  assert.ok(has(at(100, 90), "wpm-100") && has(at(100, 90), "tests-1"));
  assert.ok(!has(at(99.9, 100), "wpm-100"));
  assert.deepEqual(
    ["wpm-120", "wpm-140", "wpm-160", "wpm-180", "wpm-200"].filter((id) => has(at(185, 96), id)),
    ["wpm-120", "wpm-140", "wpm-160", "wpm-180"]
  );
  assert.ok(has(at(200, 96), "wpm-200"));
  assert.ok(has(at(150, 100), "perfect-150") && !has(at(150, 99.9), "perfect-150"));
  assert.ok(has(at(181, 100), "perfect-180"));
  const clean = (n) => summarize(Array.from({ length: n }, (_, i) => R(140, 100, { ts: T0 + i })));
  assert.ok(has(clean(5), "clean-5") && !has(clean(4), "clean-5"));
  assert.ok(has(clean(10), "clean-10") && has(clean(25), "clean-25"));
  const broken = summarize([...Array.from({ length: 4 }, (_, i) => R(140, 100, { ts: T0 + i })), R(140, 99, { ts: T0 + 5 }), R(140, 100, { ts: T0 + 6 })]);
  assert.ok(!has(broken, "clean-5"));
  assert.ok(has(summarize([R(125, 100, { duration: 180 })]), "stamina"));
  assert.ok(!has(summarize([R(115, 100, { duration: 300 })]), "stamina"));
  const hours = (h) => summarize([R(140, 100, { duration: h * 3600 })]);
  assert.ok(has(hours(1), "marathon-1h") && has(hours(5), "marathon-5h") && has(hours(24), "marathon-24h"));
  assert.ok(!has(hours(0.99), "marathon-1h"));
  const daily = (n) => summarize(Array.from({ length: n }, (_, i) => R(140, 100, { ts: T0 + i * DAY })));
  assert.ok(has(daily(3), "streak-3") && !has(daily(2), "streak-3"));
  assert.ok(has(daily(7), "streak-7") && has(daily(30), "streak-30") && has(daily(100), "streak-100"));
  assert.ok(has(daily(100), "tests-100") && !has(daily(100), "tests-1000"));
  assert.ok(has(summarize(Array.from({ length: 1000 }, () => R(10, 90))), "tests-1000"));
  const g = summarize([], { sprint: [{ score: 1 }], "ghost-race": [{ score: 1, meta: { won: true } }] }, { games: ["sprint", "ghost-race"] });
  assert.ok(has(g, "game-first") && has(g, "games-all") && has(g, "ghost-1") && !has(g, "ghost-10"));
  assert.ok(has(summarize([], {}, { ghostWins: 10 }), "ghost-10"));
  const langs = (ls) => summarize(ls.map((l) => R(140, 100, { lang: l })));
  assert.ok(has(langs(["en", "fr"]), "lang-2") && !has(langs(["en", "en"]), "lang-2"));
  assert.ok(has(langs(["en", "fr", "de", "es", "pt"]), "lang-5"));
  const lvl = (L) => summarize([], {}, { xp: xpForLevel(L) });
  assert.ok(has(lvl(10), "level-10") && !has(lvl(9), "level-10"));
  assert.ok(has(lvl(25), "level-25") && has(lvl(50), "level-50") && !has(lvl(49), "level-50"));
});

test("dailyGoals: three distinct goals, seeded by date, with progress", () => {
  const day = "2026-09-10";
  const g1 = dailyGoals([], {}, day);
  assert.equal(g1.length, 3);
  assert.equal(new Set(g1.map((g) => g.id)).size, 3);
  assert.deepEqual(dailyGoals([], {}, day), g1); // same day, same goals
  const ids = new Set();
  for (let d = 1; d <= 30; d++) for (const g of dailyGoals([], {}, `2026-09-${String(d).padStart(2, "0")}`)) ids.add(g.id);
  assert.ok(ids.size >= 6); // they rotate
  for (const g of g1) assert.deepEqual([g.progress, g.done], [0, false]);

  // progress counts only that day; the speed target follows the recent average
  const noon = new Date(2026, 8, 10, 12).getTime();
  const past = Array.from({ length: 20 }, (_, i) => R(150, 100, { ts: noon - (i + 1) * DAY }));
  const todays = Array.from({ length: 12 }, (_, i) => R(160, 100, { ts: noon + i * 1000, duration: 60, chars: { correct: 800 } }));
  const games = { sprint: [{ score: 1, ts: noon }, { score: 2, ts: noon }, { score: 3, ts: noon }, { score: 4, ts: noon - DAY }] };
  const all = [];
  for (let d = 0; d < 40; d++) { // many dates, so every template shows up
    const key = dayKey(new Date(2026, 8, 10 + d));
    const shift = d * DAY;
    const rs = [...past, ...todays].map((r) => Object.assign({}, r, { ts: r.ts + shift }));
    const gs = { sprint: games.sprint.map((g) => Object.assign({}, g, { ts: g.ts + shift })) };
    for (const g of dailyGoals(rs, gs, key)) all.push(g);
  }
  const byId = Object.fromEntries(all.map((g) => [g.id, g]));
  assert.deepEqual(Object.keys(byId).sort(), ["chars", "clean", "clean-fast", "games", "minutes", "speed", "stamina", "tests"]);
  for (const g of all) assert.equal(g.done, true, g.id);
  assert.equal(byId.speed.title, "Hit 155 wpm");
  assert.equal(byId.speed.progress, 155); // clamped to target
  assert.equal(byId.games.progress, 3);
  assert.equal(byId["clean-fast"].title, "A 100% run at 150+ wpm");
});
