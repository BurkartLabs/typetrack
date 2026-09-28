// localStorage wrapper. Every access is try/catch'd so blocked or full storage never breaks the site.
import { emit } from "./bus.js";

const NS = "typetrack.";
const RESULTS_KEY = "typetrack.results.v1"; // keep compatible with v1 data
const MODES = new Set(["time", "words", "text"]);

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

export function isResult(r) {
  return !!r && typeof r.ts === "number" && typeof r.wpm === "number" && typeof r.acc === "number" &&
    MODES.has(r.mode) && typeof r.target === "number";
}

export function get(key, fallback) {
  return readRaw(NS + key, fallback);
}

export function set(key, value) {
  return writeRaw(NS + key, value);
}

export function remove(key) {
  try { const s = storage(); if (s) s.removeItem(NS + key); } catch { /* ignore */ }
}

export function results() {
  const list = readRaw(RESULTS_KEY, []);
  return Array.isArray(list) ? list.filter(isResult) : [];
}

export function addResult(r) {
  if (typeof r.ts !== "number") r.ts = Date.now();
  const list = results();
  list.push(r);
  writeRaw(RESULTS_KEY, list);
  emit("result:saved", r);
  return r;
}

// Replace the whole result list (import, clear). Invalid entries are dropped. Not in the contract; additive.
export function replaceResults(list) {
  const clean = (Array.isArray(list) ? list : []).filter(isResult).sort((a, b) => a.ts - b.ts);
  writeRaw(RESULTS_KEY, clean);
  return clean;
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

export const store = { get, set, remove, results, addResult, replaceResults, gameScores, addGameScore, isResult };
export default store;
