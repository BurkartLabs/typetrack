// Shared frame for games pack 1: the shell (title, HUD, arena, start/end overlays), the keyboard state
// machine (space/enter start, esc restarts, tab left alone), a rAF loop with a setTimeout fallback, the
// word pool for the chosen language, and Stream, a one-line scrolling word strip with a fixed caret.
import keys from "../../core/keys.js";
import store from "../../core/store.js";
import settings from "../../core/settings.js";
import words, { FALLBACK } from "../../core/words.js";
import { loadCss } from "../../core/css.js";
import { esc } from "../../core/ui.js";
import { makeRng, charMatch, bestScore } from "./pack1-logic.js";

export { esc };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Calls fn(t) every frame. rAF can stall (background tabs, some embedded previews), so a timeout races it;
// whichever fires first cancels the other.
export function loop(fn) {
  let alive = true, raf = 0, to = 0;
  const hasRaf = typeof requestAnimationFrame === "function";
  const step = () => {
    if (!alive) return;
    if (hasRaf) cancelAnimationFrame(raf);
    clearTimeout(to);
    try { fn(now()); } catch (err) { console.error("[games] frame failed", err); }
    if (!alive) return;
    if (hasRaf) raf = requestAnimationFrame(step);
    to = setTimeout(step, 40);
  };
  step();
  return () => { alive = false; if (hasRaf) cancelAnimationFrame(raf); clearTimeout(to); };
}

export async function loadPool(lang) {
  let list;
  try { list = await words.list(lang, "common-1k"); } catch { list = null; }
  const clean = (Array.isArray(list) ? list : []).filter((w) => typeof w === "string" && w.length > 0 && !/\s/.test(w));
  return clean.length >= 20 ? clean : FALLBACK.slice();
}

// Restart a CSS animation on el by toggling cls.
export function pulse(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function fmt(n, d = 0) {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

// defineGame({ id, name, rules, unit, hud: [[key, label]], build(g) -> Node, reset(g, {same}), key(g, k, t),
//   frame?(g, t), startExtra?(g) -> html, bestFmt?(score) }) -> { mount, unmount }
export function defineGame(def) {
  let g = null, alive = 0;

  async function mount(stage, ctx) {
    const my = ++alive;
    await loadCss("css/games-pack1.css");
    const lang = settings.get("lang") || "en";
    const pool = await loadPool(lang);
    if (my !== alive) return;

    g = {
      def, id: def.id, ctx, lang, pool, state: "idle", started: false, t0: 0, lockUntil: 0,
      rng: makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0),
      lenient: settings.get("accents") !== "strict",
      timers: new Set(), stopLoop: null,
      match(expected, typed) { return charMatch(expected, typed, g.lenient); },
      hud(k, v) { const el = g.hudEls[k]; if (el && el.textContent !== String(v)) el.textContent = v; },
      after(ms, fn) { const id = setTimeout(() => { g.timers.delete(id); fn(); }, ms); g.timers.add(id); return id; },
      go(t) { if (!g.started) { g.started = true; g.t0 = t; g.root.classList.add("p1-live"); } },
      shake() { pulse(g.arena, "p1-shake"); },
      finish, begin,
      best() { return bestScore(store.gameScores(def.id)); },
    };

    const root = document.createElement("div");
    root.className = `p1 p1-${def.id}`;
    root.innerHTML = `
      <div class="p1-head">
        <div class="p1-title">${esc(def.name)}</div>
        <div class="p1-hud">${(def.hud || []).map(([k, label]) =>
          `<div class="p1-stat" data-k="${k}"><span class="p1-label">${esc(label)}</span><span class="p1-val">-</span></div>`).join("")}</div>
      </div>
      <div class="p1-arena"><div class="p1-overlay"></div></div>
      <div class="p1-foot"><span><kbd>space</kbd> start</span><span><kbd>esc</kbd> restart</span><span>${esc(lang)}</span></div>`;
    g.root = root;
    g.arena = root.querySelector(".p1-arena");
    g.overlay = root.querySelector(".p1-overlay");
    g.hudEls = {};
    root.querySelectorAll(".p1-stat").forEach((s) => { g.hudEls[s.dataset.k] = s.querySelector(".p1-val"); });
    g.arena.insertBefore(def.build(g), g.overlay);
    stage.replaceChildren(root);

    g.removeKeys = keys.set(onKey);
    showStart();
  }

  function onKey(e) {
    if (!g || keys.inField(e)) return;
    if (e.key === "Tab") return; // focus stays usable
    const altGr = e.ctrlKey && e.altKey;
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
    if (e.key === "Escape") { e.preventDefault(); if (!e.repeat) begin({}); return; }
    if (g.state !== "play") {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat && now() >= g.lockUntil) begin({ same: e.key === "Enter" });
      }
      return;
    }
    if (e.key.length === 1 || e.key === "Backspace") {
      e.preventDefault();
      if (e.key === "Backspace") return; // no backspace in any pack-1 game: a wrong key never advances
      def.key(g, e.key, now());
    }
  }

  function stopAll() {
    if (g.stopLoop) { g.stopLoop(); g.stopLoop = null; }
    for (const id of g.timers) clearTimeout(id);
    g.timers.clear();
  }

  function begin(opts) {
    stopAll();
    g.state = "play";
    g.started = false;
    g.t0 = 0;
    g.root.classList.remove("p1-over", "p1-live");
    g.root.classList.add("p1-playing");
    g.overlay.classList.remove("show");
    g.overlay.replaceChildren(); // a hidden end card must not keep the arena tall
    def.reset(g, opts || {});
    if (def.frame) g.stopLoop = loop((t) => { if (g && g.state === "play") def.frame(g, t); });
  }

  function showStart() {
    const best = g.best();
    g.overlay.innerHTML = `
      <div class="p1-card">
        <div class="p1-label">${esc(def.name)}</div>
        <p class="p1-rules">${esc(def.rules)}</p>
        ${def.startExtra ? def.startExtra(g) : ""}
        <div class="p1-best">best <b>${best === null ? "-" : esc(fmtScore(best))}</b></div>
        <div class="p1-press"><kbd>space</kbd> to start</div>
      </div>`;
    g.overlay.classList.add("show");
  }

  function fmtScore(s) { return def.bestFmt ? def.bestFmt(s) : String(s); }

  // score: number saved to the store; meta: saved with it; opts: {title, stats: [[label, value]], extra: html}
  function finish(score, meta, opts = {}) {
    if (!g || g.state !== "play") return;
    stopAll();
    g.state = "over";
    g.root.classList.remove("p1-playing", "p1-live");
    g.root.classList.add("p1-over");
    const prev = g.best();
    store.addGameScore(def.id, score, Object.assign({ lang: g.lang }, meta));
    const isBest = score > 0 && (prev === null || score > prev);
    const best = prev === null ? score : Math.max(prev, score);
    g.lockUntil = now() + (def.lockMs == null ? 700 : def.lockMs); // a reflexive space after the last word must not restart
    g.overlay.innerHTML = `
      <div class="p1-card p1-end">
        <div class="p1-label">${esc(opts.title || "game over")}</div>
        <div class="p1-score">${esc(fmtScore(score))}<small>${esc(def.unit || "")}</small></div>
        <div class="p1-best">${isBest ? `<span class="p1-new">new best</span>` : `best <b>${esc(fmtScore(best))}</b>`}</div>
        ${opts.stats && opts.stats.length ? `<div class="p1-stats">${opts.stats.map(([l, v]) =>
          `<div class="p1-mini"><span class="p1-label">${esc(l)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
        ${opts.extra || ""}
        <div class="p1-press"><kbd>space</kbd> retry <span class="p1-dot">·</span> <a href="#/games">all games</a></div>
      </div>`;
    g.overlay.classList.add("show");
  }

  function unmount() {
    alive++;
    if (!g) return;
    stopAll();
    if (g.removeKeys) g.removeKeys();
    if (def.destroy) def.destroy(g);
    g.root.remove();
    g = null;
  }

  return { mount, unmount };
}

// A single line of words scrolling left past a fixed caret. Characters are spans in a monospace font, so
// position is just `pos` ch. Typing the space after word i completes word i.
export class Stream {
  constructor(next, { lookAhead = 90 } = {}) {
    this.next = next;
    this.lookAhead = lookAhead;
    this.el = document.createElement("div");
    this.el.className = "p1-stream";
    this.el.innerHTML = `<div class="p1-strip"></div><div class="p1-caret"></div>`;
    this.strip = this.el.firstChild;
    this.reset();
  }

  reset() {
    this.strip.replaceChildren();
    this.strip.style.transition = "none";
    this.chars = []; this.spans = []; this.wordOf = []; this.words = []; this.starts = [];
    this.pos = 0; this.curWord = -1;
    this.fill();
    this.place();
    void this.strip.offsetWidth;
    this.strip.style.transition = "";
  }

  fill() {
    const frag = document.createDocumentFragment();
    while (this.chars.length - this.pos < this.lookAhead) {
      const wi = this.words.length;
      const w = this.next(wi, this.words[wi - 1]);
      this.words.push(w);
      this.starts.push(this.chars.length);
      for (const c of w + " ") {
        const s = document.createElement("span");
        s.className = c === " " ? "p1-ch p1-sp" : "p1-ch";
        s.textContent = c;
        this.chars.push(c); this.spans.push(s); this.wordOf.push(wi);
        frag.appendChild(s);
      }
    }
    this.strip.appendChild(frag);
  }

  expected() { return this.chars[this.pos]; }
  word() { return this.wordOf[this.pos]; }
  // chars of the current word typed so far
  intoWord() { return this.pos - this.starts[this.word()]; }

  // -> {ok, done}: done is the index of the word just completed (its space typed), else -1
  type(k, match) {
    const exp = this.chars[this.pos];
    const ok = exp === " " ? k === " " : match(exp, k);
    const span = this.spans[this.pos];
    if (!ok) { pulse(span, "bad"); return { ok: false, done: -1 }; }
    span.classList.add("ok");
    this.pos++;
    const done = exp === " " ? this.wordOf[this.pos - 1] : -1;
    this.fill();
    this.place();
    return { ok: true, done };
  }

  // mark the current char as the one that ended the run
  fail() { const s = this.spans[this.pos]; if (s) s.classList.add("dead"); }

  place() {
    const wi = this.wordOf[this.pos];
    if (wi !== this.curWord) {
      if (this.curWord >= 0) this.forWord(this.curWord, (s) => s.classList.remove("cur"));
      this.forWord(wi, (s) => s.classList.add("cur"));
      this.curWord = wi;
    }
    this.strip.style.transform = `translateX(${-this.pos}ch)`;
  }

  forWord(wi, fn) {
    const a = this.starts[wi];
    if (a === undefined) return;
    const b = wi + 1 < this.starts.length ? this.starts[wi + 1] : this.chars.length;
    for (let i = a; i < b; i++) fn(this.spans[i]);
  }
}

// A big single word with typed/untyped letters, plus a faint preview of the next one.
export class BigWord {
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "p1-bigword";
    this.el.innerHTML = `<div class="p1-next"></div><div class="p1-word" dir="auto"></div>`;
    this.nextEl = this.el.firstChild;
    this.wordEl = this.el.lastChild;
  }
  set(word, next) {
    this.word = word; this.typed = 0;
    this.wordEl.replaceChildren(...[...word].map((c) => {
      const s = document.createElement("span");
      s.className = "p1-ch";
      s.textContent = c;
      return s;
    }));
    this.nextEl.textContent = next || "";
    this.mark();
    this.wordEl.classList.remove("p1-boom");
    pulse(this.wordEl, "p1-in");
  }
  mark() {
    const kids = this.wordEl.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle("ok", i < this.typed);
      kids[i].classList.toggle("at", i === this.typed);
    }
  }
  // -> 'ok' | 'bad' | 'done' | 'skip' (a space before the first letter is ignored)
  type(k, match) {
    if (this.typed === 0 && k === " ") return "skip";
    const exp = this.word[this.typed];
    if (exp === undefined) return "skip";
    if (!match(exp, k)) { pulse(this.wordEl.children[this.typed], "bad"); return "bad"; }
    this.typed++;
    this.mark();
    return this.typed >= this.word.length ? "done" : "ok";
  }
  boom() { pulse(this.wordEl, "p1-boom"); }
}
