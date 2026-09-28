"use strict";
// POST /api/games/:game/score {score, meta} (auth); GET /api/games/:game/leaderboard?period=&order=desc|asc
// Higher is better unless the client asks for order=asc (e.g. reaction-time games).
const { HttpError, send, readJson } = require("../http.js");
const { requireUser } = require("../auth.js");
const { since } = require("./leaderboard.js");

const GAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_META = 2048;

function gameId(params) {
  const g = params[0];
  if (!GAME_RE.test(g)) throw new HttpError(400, "invalid game");
  return g;
}

async function score(app, req, res, params) {
  const user = requireUser(app, req);
  const game = gameId(params);
  const b = await readJson(req);
  const s = b.score;
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 1e9) throw new HttpError(422, "invalid score");
  const meta = b.meta == null ? {} : b.meta;
  if (typeof meta !== "object" || Array.isArray(meta)) throw new HttpError(422, "meta must be an object");
  const metaJson = JSON.stringify(meta);
  if (metaJson.length > MAX_META) throw new HttpError(413, "meta too large");
  const info = app.db
    .prepare("INSERT INTO game_scores (user_id, game, score, meta_json, ts) VALUES (?, ?, ?, ?, ?)")
    .run(user.id, game, s, metaJson, Date.now());
  send(res, 201, { id: Number(info.lastInsertRowid) });
}

function leaderboard(app, req, res, params, q) {
  const game = gameId(params);
  const from = since(q.get("period"));
  const dir = q.get("order") === "asc" ? "ASC" : "DESC";
  const rows = app.db
    .prepare(
      `SELECT * FROM (
         SELECT g.id, u.name, g.score, g.meta_json, g.ts,
           ROW_NUMBER() OVER (PARTITION BY g.user_id ORDER BY g.score ${dir}, g.ts ASC) AS rn
         FROM game_scores g JOIN users u ON u.id = g.user_id WHERE g.game = ? AND g.ts >= ?
       ) WHERE rn = 1 ORDER BY score ${dir}, ts ASC LIMIT 50`
    )
    .all(game, from);
  send(res, 200, rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, meta: JSON.parse(r.meta_json), ts: r.ts })));
}

module.exports = { score, leaderboard };
