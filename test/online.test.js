"use strict";
// Online features: game score sync, weekly tournaments, leaderboard periods and "my rank".
// Starts the real server on port 0 with a temp DATA_DIR, like server.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("../public/js/engine.js");
const { start } = require("../server/index.js");
const weekly = require("../server/api/weekly.js");

const POOL = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "and", "runs",
  "far", "away", "from", "home", "into", "woods", "where", "tall", "trees", "grow"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-online-"));
const wordsDir = path.join(tmp, "words");
fs.mkdirSync(path.join(wordsDir, "en"), { recursive: true });
fs.writeFileSync(path.join(wordsDir, "en", "common-1k.json"), JSON.stringify(POOL));

let server;
let base;

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = start({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), wordsDir, rateLimit: { max: 1000 } });
    s.on("listening", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, p, body, cookie) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function signup(name) {
  const email = `${name.toLowerCase()}@example.com`;
  assert.equal((await call("POST", "/api/register", { name, email, password: "correct horse" })).status, 201);
  const res = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse" }),
  });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").split(";")[0];
}

// Type a test like a browser would. ordered: use `words` in order (the weekly challenge).
function play({ mode = "time", target = 60, msPerChar = 200, words = POOL, ordered = false, seed = 7 } = {}) {
  const s = E.createTest({ mode, duration: target, wordCount: target, words, ordered, seed });
  const log = [];
  let t = 0;
  const key = (k) => {
    E.tick(s, t);
    if (s.finishedAt !== null) return;
    log.push([t, k]);
    if (k === " ") E.space(s, t);
    else E.input(s, k, t);
    t += msPerChar;
  };
  while (s.finishedAt === null) {
    for (const ch of s.words[s.index]) key(ch);
    if (s.finishedAt === null) key(" ");
    if (mode === "time") E.tick(s, t);
  }
  return { ...E.results(s), lang: "en", words: s.words.slice(0, s.index + 1), log };
}

const now = Date.now();
const WEEK = weekly.isoWeek(now);
const LAST = weekly.prevWeek(WEEK);
const LIST = weekly.weeklyWords({ wordsDir }, WEEK);
const challengeRun = (msPerChar) => ({ ...play({ words: LIST, ordered: true, msPerChar }), challenge: "weekly:" + WEEK });

function insertResult({ userCookieName, userId, ts, wpm, challenge = null, ranked = 1, target = 60 }) {
  return Number(server.app.db
    .prepare(`INSERT INTO results (user_id, ts, lang, mode, target, wpm, raw, acc, duration, words_json, log_json, chars_json, ranked, challenge)
      VALUES (?, ?, 'en', 'time', ?, ?, ?, 100, ?, '["the"]', '[[0,"t"]]', '{}', ?, ?)`)
    .run(userId, ts, target, wpm, wpm, target, ranked, challenge).lastInsertRowid);
}
const userId = (name) => server.app.db.prepare("SELECT id FROM users WHERE name = ?").get(name).id;

test("iso weeks: known dates, week boundaries, 53-week years", () => {
  assert.equal(weekly.isoWeek(Date.UTC(2026, 8, 28)), "2026-W40"); // Monday 28 Sep 2026
  assert.equal(weekly.isoWeek(Date.UTC(2026, 9, 4, 23, 59)), "2026-W40"); // Sunday night
  assert.equal(weekly.isoWeek(Date.UTC(2021, 0, 1)), "2020-W53");
  assert.equal(weekly.isoWeek(Date.UTC(2024, 11, 30)), "2025-W01");
  assert.equal(weekly.weekStart("2026-W40"), Date.UTC(2026, 8, 28));
  assert.equal(weekly.prevWeek("2026-W01"), "2025-W52");
  assert.notEqual(weekly.seedOf("2026-W40"), weekly.seedOf("2026-W41"));
});

test("weekly words are the same for everybody and differ between weeks", () => {
  assert.equal(LIST.length, weekly.CHALLENGE.words);
  assert.deepEqual(weekly.weeklyWords({ wordsDir }, WEEK), LIST);
  assert.notDeepEqual(weekly.weeklyWords({ wordsDir }, LAST), LIST);
  for (let i = 1; i < LIST.length; i++) assert.notEqual(LIST[i], LIST[i - 1], "no immediate repeats");
});

test("game score sync: posted scores reach the game board", async () => {
  const a = await signup("syncer");
  const b = await signup("syncer2");
  assert.equal((await call("POST", "/api/games/word-rain/score", { score: 1200, meta: { level: 4 } }, a)).status, 201);
  assert.equal((await call("POST", "/api/games/word-rain/score", { score: 900 }, b)).status, 201);
  assert.equal((await call("POST", "/api/games/reaction/score", { score: 240 }, a)).status, 201);
  assert.equal((await call("POST", "/api/games/reaction/score", { score: 310 }, b)).status, 201);
  const lb = await call("GET", "/api/games/word-rain/leaderboard?period=day");
  assert.deepEqual(lb.json.map((r) => [r.rank, r.name, r.score]), [[1, "syncer", 1200], [2, "syncer2", 900]]);
  assert.deepEqual(lb.json[0].meta, { level: 4 });
  const asc = await call("GET", "/api/games/reaction/leaderboard?order=asc");
  assert.deepEqual(asc.json.map((r) => r.name), ["syncer", "syncer2"]);
});

test("weekly: GET gives this week's words, window and empty standings", async () => {
  const r = await call("GET", "/api/weekly");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.week, WEEK);
  assert.equal(r.json.challenge, "weekly:" + WEEK);
  assert.deepEqual(r.json.words, LIST);
  assert.equal(r.json.ends - r.json.starts, 7 * 24 * 3600 * 1000);
  assert.ok(r.json.now >= r.json.starts && r.json.now < r.json.ends);
  assert.equal(r.json.me, null);
  const past = await call("GET", `/api/weekly?week=${LAST}`);
  assert.equal(past.status, 200);
  assert.equal(past.json.words, null, "past weeks do not need words");
  assert.equal((await call("GET", "/api/weekly?week=2999-W01")).status, 400);
  assert.equal((await call("GET", "/api/weekly?week=2026-W60")).status, 400);
  assert.equal((await call("GET", "/api/weekly?week=nope")).status, 400);
});

test("weekly: a genuine run is accepted; wrong words, wrong mode, closed weeks are rejected", async () => {
  const cookie = await signup("weekler");
  const ok = await call("POST", "/api/results", challengeRun(200), cookie);
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.challenge, "weekly:" + WEEK);
  assert.equal(ok.json.ranked, false, "challenge runs stay off the standard boards");

  // Same pool, random words: a genuine test, but not this week's.
  const random = { ...play({ msPerChar: 200 }), challenge: "weekly:" + WEEK };
  const bad = await call("POST", "/api/results", random, cookie);
  assert.equal(bad.status, 422);
  assert.match(bad.json.error, /words/);
  // Last week's words, or claiming last week, or a 30 s test.
  const lastWords = { ...play({ words: weekly.weeklyWords({ wordsDir }, LAST), ordered: true }), challenge: "weekly:" + WEEK };
  assert.equal((await call("POST", "/api/results", lastWords, cookie)).status, 422);
  assert.equal((await call("POST", "/api/results", { ...challengeRun(200), challenge: "weekly:" + LAST }, cookie)).status, 422);
  const short = { ...play({ words: LIST, ordered: true, target: 30 }), challenge: "weekly:" + WEEK };
  assert.equal((await call("POST", "/api/results", short, cookie)).status, 422);
  assert.equal((await call("POST", "/api/results", { ...challengeRun(200), challenge: "daily:x" }, cookie)).status, 422);
  // Tampered numbers are still caught by the log check.
  const cheat = challengeRun(200);
  assert.equal((await call("POST", "/api/results", { ...cheat, wpm: cheat.wpm + 30 }, cookie)).status, 422);
  // Needs a session.
  assert.equal((await call("POST", "/api/results", challengeRun(200))).status, 401);

  const std = await call("GET", "/api/leaderboard?mode=time&target=60");
  assert.ok(!std.json.some((row) => row.name === "weekler"));
});

test("weekly standings: best per user, ordered, attempts counted, me", async () => {
  const fast = await signup("wfast");
  const slow = await signup("wslow");
  for (const [c, ms] of [[slow, 180], [fast, 150], [fast, 120], [slow, 170], [fast, 190]]) {
    const r = await call("POST", "/api/results", challengeRun(ms), c);
    assert.equal(r.status, 201, r.text);
  }
  const s = await call("GET", "/api/weekly", undefined, slow);
  const names = s.json.standings.map((r) => r.name);
  assert.deepEqual(names.slice(0, 2), ["wfast", "wslow"]);
  const top = s.json.standings[0];
  assert.equal(top.attempts, 3);
  assert.equal(top.rank, 1);
  assert.equal(top.wpm, play({ words: LIST, ordered: true, msPerChar: 120 }).wpm);
  assert.ok(!("userId" in top));
  for (let i = 1; i < s.json.standings.length; i++) assert.ok(s.json.standings[i - 1].wpm >= s.json.standings[i].wpm);
  assert.equal(s.json.me.rank, 2);
  assert.equal(s.json.me.attempts, 2);
  const ghost = await call("GET", `/api/ghosts/${top.resultId}`);
  assert.equal(ghost.status, 200);
  assert.deepEqual(ghost.json.words, LIST.slice(0, ghost.json.words.length));
});

test("weekly winners: last week's top 3; the current week is refused", async () => {
  const ids = ["w1", "w2", "w3", "w4"];
  for (const n of ids) await signup(n);
  const lastStart = weekly.weekStart(LAST);
  [[ "w1", 90], ["w2", 120], ["w3", 60], ["w4", 100], ["w1", 130]].forEach(([n, wpm], i) =>
    insertResult({ userId: userId(n), ts: lastStart + 3600 * 1000 * (i + 1), wpm, challenge: "weekly:" + LAST, ranked: 0 }));
  const w = await call("GET", "/api/weekly/winners");
  assert.equal(w.status, 200, w.text);
  assert.equal(w.json.week, LAST);
  assert.deepEqual(w.json.winners.map((r) => [r.rank, r.name, r.wpm]), [[1, "w1", 130], [2, "w2", 120], [3, "w4", 100]]);
  assert.equal((await call("GET", `/api/weekly/winners?week=${LAST}`)).json.winners.length, 3);
  assert.equal((await call("GET", `/api/weekly/winners?week=${WEEK}`)).status, 400);
  const past = await call("GET", `/api/weekly?week=${LAST}`);
  assert.equal(past.json.players, 4);
});

test("leaderboard periods: day, week and all; my rank outside the table", async () => {
  const cookie = await signup("periodic");
  const id = userId("periodic");
  const other = await signup("periodic2");
  const t = Date.now();
  insertResult({ userId: id, ts: t - 10 * 24 * 3600 * 1000, wpm: 200, target: 120 }); // all time only
  insertResult({ userId: id, ts: t - 3 * 24 * 3600 * 1000, wpm: 150, target: 120 }); // this week
  insertResult({ userId: userId("periodic2"), ts: t - 3600 * 1000, wpm: 100, target: 120 }); // today
  insertResult({ userId: userId("periodic2"), ts: t - 3600 * 1000, wpm: 300, target: 120, ranked: 0 }); // unranked
  const board = async (period) =>
    (await call("GET", `/api/leaderboard?mode=time&target=120&period=${period}`)).json.map((r) => [r.name, r.wpm]);
  assert.deepEqual(await board("all"), [["periodic", 200], ["periodic2", 100]]);
  assert.deepEqual(await board("week"), [["periodic", 150], ["periodic2", 100]]);
  assert.deepEqual(await board("day"), [["periodic2", 100]]);

  const me = (period, c) => call("GET", `/api/leaderboard/me?mode=time&target=120&period=${period}`, undefined, c);
  assert.deepEqual((await me("all", cookie)).json.rank, 1);
  assert.equal((await me("all", cookie)).json.wpm, 200);
  assert.equal((await me("day", cookie)).json.rank, null);
  assert.equal((await me("day", other)).json.rank, 1);
  assert.equal((await me("all", other)).json.rank, 2);
  assert.equal((await call("GET", "/api/leaderboard/me?mode=time&target=120")).status, 401);
});
