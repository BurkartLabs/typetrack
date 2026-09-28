// Code golf typing: type real code exactly. Symbols count double, Enter is a newline, Tab types two spaces.
// A wrong key does not advance (the character stays marked until you hit it). Score = points per minute,
// and the end screen ranks the symbols that cost you the most time.
import { esc } from "../../core/ui.js";
import { Eng, pick, codeSnippetsInfo, loadPack3Css, bestScore, endPanel } from "./pack3-kit.js";

const ID = "code-golf";
const LANGS = ["js", "py", "cs", "sql", "rs", "sh"];
const MIN_CHARS = 200, MAX_SNIPPETS = 4;

// ── pure ──────────────────────────────────────────────────────────────────
export const SYMBOLS = "{}[]()<>;:=+-*/&|!\"'`";
export const isSymbol = (ch) => ch.length === 1 && SYMBOLS.includes(ch);
export const symbolPoints = (ch) => (isSymbol(ch) ? 2 : 1);

// LF newlines, tabs as two spaces, no trailing spaces or blank edges.
export function normalizeSnippet(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n").replace(/\t/g, "  ")
    .split("\n").map((l) => l.replace(/\s+$/, "")).join("\n")
    .replace(/^\n+|\n+$/g, "");
}

// Snippets back to back (one per line block) until at least minChars.
export function buildRound(snippets, rand, minChars = MIN_CHARS, max = MAX_SNIPPETS) {
  const pool = snippets.map(normalizeSnippet).filter(Boolean);
  if (!pool.length) return "";
  const out = [];
  let len = 0, guard = 0;
  while ((len < minChars && out.length < max) && guard++ < 50) {
    const s = pick(pool, rand);
    if (out.includes(s) && pool.length > out.length) continue;
    out.push(s);
    len += s.length + 1;
  }
  return out.join("\n");
}

export function createGolf(text) {
  return { text, pos: 0, errors: 0, err: false, startedAt: null, lastAt: null, finishedAt: null, events: [], errorsAt: {} };
}

function advance(s, now) {
  const ch = s.text[s.pos];
  if (s.lastAt !== null) s.events.push({ ch, ms: now - s.lastAt });
  s.lastAt = now;
  s.pos++;
  s.err = false;
  if (s.pos >= s.text.length) s.finishedAt = now;
}

// Feed one key ("Enter", "Tab" or a character). Returns true when it advanced.
export function golfKey(s, key, now) {
  if (s.finishedAt !== null || s.pos >= s.text.length) return false;
  if (s.startedAt === null) { s.startedAt = now; s.lastAt = now; }
  const want = s.text[s.pos];
  if (key === "Tab") {
    if (want !== " ") return miss(s);
    advance(s, now);
    if (s.text[s.pos] === " ") advance(s, now);
    return true;
  }
  const ch = key === "Enter" ? "\n" : key;
  if (ch !== want) return miss(s);
  advance(s, now);
  return true;
}

function miss(s) {
  s.errors++;
  s.err = true;
  const c = s.text[s.pos];
  s.errorsAt[c] = (s.errorsAt[c] || 0) + 1;
  return false;
}

export function golfPoints(text, upTo = text.length) {
  let p = 0;
  for (let i = 0; i < upTo; i++) p += symbolPoints(text[i]);
  return p;
}

export function pointsPerMinute(points, ms) {
  return ms > 0 ? Math.round(points / (ms / 60000)) : 0;
}

export function golfAccuracy(s) {
  const n = s.pos + s.errors;
  return n ? Math.round((s.pos / n) * 1000) / 10 : 100;
}

// Per-symbol time: {baseline (median ms for letters and digits), symbols: [{ch, n, avg, ratio}] slowest first}.
export function symbolBreakdown(events) {
  const median = (xs) => { if (!xs.length) return 0; const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const letters = events.filter((e) => /[\p{L}\p{N}]/u.test(e.ch)).map((e) => e.ms);
  const baseline = Math.round(median(letters));
  const by = new Map();
  for (const e of events) {
    if (!isSymbol(e.ch)) continue;
    if (!by.has(e.ch)) by.set(e.ch, []);
    by.get(e.ch).push(e.ms);
  }
  const symbols = [...by.entries()].map(([ch, xs]) => {
    const avg = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    return { ch, n: xs.length, avg, ratio: baseline ? Math.round((avg / baseline) * 10) / 10 : 0 };
  }).sort((a, b) => b.avg - a.avg);
  return { baseline, symbols };
}

// ── view ──────────────────────────────────────────────────────────────────
let alive = false, removeKeys = null, timer = null;

function stop() {
  clearInterval(timer); timer = null;
  if (removeKeys) { removeKeys(); removeKeys = null; }
}

async function mount(root, ctx) {
  alive = true;
  await loadPack3Css();
  const { store, keys } = ctx;
  let lang = store.get("code-golf.lang", "js");
  if (!LANGS.includes(lang)) lang = "js";
  root.innerHTML = `<section class="p3 p3-code-golf">
    <div class="p3-head"><div><div class="p3-title">code golf typing</div>
    <div class="p3-sub">real code, exactly. symbols count double · enter = newline · tab = two spaces</div></div></div>
    <div class="p3-tabs p3-langs">${LANGS.map((l) => `<button data-l="${l}">${l}</button>`).join("")}</div>
    <div class="p3-body"></div></section>`;
  const body = root.querySelector(".p3-body");
  const langsEl = root.querySelector(".p3-langs");
  let text = "", builtin = false;

  function setKeys(fn) { if (removeKeys) removeKeys(); removeKeys = keys.set(fn); }

  langsEl.onclick = (e) => {
    const b = e.target.closest("[data-l]");
    if (!b) return;
    lang = b.dataset.l;
    store.set("code-golf.lang", lang);
    newRound();
  };

  async function newRound() {
    stop();
    langsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.l === lang));
    const info = await codeSnippetsInfo(lang);
    if (!alive) return;
    builtin = info.builtin;
    text = buildRound(info.list, Eng().mulberry32(Date.now() >>> 0));
    play();
  }

  function play() {
    stop();
    langsEl.hidden = false;
    const s = createGolf(text);
    body.innerHTML = `
      ${builtin ? `<div class="p3-note">no <b>${esc(lang)}</b> snippet pack yet &#8212; using built-in ${esc(lang === "py" ? "python" : "javascript")} snippets.</div>` : ""}
      <div class="p3-code-bar">
        <div><span class="p3-label">points / min</span><span class="ppm">0</span></div>
        <div><span class="p3-label">points</span><span class="pts">0</span></div>
        <div><span class="p3-label">time</span><span class="tm">0.0</span></div>
        <div><span class="p3-label">misses</span><span class="ms">0</span></div>
      </div>
      <pre class="p3-code"></pre>
      <div class="p3-actions"><button class="p3-btn" data-act="new">new code</button></div>
      <div class="p3-hint">esc: restart · the underlined character is next</div>`;
    const pre = body.querySelector(".p3-code");
    const frag = document.createDocumentFragment();
    const spans = [];
    for (const ch of text) {
      const sp = document.createElement("span");
      sp.className = "c" + (isSymbol(ch) ? " sym" : "") + (ch === "\n" ? " nl" : "");
      frag.appendChild(sp);
      if (ch === "\n") frag.appendChild(document.createTextNode("\n"));
      else sp.textContent = ch;
      spans.push(sp);
    }
    pre.replaceChildren(frag);
    if (spans[0]) spans[0].classList.add("cur");
    const el = { ppm: body.querySelector(".ppm"), pts: body.querySelector(".pts"), tm: body.querySelector(".tm"), ms: body.querySelector(".ms") };
    body.querySelector('[data-act="new"]').onclick = () => newRound();

    function bar() {
      if (s.startedAt === null) return;
      const ms = (s.finishedAt ?? Date.now()) - s.startedAt;
      const pts = golfPoints(text, s.pos);
      el.ppm.textContent = pointsPerMinute(pts, ms);
      el.pts.textContent = pts;
      el.tm.textContent = (ms / 1000).toFixed(1);
      el.ms.textContent = s.errors;
    }

    setKeys((e) => {
      if (keys.inField(e)) return;
      if (e.key === "Escape") { e.preventDefault(); if (!e.repeat) play(); return; }
      const altGr = e.ctrlKey && e.altKey;
      if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
      if (e.key !== "Enter" && e.key !== "Tab" && e.key.length !== 1) return;
      e.preventDefault();
      const before = s.pos;
      if (s.startedAt === null) { document.body.classList.add("typing-active"); langsEl.hidden = true; }
      golfKey(s, e.key, Date.now());
      if (s.pos !== before) {
        for (let i = before; i < s.pos; i++) spans[i].classList.remove("cur", "err"), spans[i].classList.add("ok");
        if (spans[s.pos]) {
          spans[s.pos].classList.add("cur");
          const r = spans[s.pos].getBoundingClientRect(), pr = pre.getBoundingClientRect();
          if (r.right > pr.right - 20 || r.left < pr.left) pre.scrollLeft += r.left - pr.left - pr.width / 2;
        }
      } else if (spans[s.pos]) spans[s.pos].classList.add("err");
      bar();
      if (s.finishedAt !== null) finish(s);
    });
    timer = setInterval(bar, 200);
  }

  function finish(s) {
    stop();
    document.body.classList.remove("typing-active");
    langsEl.hidden = false;
    const ms = s.finishedAt - s.startedAt;
    const points = golfPoints(text);
    const ppm = pointsPerMinute(points, ms);
    const acc = golfAccuracy(s);
    const bd = symbolBreakdown(s.events);
    const prevBest = bestScore(store, ID);
    store.addGameScore(ID, ppm, {
      lang, points, ms, acc, errors: s.errors, chars: text.length,
      slow: bd.symbols.slice(0, 3).map((x) => ({ ch: x.ch, avg: x.avg })),
    });
    const chips = bd.symbols.slice(0, 10).map((x) =>
      `<span class="p3-sym${x.ratio >= 1.5 ? " slow" : ""}"><b>${esc(x.ch)}</b>${x.avg} ms · ×${x.n}${x.ratio ? ` · ${x.ratio}×` : ""}</span>`).join("");
    body.innerHTML = endPanel({
      title: "points per minute", score: ppm, unit: "ppm", best: prevBest, isBest: prevBest == null || ppm > prevBest,
      stats: [["points", points], ["time", `${(ms / 1000).toFixed(1)} s`], ["accuracy", `${acc}%`], ["letter pace", `${bd.baseline} ms`]],
      extra: bd.symbols.length ? `<div class="p3-label">slowest symbols (avg ms before the key · count · vs letters)</div><div class="p3-syms">${chips}</div>` : "",
      retry: "same code again",
    });
    body.querySelector('[data-act="retry"]').onclick = () => play();
    const acts = body.querySelector(".p3-actions");
    const nb = document.createElement("button");
    nb.className = "p3-btn"; nb.textContent = "new code"; nb.onclick = () => newRound();
    acts.insertBefore(nb, acts.children[1]);
    setKeys((e) => {
      if (e.key === "Enter" || (e.key === "Escape" && !e.repeat)) { e.preventDefault(); play(); }
    });
  }

  newRound();
}

function unmount() {
  alive = false;
  stop();
  document.body.classList.remove("typing-active");
}

export default { mount, unmount };
