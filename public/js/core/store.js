// localStorage wrapper. Every access is try/catch'd so blocked or full storage never breaks the site.
//
// Whose data: a player's progress (results, xp, badges, game scores, daily gauntlet runs, training) belongs to
// whoever is playing. Signed out, that is the browser's guest ("typetrack.results.v1", "typetrack.xp", ...); signed
// in, it is the account's own copy on this browser ("typetrack.u<id>.results.v1", ...). auth.js sets the scope on
// every sign-in and sign-out, so signing out shows the guest's progress, not the account's (the Board, 2026-09-30:
// "I can still see my profile as though I am, I see my level"). Preferences (settings, test config, filters, custom
// text) stay with the browser. The first time an account signs in on a browser, it adopts the guest's progress,
// which is what "sign in to keep it everywhere" has always promised; after that the two are kept apart.
import { emit } from "./bus.js";

const NS = "typetrack.";
const RESULTS = "results.v1"; // "typetrack.results.v1": keep compatible with v1 data
const PERSONAL = [RESULTS, "xp", "badges", "games.", "gauntlet.", "train."];
const MODES = new Set(["time", "words", "text"]);

let scope = ""; // "" the guest, "u<id>." an account

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function readRaw(fullKey, fallback) {
  try {
    const s = storage();
    if (!s) return fallback;
    const v = JSON.parse(s.getItem(fullKey));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeRaw(fullKey, value) {
  try {
    const s = storage();
    if (s) s.setItem(fullKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Whether a key is a player's progress (scoped to who is signed in) rather than a browser preference. */
export function isPersonal(key) {
  return PERSONAL.some((p) => (p.endsWith(".") ? key.startsWith(p) : key === p));
}

/** The localStorage key for `key` as the current player sees it. */
export function fullKey(key) {
  return NS + (isPersonal(key) ? scope : "") + key;
}

function keysWithPrefix(prefix) {
  const out = [];
  try {
    const s = storage();
    for (let i = 0; s && i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(prefix)) out.push(k); }
  } catch { /* storage blocked */ }
  return out;
}

/** The guest's progress keys (bare "typetrack.<key>", never an account's "typetrack.u<id>.<key>"). */
function guestKeys() {
  return keysWithPrefix(NS).filter((k) => !/^typetrack\.u\d+\./.test(k) && isPersonal(k.slice(NS.length)));
}

/**
 * Whose progress the store reads and writes: an account id, or null for the guest. The first time an account is
 * seen on this browser it adopts the guest's progress (moved, not copied, so the guest starts clean).
 */
export function setScope(uid) {
  const next = uid == null ? "" : `u${uid}.`;
  if (next === scope) return false;
  scope = next;
  const s = storage();
  if (s && next && !keysWithPrefix(NS + next).length) {
    try {
      for (const k of guestKeys()) {
        s.setItem(NS + next + k.slice(NS.length), s.getItem(k));
        s.removeItem(k);
      }
    } catch { /* storage full or blocked: the account starts empty, the guest keeps its own */ }
  }
  return true;
}

export function isResult(r) {
  return !!r && typeof r.ts === "number" && typeof r.wpm === "number" && typeof r.acc === "number" &&
    MODES.has(r.mode) && typeof r.target === "number";
}

export function get(key, fallback) {
  return readRaw(fullKey(key), fallback);
}

export function set(key, value) {
  return writeRaw(fullKey(key), value);
}

export function remove(key) {
  try { const s = storage(); if (s) s.removeItem(fullKey(key)); } catch { /* ignore */ }
}

export function results() {
  const list = readRaw(fullKey(RESULTS), []);
  return Array.isArray(list) ? list.filter(isResult) : [];
}

export function addResult(r) {
  if (typeof r.ts !== "number") r.ts = Date.now();
  const list = results();
  list.push(r);
  writeRaw(fullKey(RESULTS), list);
  emit("result:saved", r);
  return r;
}

// Replace the whole result list (import, clear). Invalid entries are dropped. Not in the contract; additive.
export function replaceResults(list) {
  const clean = (Array.isArray(list) ? list : []).filter(isResult).sort((a, b) => a.ts - b.ts);
  writeRaw(fullKey(RESULTS), clean);
  return clean;
}

/** The games this player has scores for. */
export function gameIds() {
  const prefix = fullKey("games.");
  return keysWithPrefix(prefix).map((k) => k.slice(prefix.length));
}

export function gameScores(game) {
  const list = get("games." + game, []);
  return Array.isArray(list) ? list : [];
}

export function addGameScore(game, score, meta) {
  const entry = { score, meta: meta || {}, ts: Date.now() };
  const list = gameScores(game);
  list.push(entry);
  set("games." + game, list.slice(-500));
  emit("game:finished", { game, score, meta: entry.meta });
  return entry;
}

export const store = { get, set, remove, results, addResult, replaceResults, gameIds, gameScores, addGameScore, isResult, isPersonal, fullKey, setScope };
export default store;
