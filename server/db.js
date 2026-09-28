"use strict";
// SQLite schema and migrations (node:sqlite, synchronous). One file per DATA_DIR: typetrack.db.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Each entry runs once, in order; PRAGMA user_version records how many have run.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE results (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    lang TEXT NOT NULL,
    mode TEXT NOT NULL,
    target INTEGER NOT NULL,
    wpm REAL NOT NULL,
    raw REAL NOT NULL,
    acc REAL NOT NULL,
    duration INTEGER NOT NULL,
    words_json TEXT NOT NULL,
    log_json TEXT NOT NULL,
    chars_json TEXT NOT NULL,
    ranked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX results_board ON results(mode, target, lang, ranked, wpm DESC);
  CREATE INDEX results_user ON results(user_id, ts);
  CREATE TABLE game_scores (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    score REAL NOT NULL,
    meta_json TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX game_scores_board ON game_scores(game, score DESC);
  CREATE INDEX game_scores_user ON game_scores(user_id, game);
  `,
  // Weekly tournaments: a result submitted for a challenge ('weekly:2026-W40') carries it here.
  `
  ALTER TABLE results ADD COLUMN challenge TEXT;
  CREATE INDEX results_challenge ON results(challenge, wpm DESC);
  `,
];

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "typetrack.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

module.exports = { open, migrate, MIGRATIONS };
