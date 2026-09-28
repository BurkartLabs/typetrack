"use strict";
// Weekly tournaments: one fixed challenge per ISO week (UTC). Everybody types the same seeded words: a 60 s
// time test on en/common-1k, the words drawn by the engine's mulberry32 seeded with a hash of the week
// string. Unlimited attempts, best counts.
//   GET /api/weekly?week=2026-W40          -> {week, challenge, mode, target, lang, starts, ends, now,
//                                              words (current week only), standings, me}
//   GET /api/weekly/winners?week=2026-W39  -> {week, winners: top 3}   (default: last week)
// POST /api/results with `challenge: "weekly:<week>"` is checked by checkChallenge() below.
const fs = require("node:fs");
const path = require("node:path");
const { HttpError, send } = require("../http.js");
const { currentUser } = require("../auth.js");
const { Engine } = require("../validate.js");

const DAY = 24 * 3600 * 1000;
const WEEK = 7 * DAY;
const CHALLENGE = { mode: "time", target: 60, lang: "en", list: "common-1k", words: 400 };
const GRACE_MS = 10 * 60 * 1000; // a run started just before the week ended may land just after
const STANDINGS_LIMIT = 100;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

// Monday 00:00 UTC of ISO week 1 of `year`.
function week1Monday(year) {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
}

function isoWeek(ts) {
  const d = new Date(ts);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow + 3);
  const year = new Date(thursday).getUTCFullYear();
  const w = Math.floor((thursday - week1Monday(year)) / WEEK) + 1;
  return `${year}-W${String(w).padStart(2, "0")}`;
}

function weekStart(week) {
  const m = WEEK_RE.exec(week);
  return week1Monday(Number(m[1])) + (Number(m[2]) - 1) * WEEK;
}

// A valid week string (2026-W53 only when that year has one), or throws 400.
function parseWeek(s) {
  if (typeof s !== "string" || !WEEK_RE.test(s)) throw new HttpError(400, "week must look like 2026-W40");
  const n = Number(s.slice(6));
  if (n < 1 || isoWeek(weekStart(s)) !== s) throw new HttpError(400, "no such week");
  return s;
}

function prevWeek(week) {
  return isoWeek(weekStart(week) - DAY);
}

// FNV-1a, 32 bit.
function seedOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const poolCache = new Map(); // wordsDir -> {list, checked}
function pool(app) {
  const hit = poolCache.get(app.wordsDir);
  if (hit && (hit.list || Date.now() - hit.checked < 60000)) return hit.list;
  let list = null;
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(app.wordsDir, CHALLENGE.lang, CHALLENGE.list + ".json"), "utf8"));
    if (Array.isArray(arr) && arr.length > 1 && arr.every((w) => typeof w === "string" && w && !/\s/.test(w))) list = arr;
  } catch {
    /* missing: the challenge is unavailable */
  }
  poolCache.set(app.wordsDir, { list, checked: Date.now() });
  return list;
}

// The week's word list, regenerated with the engine (same picks, same no-immediate-repeat rule).
function weeklyWords(app, week) {
  const p = pool(app);
  if (!p) throw new HttpError(503, "weekly challenge unavailable (word list missing)");
  const s = Engine.createTest({ mode: "words", wordCount: CHALLENGE.words, words: p, rand: Engine.mulberry32(seedOf(week)) });
  return s.words.slice(0, CHALLENGE.words);
}

// For POST /api/results: returns the challenge id to store, or throws 422. `v` is the verified result.
function checkChallenge(app, challenge, v, now = Date.now()) {
  if (typeof challenge !== "string" || !challenge.startsWith("weekly:")) throw new HttpError(422, "unknown challenge");
  let week;
  try {
    week = parseWeek(challenge.slice(7));
  } catch {
    throw new HttpError(422, "unknown challenge");
  }
  const current = isoWeek(now);
  const inGrace = week === prevWeek(current) && now - weekStart(current) < GRACE_MS;
  if (week !== current && !inGrace) throw new HttpError(422, "that week's challenge is closed");
  if (v.mode !== CHALLENGE.mode || v.target !== CHALLENGE.target || v.lang !== CHALLENGE.lang) {
    throw new HttpError(422, "challenge is a 60 second english time test");
  }
  const list = weeklyWords(app, week);
  if (v.words.length > list.length || !v.words.every((w, i) => w === list[i])) {
    throw new HttpError(422, "words do not match this week's challenge");
  }
  return "weekly:" + week;
}

const BEST_SQL = `
  SELECT r.id, r.user_id, u.name, r.wpm, r.acc, r.ts,
    ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.wpm DESC, r.acc DESC, r.ts ASC) AS rn,
    COUNT(*) OVER (PARTITION BY r.user_id) AS attempts
  FROM results r JOIN users u ON u.id = r.user_id WHERE r.challenge = ?`;

function board(app, challenge, limit) {
  return app.db
    .prepare(`SELECT * FROM (${BEST_SQL}) WHERE rn = 1 ORDER BY wpm DESC, acc DESC, ts ASC LIMIT ${limit}`)
    .all(challenge)
    .map((r, i) => ({ rank: i + 1, name: r.name, wpm: r.wpm, acc: r.acc, ts: r.ts, resultId: r.id, attempts: r.attempts, userId: r.user_id }));
}

function strip({ userId, ...row }) {
  return row;
}

function standings(app, req, res, params, q) {
  const now = Date.now();
  const current = isoWeek(now);
  const week = q.get("week") ? parseWeek(q.get("week")) : current;
  if (weekStart(week) > weekStart(current)) throw new HttpError(400, "that week has not started");
  const challenge = "weekly:" + week;
  const all = board(app, challenge, 100000);
  const user = currentUser(app, req);
  let me = null;
  if (user) {
    const mine = all.find((r) => r.userId === user.id);
    me = mine ? { rank: mine.rank, wpm: mine.wpm, acc: mine.acc, attempts: mine.attempts, resultId: mine.resultId } : { rank: null, attempts: 0 };
  }
  send(res, 200, {
    week,
    challenge,
    mode: CHALLENGE.mode,
    target: CHALLENGE.target,
    lang: CHALLENGE.lang,
    list: CHALLENGE.list,
    starts: weekStart(week),
    ends: weekStart(week) + WEEK,
    now,
    current: week === current,
    words: week === current ? weeklyWords(app, week) : null,
    players: all.length,
    standings: all.slice(0, STANDINGS_LIMIT).map(strip),
    me,
  });
}

function winners(app, req, res, params, q) {
  const current = isoWeek(Date.now());
  const week = q.get("week") ? parseWeek(q.get("week")) : prevWeek(current);
  if (weekStart(week) >= weekStart(current)) throw new HttpError(400, "that week is not over");
  send(res, 200, { week, winners: board(app, "weekly:" + week, 3).map(strip) });
}

module.exports = { standings, winners, checkChallenge, weeklyWords, isoWeek, weekStart, prevWeek, seedOf, CHALLENGE };
