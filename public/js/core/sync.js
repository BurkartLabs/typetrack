// Score sync. Imported once by app.js for its side effects.
//  - game:finished while signed in -> POST /api/games/<game>/score. Network / server failures are queued in
//    the store (per user) and retried on the next auth:changed (which also fires on page load when signed in).
//  - The first time a user signs in on this browser, offer once to upload the local typing results that carry
//    a keystroke log (the server re-derives and validates each one). Typing results saved while signed in are
//    posted by app.js; this module only remembers them so they are not offered again.
import bus from "./bus.js";
import store from "./store.js";
import api from "./api.js";
import auth from "./auth.js";
import { toast } from "./ui.js";
import { loadCss } from "./css.js";

const QUEUE = "sync.queue"; // [{uid, game, score, meta, ts}]
const OFFERED = "sync.offered"; // [uid]
const UPLOADED = "sync.uploaded"; // {uid: [result ts]}
const MAX_QUEUE = 200;
const MAX_UPLOAD = 300;
const GAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// Worth retrying: offline (0), signed out mid-way (401), rate limited, or a server error.
const retriable = (err) => !err || err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500;

function list(key, fb) {
  const v = store.get(key, fb);
  return Array.isArray(fb) ? (Array.isArray(v) ? v : fb) : v && typeof v === "object" ? v : fb;
}

function postScore(e) {
  return api.post(`/api/games/${encodeURIComponent(e.game)}/score`, { score: e.score, meta: e.meta || {} });
}

function enqueue(e) {
  const q = list(QUEUE, []);
  q.push(e);
  store.set(QUEUE, q.slice(-MAX_QUEUE));
}

bus.on("game:finished", (d) => {
  const u = auth.user;
  if (!u || !d || !GAME_RE.test(String(d.game)) || typeof d.score !== "number" || !Number.isFinite(d.score)) return;
  const e = { uid: u.id, game: d.game, score: d.score, meta: d.meta && typeof d.meta === "object" ? d.meta : {}, ts: Date.now() };
  postScore(e).catch((err) => { if (retriable(err)) enqueue(e); });
});

let flushing = false;
export async function flush() {
  const u = auth.user;
  if (!u || flushing) return;
  flushing = true;
  try {
    const q = list(QUEUE, []);
    const keep = [];
    let stop = false;
    for (const e of q) {
      if (stop || e.uid !== u.id) { keep.push(e); continue; }
      try {
        await postScore(e);
      } catch (err) {
        if (retriable(err)) { keep.push(e); if (err && err.status === 0) stop = true; }
      }
    }
    store.set(QUEUE, keep);
  } finally {
    flushing = false;
  }
}

function uploadedSet(uid) {
  const m = list(UPLOADED, {});
  return new Set(Array.isArray(m[uid]) ? m[uid] : []);
}

function markUploaded(uid, tsList) {
  const m = list(UPLOADED, {});
  const cur = Array.isArray(m[uid]) ? m[uid] : [];
  m[uid] = [...new Set([...cur, ...tsList])].slice(-5000);
  store.set(UPLOADED, m);
}

// Results saved while signed in are posted by app.js; remember them so the offer skips them.
bus.on("result:saved", (r) => {
  if (auth.user && r && typeof r.ts === "number") markUploaded(auth.user.id, [r.ts]);
});

function uploadable(uid) {
  const done = uploadedSet(uid);
  return store.results()
    .filter((r) => Array.isArray(r.log) && r.log.length && Array.isArray(r.words) && r.words.length &&
      (r.mode === "time" || r.mode === "words") && !r.challenge && !done.has(r.ts))
    .slice(-MAX_UPLOAD);
}

function offer(u) {
  const offered = list(OFFERED, []);
  if (offered.includes(u.id)) return;
  const todo = uploadable(u.id);
  store.set(OFFERED, [...offered, u.id].slice(-50));
  if (!todo.length) return;
  loadCss("css/leaderboard.css");
  document.querySelector(".sync-offer")?.remove();
  const bar = document.createElement("div");
  bar.className = "sync-offer";
  bar.setAttribute("role", "dialog");
  bar.innerHTML = `<span>upload <b>${todo.length}</b> local result${todo.length === 1 ? "" : "s"} to your account?</span>` +
    `<button type="button" class="sync-yes">upload</button><button type="button" class="sync-no">not now</button>`;
  bar.querySelector(".sync-no").addEventListener("click", () => bar.remove());
  bar.querySelector(".sync-yes").addEventListener("click", () => { bar.remove(); upload(u, todo); });
  document.body.appendChild(bar);
}

async function upload(u, todo) {
  let ok = 0, rejected = 0, offline = false;
  const done = [];
  for (let i = 0; i < todo.length; i++) {
    if (!auth.user || auth.user.id !== u.id) break;
    toast(`uploading ${i + 1} / ${todo.length}`, 4000);
    try {
      await api.post("/api/results", todo[i]);
      ok++;
      done.push(todo[i].ts);
    } catch (err) {
      if (err && err.status === 0) { offline = true; break; }
      if (err && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
        rejected++;
        done.push(todo[i].ts); // the server will never accept it; do not offer it again
      } else break;
    }
  }
  markUploaded(u.id, done);
  toast(offline ? `uploaded ${ok}; the server went offline` :
    `uploaded ${ok} result${ok === 1 ? "" : "s"}${rejected ? `, ${rejected} not accepted` : ""}`, 4000);
}

bus.on("auth:changed", (u) => {
  if (!u) return;
  flush();
  offer(u);
});

export const sync = { flush };
export default sync;
