// Typing racer. Four cars on a side-view track: yours moves with every correct character of a passage of
// common words, the other three hold your PB, PB+10 and PB-10 (100/110/90 with no history). Countdown,
// finish order, score = your wpm; meta.won when you cross the line first.
import { gameView, alpha, clamp, font, backdrop, box, wpmOf } from "./lib/canvas.js";
import { createTyping } from "../../core/typing.js";
import store from "../../core/store.js";

// ── pure rules ──────────────────────────────────────────────────────────
// Best wpm from saved word-list tests (time/words modes; quotes and custom text excluded). null if none.
export function racerPB(results) {
  let best = null;
  for (const r of results || []) {
    if (!r || typeof r.wpm !== "number" || !isFinite(r.wpm)) continue;
    if (r.mode === "text" || (r.source && r.source !== "words")) continue;
    if (best == null || r.wpm > best) best = r.wpm;
  }
  return best;
}
export function racerOpponents(pb) {
  const base = pb == null ? 100 : Math.round(pb);
  return [
    { name: "pb+10", wpm: base + 10 },
    { name: "pb", wpm: base },
    { name: "pb-10", wpm: Math.max(10, base - 10) },
  ];
}
// Characters of the passage (spaces included) that count as done: finished correct words + correct prefix.
export function racerDone(words, typed, index) {
  let n = 0;
  for (let i = 0; i < index && i < words.length; i++) if (typed[i] === words[i]) n += words[i].length + 1;
  const w = words[index] || "", t = typed[index] || "";
  let k = 0;
  while (k < t.length && k < w.length && t[k] === w[k]) k++;
  return n + k;
}
export function racerTotal(words) {
  return words.reduce((a, w) => a + w.length + 1, 0) - 1;
}
// Seconds for a steady `wpm` to cover `chars`.
export function racerTime(chars, wpm) {
  return wpm > 0 ? (chars * 12) / wpm : Infinity;
}
// 1-based place for a finish time among opponent finish times (ties go to you).
export function racerPlace(mine, others) {
  return 1 + others.filter((t) => t < mine).length;
}

const WORDS = 55;
const COUNT = 3; // seconds of countdown

function makeGame() {
  let shell, typing = null, passage;
  let W = 800, H = 360, phase = "idle", count = 0, raceT = 0, endT = 0, scroll = 0, speedNow = 0, liveWpm = 0;
  let total = 1, done = 0, myFinish = null, result = null, opp = [], words = [];

  const game = {
    id: "typing-racer", name: "typing racer", order: "desc", ratio: 16 / 7, minH: 260, maxH: 420,
    rules: "Race three cars set to your PB, PB+10 and PB-10. Your car moves with every correct letter. Cross the line first.",
    scoreLabel: "your wpm", wonTitle: "you win", lostTitle: "race over",
    fmt: (s) => String(Math.round(s)),
    init(s) {
      shell = s;
      passage = document.createElement("div");
      passage.className = "p2-passage p2-locked";
      shell.root.appendChild(passage);
    },
    resize(w, h) { W = w; H = h; },
    reset() {
      opp = racerOpponents(racerPB(store.results())).map((o) => Object.assign(o, { p: 0, finish: null, lane: 0 }));
      phase = "idle"; count = COUNT; raceT = 0; endT = 0; done = 0; myFinish = null; result = null; speedNow = 0; liveWpm = 0;
      const opts = { words: shell.pools.common, mode: "words", wordCount: WORDS, lang: shell.pools.lang, keys: false, hideCounter: false, width: 1100,
        onFinish: (r) => { result = r; } };
      if (typing) typing.restart(opts); else typing = createTyping(passage, opts);
      words = typing.test.words.slice(0, WORDS);
      total = racerTotal(words);
      opp.forEach((o, i) => { o.time = racerTime(total, o.wpm); o.lane = i < 1 ? 0 : i + 1; });
      passage.classList.add("p2-locked");
    },
    start() { game.reset(); phase = "count"; },
    update(dt) {
      if (phase === "count") {
        count -= dt;
        if (count <= 0) { phase = "race"; passage.classList.remove("p2-locked"); }
        return;
      }
      raceT += dt;
      const t = typing.test;
      const prev = done;
      done = racerDone(t.words, t.typed, t.index);
      liveWpm = raceT > 0.5 ? wpmOf(done, raceT * 1000) : 0;
      speedNow = speedNow * 0.9 + (done - prev) / Math.max(dt, 1e-3) * 0.1;
      scroll += dt * (40 + speedNow * 14);
      for (const o of opp) {
        o.p = clamp(raceT / o.time, 0, 1);
        if (o.p >= 1 && o.finish == null) o.finish = o.time;
      }
      if (result && myFinish == null) {
        myFinish = raceT;
        done = total;
        shell.particles.burst(trackX(1), laneY(1), { n: 26, color: shell.pal.caret, speed: 220 });
      }
      if (myFinish != null) {
        endT += dt;
        if (endT > 1.1) finish();
      }
    },
    idle(dt) { scroll += dt * 20; },
    key(e) {
      if (phase !== "race" || myFinish != null || e.key === "Tab") return;
      typing.handleKey(e);
    },
    draw(ctx, w, h, pal) { draw(ctx, w, h, pal); },
  };

  function finish() {
    const place = racerPlace(myFinish, opp.map((o) => o.time));
    const r = result;
    shell.end(r.wpm, { wpm: r.wpm, acc: r.acc, won: place === 1, place }, [
      ["place", place + " / 4"], ["acc", r.acc + "%"], ["time", myFinish.toFixed(1) + "s"],
      ["pb car", opp[1].wpm + " wpm"],
    ]);
    passage.classList.add("p2-locked");
  }

  const LANES = 4;
  function trackTop() { return H * 0.2; }
  function laneH() { return (H * 0.72) / LANES; }
  function laneY(i) { return trackTop() + laneH() * (i + 0.5); }
  function trackX(p) { const a = W * 0.07, b = W * 0.9; return a + (b - a) * p; }

  function draw(ctx, w, h, pal) {
    backdrop(ctx, w, h, pal, { grid: 48 });
    const top = trackTop(), lh = laneH();
    // track surface with scrolling lane dashes
    ctx.fillStyle = alpha(pal.subAlt, 0.9);
    ctx.fillRect(0, top, w, lh * LANES);
    ctx.fillStyle = pal.edge;
    ctx.fillRect(0, top, w, 1); ctx.fillRect(0, top + lh * LANES, w, 1);
    ctx.fillStyle = alpha(pal.sub, 0.35);
    const dash = 28, gap = 22, off = -(scroll % (dash + gap));
    for (let i = 1; i < LANES; i++) {
      const y = Math.round(top + lh * i);
      for (let x = off; x < w; x += dash + gap) ctx.fillRect(x, y, dash, 1);
    }
    // distance ticks
    ctx.fillStyle = alpha(pal.sub, 0.6);
    ctx.font = font(pal, clamp(w / 90, 9, 11));
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let k = 0; k <= 4; k++) {
      const x = trackX(k / 4);
      ctx.fillRect(Math.round(x), top + lh * LANES, 1, 6);
      ctx.fillText(k === 0 ? "start" : k === 4 ? "finish" : k * 25 + "%", x, top + lh * LANES + 9);
    }
    // start line and chequered finish
    ctx.fillStyle = alpha(pal.text, 0.25);
    ctx.fillRect(Math.round(trackX(0)), top, 1, lh * LANES);
    const fx = Math.round(trackX(1)), cs = 6;
    for (let y = 0; y < lh * LANES; y += cs) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = ((y / cs + c) % 2) ? alpha(pal.text, 0.75) : alpha(pal.bg, 0.9);
      ctx.fillRect(fx + c * cs, top + y, cs, Math.min(cs, lh * LANES - y));
    }
    // cars: lane 1 is yours
    const me = phase === "idle" ? 0 : clamp(done / total, 0, 1);
    for (const o of opp) car(ctx, pal, trackX(o.p), laneY(o.lane), lh, false, o);
    car(ctx, pal, trackX(me), laneY(1), lh, true, null);
    shell.particles.draw(ctx);
    hud(ctx, w, h, pal);
    if (phase === "count") countdown(ctx, w, h, pal);
    else if (phase === "race" && raceT < 0.7) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = font(pal, clamp(w / 10, 40, 90), 700);
      ctx.fillStyle = alpha(pal.caret, 1 - raceT / 0.7);
      ctx.fillText("GO", w / 2, h / 2);
    }
  }

  function car(ctx, pal, x, y, lh, mine, o) {
    const L = clamp(lh * 1.6, 36, 64), T = clamp(lh * 0.42, 12, 22);
    const nose = x, tail = x - L;
    const moving = mine ? speedNow > 2 : phase === "race" && o.p < 1;
    if (moving) {
      // speed streaks behind the car
      ctx.fillStyle = alpha(mine ? pal.caret : pal.sub, 0.5);
      const n = mine ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const len = (mine ? clamp(speedNow * 2.2, 8, 70) : 22) * (0.5 + ((i * 37 + Math.floor(scroll)) % 10) / 20);
        ctx.fillRect(tail - len - 4, y - T / 2 + 3 + i * (T - 6) / Math.max(1, n - 1), len, 1);
      }
    }
    const body = mine ? pal.main : pal.subAlt;
    box(ctx, tail, y - T / 2, L, T, { fill: body, stroke: mine ? pal.caret : pal.sub, glow: mine ? 16 : 0, glowColor: pal.caret });
    // cabin
    ctx.fillStyle = mine ? alpha(pal.bg, 0.55) : alpha(pal.sub, 0.35);
    ctx.fillRect(tail + L * 0.42, y - T / 2 + 3, L * 0.28, T - 6);
    // wheels
    ctx.fillStyle = mine ? pal.text : pal.sub;
    const ws = Math.max(4, T * 0.28);
    for (const k of [0.18, 0.72]) {
      ctx.fillRect(tail + L * k, y - T / 2 - ws * 0.55, ws * 1.6, ws * 0.55);
      ctx.fillRect(tail + L * k, y + T / 2, ws * 1.6, ws * 0.55);
    }
    // tail light / head light
    ctx.fillStyle = mine ? pal.text : pal.caret;
    ctx.fillRect(tail, y - 2, 2, 4);
    // label
    ctx.font = font(pal, clamp(lh * 0.24, 9, 12), 500);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const lx = Math.min(nose + 8, W - 60);
    ctx.fillStyle = mine ? pal.caret : pal.sub;
    const label = mine ? "you " + Math.round(liveWpm) : `${o.name} ${o.wpm}`;
    if (nose + 8 + 60 < trackX(1) || !mine) ctx.fillText(label, lx, y);
    if (o && o.finish != null) {
      ctx.fillStyle = pal.text;
      ctx.fillText(ordinal(1 + opp.filter((q) => q.finish != null && q.finish < o.finish).length + (myFinish != null && myFinish <= o.finish ? 1 : 0)), trackX(1) + 18, y);
    }
    if (mine && myFinish != null) {
      ctx.fillStyle = pal.caret;
      ctx.fillText(ordinal(racerPlace(myFinish, opp.map((q) => q.time))), trackX(1) + 18, y);
    }
  }

  function ordinal(n) { return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"); }

  function hud(ctx, w, h, pal) {
    const s = clamp(w / 70, 11, 14);
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = font(pal, s * 0.85);
    ctx.fillStyle = pal.sub;
    ctx.fillText("WPM", 16, 12); ctx.fillText("TIME", 110, 12); ctx.fillText("PASSAGE", 200, 12);
    ctx.font = font(pal, s * 1.6, 700);
    ctx.fillStyle = pal.caret; ctx.fillText(String(Math.round(liveWpm)), 16, 12 + s * 1.2);
    ctx.fillStyle = pal.text;
    ctx.fillText(raceT.toFixed(1), 110, 12 + s * 1.2);
    ctx.fillText(Math.round((done / total) * 100) + "%", 200, 12 + s * 1.2);
  }

  function countdown(ctx, w, h, pal) {
    const n = Math.ceil(count);
    const k = count - Math.floor(count); // 1 -> 0 within each second
    ctx.fillStyle = alpha(pal.bg, 0.45);
    ctx.fillRect(0, 0, w, h);
    const size = 22, gap = 12, x0 = w / 2 - (size * 3 + gap * 2) / 2, y0 = h / 2 - size * 2.2;
    for (let i = 0; i < 3; i++) {
      const lit = COUNT - n >= i;
      box(ctx, x0 + i * (size + gap), y0, size, size, { fill: lit ? pal.main : null, stroke: lit ? pal.caret : pal.sub, glow: lit ? 18 : 0, glowColor: pal.caret });
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = font(pal, clamp(w / 10, 40, 90) * (0.85 + 0.15 * k), 700);
    ctx.fillStyle = alpha(pal.text, 0.4 + 0.6 * k);
    ctx.fillText(String(n), w / 2, h / 2 + size * 0.8);
  }

  return Object.assign(game, {
    destroy() { if (typing) typing.destroy(); },
  });
}

export default gameView(makeGame);
