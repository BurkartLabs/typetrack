// Shared canvas helpers for the pack-2 games: HiDPI stage that follows its container, a game loop that
// survives embedded previews where requestAnimationFrame never fires (setTimeout fallback), colours read
// from the CSS tokens (never hard-coded), a light particle pool, and the game shell (start / pause / end
// screens, keyboard, best score, saving the run). Nothing touches the DOM at import time, so node tests
// can import the pure helpers.
import keys from "../../../core/keys.js";
import store from "../../../core/store.js";
import settings from "../../../core/settings.js";
import words from "../../../core/words.js";
import { esc } from "../../../core/ui.js";
import { loadCss } from "../../../core/css.js";

// ── colours ─────────────────────────────────────────────────────────────
const TOKENS = { bg: "--bg", main: "--main", caret: "--caret", sub: "--sub", subAlt: "--sub-alt", text: "--text",
  error: "--error", errorExtra: "--error-extra", edge: "--edge", font: "--font" };
const DEFAULT_FONT = "ui-monospace, monospace";

export function palette(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const p = {};
  for (const [k, v] of Object.entries(TOKENS)) p[k] = cs.getPropertyValue(v).trim();
  if (!p.font) p.font = DEFAULT_FONT;
  return p;
}

// "#abc" | "#aabbcc" | "rgb(r,g,b)" -> [r, g, b] (null if unparseable)
export function parseColor(c) {
  c = String(c || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return m[1].split("").map((x) => parseInt(x + x, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

// A token colour at opacity a, as an rgba() string. Unknown formats come back unchanged.
const alphaCache = new Map();
export function alpha(c, a) {
  const key = c + "|" + a;
  let v = alphaCache.get(key);
  if (v) return v;
  const rgb = parseColor(c);
  v = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : c;
  if (alphaCache.size > 2000) alphaCache.clear();
  alphaCache.set(key, v);
  return v;
}

// Linear mix of two token colours (t = 0 -> a, 1 -> b).
export function mix(a, b, t) {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return t < 0.5 ? a : b;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── maths ───────────────────────────────────────────────────────────────
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// Characters typed in `ms` -> wpm (5 characters per word).
export function wpmOf(chars, ms) {
  return ms > 0 ? (chars / 5) / (ms / 60000) : 0;
}

// Accent-tolerant comparison: with lenient accents a typed base letter matches its accented target (e for é).
export function baseChar(c) {
  return String(c).normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function charMatches(expected, typed, lenient) {
  if (expected === typed) return true;
  return !!lenient && baseChar(expected) === typed;
}
// Does `typed` match the start of `word` (character by character, accent rule applied)?
export function prefixMatches(word, typed, lenient) {
  if (typed.length > word.length) return false;
  for (let i = 0; i < typed.length; i++) if (!charMatches(word[i], typed[i], lenient)) return false;
  return true;
}

// Deterministic PRNG for tests; games use Math.random.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(list, rand = Math.random) {
  return list[Math.floor(rand() * list.length)];
}

// Game words: single tokens, no spaces, at least 2 characters, de-duplicated.
export function cleanWords(list) {
  const out = [], seen = new Set();
  for (const w of list || []) {
    if (typeof w !== "string") continue;
    const t = w.trim();
    if (t.length < 2 || /\s/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Best score for a game from its saved runs; order 'asc' means lower is better.
export function bestOf(entries, order) {
  let best = null;
  for (const e of entries || []) {
    const s = e && typeof e.score === "number" ? e.score : null;
    if (s == null || !isFinite(s)) continue;
    if (best == null || (order === "asc" ? s < best : s > best)) best = s;
  }
  return best;
}

// ── stage ───────────────────────────────────────────────────────────────
// A canvas that fills its host's width with height = width / ratio (clamped), crisp on HiDPI.
export function createStage(host, { ratio = 16 / 9, minH = 300, maxH = 640 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "p2-canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const st = { canvas, ctx, w: 0, h: 0, dpr: 1, listeners: [] };
  function resize() {
    const w = Math.max(280, Math.floor(host.clientWidth || 800));
    const h = Math.round(clamp(w / ratio, minH, maxH));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === st.w && h === st.h && dpr === st.dpr) return;
    st.w = w; st.h = h; st.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const fn of st.listeners) fn(w, h);
  }
  let ro = null;
  if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(resize); ro.observe(host); }
  window.addEventListener("resize", resize);
  resize();
  st.resize = resize;
  st.onResize = (fn) => { st.listeners.push(fn); };
  st.destroy = () => { if (ro) ro.disconnect(); window.removeEventListener("resize", resize); canvas.remove(); };
  return st;
}

// ── loop ────────────────────────────────────────────────────────────────
// frame(dt seconds, now ms). rAF when it fires; a setTimeout watchdog keeps the game running where rAF
// is throttled to nothing (embedded previews). dt is clamped so a stall never teleports anything.
export function createLoop(frame) {
  let on = false, raf = 0, to = 0, last = 0;
  function step() {
    if (!on) return;
    cancelAnimationFrame(raf); clearTimeout(to);
    const now = performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    try { frame(dt, now); } catch (err) { console.error("[games] frame failed", err); }
    schedule();
  }
  function schedule() {
    if (!on) return;
    raf = requestAnimationFrame(step);
    to = setTimeout(step, 34); // only wins when rAF is not firing
  }
  return {
    start() { if (on) return; on = true; last = performance.now(); schedule(); },
    stop() { on = false; cancelAnimationFrame(raf); clearTimeout(to); },
    get running() { return on; },
  };
}

// ── particles ───────────────────────────────────────────────────────────
// A small fixed pool of square sparks; the oldest is recycled when full, so bursts never pile up.
export class Particles {
  constructor(max = 240) { this.max = max; this.list = []; }
  burst(x, y, { n = 14, color = "#fff", speed = 160, life = 0.6, size = 3, spread = Math.PI * 2, dir = 0, gravity = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random() * 0.65);
      const p = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, t: life * (0.6 + Math.random() * 0.4), size: size * (0.6 + Math.random() * 0.7), color, g: gravity };
      if (this.list.length >= this.max) this.list.shift();
      this.list.push(p);
    }
  }
  update(dt) {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t -= dt;
      if (p.t <= 0) continue;
      p.vx *= 1 - 2.2 * dt; p.vy = p.vy * (1 - 2.2 * dt) + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      L[j++] = p;
    }
    L.length = j;
  }
  draw(ctx) {
    for (const p of this.list) {
      const k = p.t / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * k);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
  clear() { this.list.length = 0; }
}

// ── drawing helpers ─────────────────────────────────────────────────────
export function font(pal, px, weight = 500) {
  return `${weight} ${Math.round(px)}px ${pal.font}`;
}

// Draw `word` centred at x with the first `n` characters in `hi` and the rest in `lo`. Returns its width.
export function drawTypedWord(ctx, word, n, x, y, hi, lo, { align = "center" } = {}) {
  const full = ctx.measureText(word).width;
  const left = align === "center" ? x - full / 2 : align === "right" ? x - full : x;
  const saved = ctx.textAlign;
  ctx.textAlign = "left";
  const head = word.slice(0, n), tail = word.slice(n);
  if (head) { ctx.fillStyle = hi; ctx.fillText(head, left, y); }
  if (tail) { ctx.fillStyle = lo; ctx.fillText(tail, left + ctx.measureText(head).width, y); }
  ctx.textAlign = saved;
  return full;
}

// Thin-edged square box, optionally filled and glowing.
export function box(ctx, x, y, w, h, { stroke, fill, glow = 0, glowColor, lw = 1 } = {}) {
  if (glow) { ctx.shadowBlur = glow; ctx.shadowColor = glowColor || stroke || fill; }
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1); }
  if (glow) ctx.shadowBlur = 0;
}

// The shared backdrop: token background plus a faint square grid.
export function backdrop(ctx, w, h, pal, { grid = 40, offsetY = 0 } = {}) {
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = alpha(pal.edge, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = (w / 2) % grid; x < w; x += grid) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
  const oy = ((offsetY % grid) + grid) % grid;
  for (let y = oy; y < h; y += grid) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
  ctx.stroke();
  const g = ctx.createRadialGradient(w / 2, -h * 0.1, 0, w / 2, -h * 0.1, h * 0.9);
  g.addColorStop(0, alpha(pal.main, 0.1));
  g.addColorStop(1, alpha(pal.main, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ── word pools ──────────────────────────────────────────────────────────
// { lang, common, rare, lenient } for the chosen language; never throws (words.js falls back).
export async function loadPools() {
  const lang = settings.get("lang") || "en";
  const lenient = settings.get("accents") !== "strict";
  const [common, rare] = await Promise.all([words.list(lang, "common-1k"), words.list(lang, "rare")]);
  const c = cleanWords(common);
  let r = cleanWords(rare);
  if (r.length < 30) r = c.filter((w) => w.length >= 7);
  if (r.length < 10) r = c.slice();
  return { lang, common: c.length ? c : cleanWords(words.FALLBACK), rare: r, lenient };
}

// ── shell ───────────────────────────────────────────────────────────────
// Owns the frame around a canvas game: start screen, pause, end screen, keys, loop and saving.
// game = { id, name, rules, order ('desc'|'asc'), fmt(score) -> string, ratio, minH, maxH,
//          init(shell) once, reset() before each run, start() when play begins, update(dt), draw(g),
//          key(e) during play, idle?(dt) every frame when not playing }
// shell.end(score, meta, lines[]) finishes the run: saves it and shows the end screen.
export function createShell(root, game, opts) {
  const wrap = document.createElement("div");
  wrap.className = `p2 p2-${game.id}`;
  const stageEl = document.createElement("div");
  stageEl.className = "p2-stage";
  const overlay = document.createElement("div");
  overlay.className = "p2-overlay";
  wrap.appendChild(stageEl);
  root.replaceChildren(wrap);
  const stage = createStage(stageEl, { ratio: game.ratio, minH: game.minH, maxH: game.maxH });
  stageEl.appendChild(overlay);
  let pal = palette();
  const particles = new Particles(game.maxParticles || 260);
  const shell = {
    state: "loading", stage, particles, root: wrap, stageEl,
    get pal() { return pal; },
    time: 0, // seconds of play in this run
    shake: 0,
    order: game.order === "asc" ? "asc" : "desc",
    best() { return bestOf(store.gameScores(game.id), this.order); },
    end, pause, resume, restart, start,
  };
  const fmt = game.fmt || ((s) => String(s));
  // ?speed=0.1 slows the clock for looking at a game with slow scripted input; such runs are not saved.
  const speed = clamp(Number(opts && opts.speed) || 1, 0.02, 1);
  shell.speed = speed;

  function screen(html) {
    overlay.innerHTML = html;
    overlay.hidden = false;
  }
  function hideScreen() { overlay.hidden = true; overlay.innerHTML = ""; }

  function showStart() {
    shell.state = "ready";
    const best = shell.best();
    screen(`<div class="p2-card">
      <div class="p2-title">${esc(game.name)}</div>
      <div class="p2-rules">${esc(game.rules)}</div>
      <div class="p2-best"><span class="p2-label">best</span><span class="p2-val">${best == null ? "&#8212;" : esc(fmt(best))}</span></div>
      <div class="p2-press"><kbd>space</kbd> to start</div>
      <div class="p2-keys">esc pauses &middot; esc twice restarts</div>
    </div>`);
  }

  function start() {
    hideScreen();
    particles.clear();
    shell.time = 0;
    shell.state = "play";
    if (game.start) game.start();
  }

  function restart() {
    if (game.reset) game.reset();
    particles.clear();
    showStart();
  }

  function pause() {
    if (shell.state !== "play") return;
    shell.state = "pause";
    screen(`<div class="p2-card p2-small">
      <div class="p2-title">paused</div>
      <div class="p2-press"><kbd>space</kbd> resume &middot; <kbd>esc</kbd> restart</div>
      <a class="p2-link" href="#/games">&larr; all games</a>
    </div>`);
  }
  function resume() {
    if (shell.state !== "pause") return;
    hideScreen();
    shell.state = "play";
  }

  let overAt = 0;
  function end(score, meta = {}, lines = []) {
    if (shell.state === "over") return;
    const prev = shell.best();
    shell.state = "over";
    overAt = performance.now();
    let saved = false;
    if (score != null && isFinite(score) && speed === 1) {
      const m = Object.assign({ lang: pools && pools.lang }, meta);
      if (shell.order === "asc") m.order = "asc";
      store.addGameScore(game.id, score, m);
      saved = true;
    }
    if (speed !== 1) lines = lines.concat([["clock", "x" + speed + " not saved"]]);
    const isBest = saved && (prev == null || (shell.order === "asc" ? score < prev : score > prev));
    const best = shell.best();
    screen(`<div class="p2-card p2-end">
      <div class="p2-title">${esc(meta.won === false && game.lostTitle ? game.lostTitle : meta.won === true && game.wonTitle ? game.wonTitle : "game over")}</div>
      <div class="p2-score${isBest ? " p2-new" : ""}"><span class="p2-label">${esc(game.scoreLabel || "score")}</span>
        <span class="p2-big">${score == null || !isFinite(score) ? "&#8212;" : esc(fmt(score))}</span>
        ${isBest ? `<span class="p2-pb">new best</span>` : ""}</div>
      <div class="p2-stats">
        ${lines.map(([k, v]) => `<div><span class="p2-label">${esc(k)}</span><span class="p2-val">${esc(v)}</span></div>`).join("")}
        <div><span class="p2-label">best</span><span class="p2-val">${best == null ? "&#8212;" : esc(fmt(best))}</span></div>
      </div>
      <div class="p2-actions"><button class="p2-btn" data-act="retry">&#8635; retry <kbd>space</kbd></button>
        <a class="p2-link" href="#/games">&larr; all games</a></div>
    </div>`);
    const b = overlay.querySelector('[data-act="retry"]');
    if (b) b.addEventListener("click", () => { restart(); start(); });
  }

  function onKey(e) {
    if (keys.inField(e)) return;
    const k = e.key;
    if (shell.state === "loading") return;
    if (shell.state === "ready") {
      if (k === " " || k === "Enter") { e.preventDefault(); start(); }
      return;
    }
    if (shell.state === "pause") {
      if (k === " " || k === "Enter") { e.preventDefault(); resume(); }
      else if (k === "Escape") { e.preventDefault(); restart(); }
      return;
    }
    if (shell.state === "over") {
      // a short guard so the last keystroke of a run doesn't skip the end screen
      if (performance.now() - overAt < 600) { if (k.length === 1) e.preventDefault(); return; }
      if (k === " " || k === "Enter" || k === "Escape") { e.preventDefault(); restart(); start(); }
      return;
    }
    // play
    if (k === "Escape") { e.preventDefault(); if (!e.repeat) pause(); return; }
    const altGr = e.ctrlKey && e.altKey;
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
    if (k.length === 1 || k === "Backspace" || k === "Enter") e.preventDefault();
    if (game.key) game.key(e);
  }

  function onVisibility() { if (document.hidden) pause(); }
  const offSettings = [];

  const loop = createLoop((dt) => {
    dt *= speed;
    if (shell.state === "play") {
      shell.time += dt;
      if (game.update) game.update(dt);
    } else if (game.idle) game.idle(dt);
    particles.update(dt);
    shell.shake = Math.max(0, shell.shake - dt * 30);
    const ctx = stage.ctx;
    ctx.save();
    if (shell.shake > 0.1) ctx.translate((Math.random() - 0.5) * shell.shake, (Math.random() - 0.5) * shell.shake);
    if (game.draw) game.draw(ctx, stage.w, stage.h, pal);
    ctx.restore();
  });

  let pools = null;
  const removeKeys = keys.set(onKey);
  document.addEventListener("visibilitychange", onVisibility);
  stage.onResize(() => { if (game.resize) game.resize(stage.w, stage.h); });

  shell.ready = (async () => {
    pools = await loadPools();
    if (shell.state === "gone") return;
    shell.pools = pools;
    try { if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load(font(pal, 20)), new Promise((r) => setTimeout(r, 800))]); } catch { /* ignore */ }
    pal = palette();
    if (shell.state === "gone") return;
    if (game.init) await game.init(shell);
    if (game.reset) game.reset();
    if (game.resize) game.resize(stage.w, stage.h);
    showStart();
    loop.start();
  })();

  shell.destroy = () => {
    loop.stop();
    removeKeys();
    document.removeEventListener("visibilitychange", onVisibility);
    offSettings.forEach((f) => f());
    stage.destroy();
    wrap.remove();
    shell.state = "gone";
  };
  return shell;
}

// Standard view module for a pack-2 game: { mount, unmount } around createShell.
export function gameView(makeGame) {
  let shell = null;
  return {
    async mount(root, ctx) {
      await loadCss("css/games-pack2.css");
      shell = createShell(root, makeGame(), { speed: ctx && ctx.query && ctx.query.speed });
      await shell.ready;
    },
    unmount() {
      if (shell) shell.destroy();
      shell = null;
    },
  };
}
