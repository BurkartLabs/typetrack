"use strict";
// GET /api/profile/:name -> {name, joined, xp, level, progress, pbs, badges, tests, seconds, recent, games}
// XP, level and badges come from public/js/core/progress.js when it exists (shared with the browser).
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { HttpError, send } = require("../http.js");
const { Engine } = require("../validate.js");

const PROGRESS = path.join(__dirname, "..", "..", "public", "js", "core", "progress.js");
let progressMod = null;

async function progress() {
  if (progressMod) return progressMod;
  if (!fs.existsSync(PROGRESS)) return null;
  try {
    progressMod = await import(pathToFileURL(PROGRESS).href);
  } catch {
    return null;
  }
  return progressMod;
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

async function get(app, req, res, params) {
  let name;
  try {
    name = decodeURIComponent(params[0]);
  } catch {
    throw new HttpError(400, "invalid name");
  }
  const user = app.db.prepare("SELECT id, name, created FROM users WHERE name = ?").get(name);
  if (!user) throw new HttpError(404, "no such user");

  const results = app.db
    .prepare("SELECT id, ts, lang, mode, target, wpm, raw, acc, duration, chars_json FROM results WHERE user_id = ? ORDER BY ts")
    .all(user.id)
    .map(({ chars_json, ...r }) => ({ ...r, chars: JSON.parse(chars_json) }));
  const games = app.db
    .prepare("SELECT game, score, meta_json, ts FROM game_scores WHERE user_id = ? ORDER BY ts")
    .all(user.id)
    .map(({ meta_json, ...g }) => ({ ...g, meta: JSON.parse(meta_json) }));

  // Personal bests per mode/target/lang.
  const pbMap = new Map();
  for (const r of results) {
    const k = `${r.mode} ${r.target} ${r.lang}`;
    const cur = pbMap.get(k);
    if (!cur || r.wpm > cur.wpm) pbMap.set(k, r);
  }
  const pbs = [...pbMap.values()].map((r) => ({
    mode: r.mode, target: r.target, lang: r.lang, wpm: r.wpm, acc: r.acc, ts: r.ts, resultId: r.id,
  }));
  const gameBest = {};
  for (const g of games) if (!(g.game in gameBest) || g.score > gameBest[g.game]) gameBest[g.game] = g.score;

  let xp = 0;
  let level = 1;
  let prog = null;
  let badges = [];
  const p = await progress();
  if (p) {
    if (typeof p.xpForResult === "function") for (const r of results) xp += Number(safe(() => p.xpForResult(r), 0)) || 0;
    if (typeof p.xpForGame === "function") for (const g of games) xp += Number(safe(() => p.xpForGame(g.game, g.score, g.meta), 0)) || 0;
    xp = Math.round(xp);
    if (typeof p.levelFor === "function") {
      const l = safe(() => p.levelFor(xp), null);
      if (l && typeof l === "object") {
        level = l.level || 1;
        prog = { into: l.into, next: l.next };
      } else if (typeof l === "number") level = l;
    }
    if (Array.isArray(p.BADGES)) {
      const days = [...new Set(results.map((r) => new Date(r.ts).toISOString().slice(0, 10)))];
      const summary = {
        ...Engine.summarize(results),
        results,
        games,
        gameBest,
        pbs,
        xp,
        level,
        days,
        streak: typeof p.streak === "function" ? safe(() => p.streak(days), 0) : 0,
      };
      badges = p.BADGES.filter((b) => safe(() => Boolean(b.test(summary)), false)).map((b) => ({ id: b.id, name: b.name, desc: b.desc }));
    }
  }

  send(res, 200, {
    name: user.name,
    joined: user.created,
    xp,
    level,
    progress: prog,
    pbs,
    badges,
    tests: results.length,
    seconds: results.reduce((a, r) => a + r.duration, 0),
    recent: results.slice(-20).reverse().map(({ chars, ...r }) => r),
    games: gameBest,
  });
}

module.exports = { get };
