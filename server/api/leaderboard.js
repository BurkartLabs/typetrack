"use strict";
// GET /api/leaderboard?mode=time&target=30&lang=en&period=all|week|day -> top 50, best result per user.
const { HttpError, send } = require("../http.js");

const PERIODS = { all: 0, week: 7 * 24 * 3600 * 1000, day: 24 * 3600 * 1000 };
const LIMIT = 50;

function since(period) {
  const p = period || "all";
  if (!Object.hasOwn(PERIODS, p)) throw new HttpError(400, "period must be all, week or day");
  return PERIODS[p] ? Date.now() - PERIODS[p] : 0;
}

function filters(q) {
  const mode = q.get("mode") || "time";
  if (mode !== "time" && mode !== "words") throw new HttpError(400, "mode must be time or words");
  const target = Number(q.get("target") || (mode === "time" ? 30 : 50));
  if (!Number.isInteger(target) || target < 1) throw new HttpError(400, "invalid target");
  const lang = q.get("lang") || "en";
  if (!/^[a-z]{2,3}(-[a-z0-9]{1,8})?$/.test(lang)) throw new HttpError(400, "invalid lang");
  return { mode, target, lang, from: since(q.get("period")) };
}

// Best ranked result per user: highest wpm, then accuracy, then the earliest.
const BEST_SQL = `
  SELECT r.id, r.user_id, u.name, r.wpm, r.acc, r.raw, r.ts,
    ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.wpm DESC, r.acc DESC, r.ts ASC) AS rn
  FROM results r JOIN users u ON u.id = r.user_id
  WHERE r.mode = ? AND r.target = ? AND r.lang = ? AND r.ranked = 1 AND r.ts >= ?`;

function list(app, req, res, params, q) {
  const f = filters(q);
  const rows = app.db
    .prepare(`SELECT * FROM (${BEST_SQL}) WHERE rn = 1 ORDER BY wpm DESC, acc DESC, ts ASC LIMIT ${LIMIT}`)
    .all(f.mode, f.target, f.lang, f.from);
  send(res, 200, rows.map((r, i) => ({ rank: i + 1, name: r.name, wpm: r.wpm, acc: r.acc, raw: r.raw, ts: r.ts, resultId: r.id })));
}

// 1-based all-time rank of a user's best on a board, or null if they have no ranked result there.
function rankOf(app, { mode, target, lang, userId }) {
  const best = app.db
    .prepare(`SELECT wpm, acc, ts FROM (${BEST_SQL}) WHERE rn = 1 AND user_id = ?`)
    .get(mode, target, lang, 0, userId);
  if (!best) return null;
  const ahead = app.db
    .prepare(
      `SELECT COUNT(*) AS n FROM (${BEST_SQL}) WHERE rn = 1 AND user_id != ?
       AND (wpm > ? OR (wpm = ? AND (acc > ? OR (acc = ? AND ts < ?))))`
    )
    .get(mode, target, lang, 0, userId, best.wpm, best.wpm, best.acc, best.acc, best.ts);
  return ahead.n + 1;
}

module.exports = { list, rankOf, since };
