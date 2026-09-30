"use strict";
// POST /api/results: store a verified typing result. GET /api/ghosts/:id: a result's words + log for racing.
const { HttpError, send, readJson, KB } = require("../http.js");
const { requireUser } = require("../auth.js");
const { verifyResult } = require("../validate.js");
const { rankOf } = require("./leaderboard.js");
const { checkChallenge } = require("./weekly.js");

const RESULT_BODY = 1024 * KB;

function cleanChars(c) {
  const out = {};
  for (const k of ["correct", "incorrect", "extra", "missed"]) {
    const v = c && Number(c[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  }
  return out;
}

async function create(app, req, res) {
  const user = requireUser(app, req);
  const body = await readJson(req, RESULT_BODY);
  const v = verifyResult(body);
  // A weekly challenge run is checked against the week's seeded words and kept off the standard boards
  // (its words are known in advance, so it is not a standard test).
  const challenge = body.challenge == null ? null : checkChallenge(app, body.challenge, v);
  // Only standard tests rank: drills, ghosts, quotes and other sources choose or know their words.
  const standard = body.source == null || body.source === "words";
  const ranked = !challenge && standard && app.isRanked(v.lang, v.words) ? 1 : 0;
  const ts = Date.now();
  const info = app.db
    .prepare(
      `INSERT INTO results (user_id, ts, lang, mode, target, wpm, raw, acc, duration, words_json, log_json, chars_json, ranked, challenge)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id, ts, v.lang, v.mode, v.target, v.wpm, v.raw, v.acc, v.duration,
      JSON.stringify(v.words), JSON.stringify(v.log.map((e) => [e[0], e[1]])),
      JSON.stringify(cleanChars(v.chars)), ranked, challenge
    );
  const id = Number(info.lastInsertRowid);
  send(res, 201, {
    id,
    rank: ranked ? rankOf(app, { mode: v.mode, target: v.target, lang: v.lang, userId: user.id }) : null,
    ranked: Boolean(ranked),
    challenge,
    wpm: v.wpm,
    acc: v.acc,
  });
}

function ghost(app, req, res, params) {
  const id = Number(params[0]);
  const row = Number.isSafeInteger(id)
    ? app.db
        .prepare(
          `SELECT u.name, r.wpm, r.acc, r.raw, r.mode, r.target, r.lang, r.duration, r.ts, r.words_json, r.log_json
           FROM results r JOIN users u ON u.id = r.user_id WHERE r.id = ?`
        )
        .get(id)
    : null;
  if (!row) throw new HttpError(404, "no such result");
  const { words_json, log_json, ...rest } = row;
  send(res, 200, { id, ...rest, words: JSON.parse(words_json), log: JSON.parse(log_json) });
}

module.exports = { create, ghost };
