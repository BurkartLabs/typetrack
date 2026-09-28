// Chain combo: 60 seconds. Every word faster than the target (your recent average, rising over the minute)
// and without a wrong key grows the multiplier by one. A slow word or a wrong key resets it to x1.
import store from "../../core/store.js";
import { defineGame, Stream, fmt, pulse } from "./pack1-kit.js";
import { CHAIN, chainTarget, chainWord, wpmFrom, accuracy, recentAvgWpm, pickWord } from "./pack1-logic.js";

export default defineGame({
  id: "chain-combo",
  name: "chain combo",
  unit: "pts",
  rules: "60 seconds. Each clean word faster than your average grows the multiplier; one slow or wrong word resets it.",
  hud: [["score", "points"], ["target", "target"], ["combo", "best combo"], ["time", "time"]],

  startExtra(g) {
    const a = recentAvgWpm(store.results(), 10, g.lang);
    return `<p class="p1-rules" style="color:var(--sub);font-size:.8rem">target: ${a ? "your last-10 average, " + Math.round(a) + " wpm" : CHAIN.fallback + " wpm (no test results yet)"}, rising 10% over the minute</p>`;
  },

  build(g) {
    const el = document.createElement("div");
    g.stream = new Stream((i, prev) => pickWord(g.pool, g.rng, prev));
    el.innerHTML = `<div class="p1-timebar"><div class="p1-bar"><i></i></div></div>`;
    el.appendChild(g.stream.el);
    el.insertAdjacentHTML("beforeend", `
      <div class="p1-combo"><div class="p1-mult">x1</div><div class="p1-last"><div>last word <b class="p1-lw">-</b></div><div>target <b class="p1-tg">-</b></div></div></div>
      <div class="p1-hint">start typing &middot; the minute starts on your first key</div>`);
    g.timeFill = el.querySelector(".p1-timebar i");
    g.multEl = el.querySelector(".p1-mult");
    g.lastEl = el.querySelector(".p1-lw");
    g.tgEl = el.querySelector(".p1-tg");
    g.floatHost = el;
    return el;
  },

  reset(g) {
    g.stream.reset();
    g.base = recentAvgWpm(store.results(), 10, g.lang) || CHAIN.fallback;
    g.chain = { mult: 1, streak: 0, best: 0, points: 0 };
    g.clean = true; g.wordStart = 0; g.freeFirst = true; g.ok = 0; g.miss = 0; g.words = 0; g.hits = 0;
    g.timeFill.style.transform = "scaleX(1)";
    g.multEl.textContent = "x1";
    g.multEl.classList.remove("big");
    g.lastEl.textContent = "-"; g.lastEl.className = "p1-lw";
    g.target = chainTarget(g.base, 0);
    g.tgEl.textContent = fmt(g.target, 0) + " wpm";
    g.hud("score", 0); g.hud("combo", 0); g.hud("target", fmt(g.target, 0)); g.hud("time", "60");
  },

  key(g, k, t) {
    const r = g.stream.type(k, g.match);
    if (!r.ok) {
      if (!g.started) return;
      g.miss++;
      g.clean = false;
      if (g.chain.streak > 0) { g.chain = Object.assign({}, g.chain, { mult: 1, streak: 0 }); breakChain(g); }
      return;
    }
    if (!g.started) { g.go(t); g.wordStart = t; }
    g.ok++;
    if (r.done < 0) return;
    const word = g.stream.words[r.done];
    const chars = g.freeFirst ? word.length : word.length + 1;
    g.freeFirst = false;
    const wpm = wpmFrom(chars, t - g.wordStart);
    g.target = chainTarget(g.base, t - g.t0);
    const before = g.chain.streak;
    g.chain = chainWord(g.chain, { chars: word.length + 1, wpm, clean: g.clean }, g.target);
    g.words++;
    if (g.chain.hit) g.hits++;
    g.wordStart = t;
    g.clean = true;
    g.lastEl.textContent = fmt(wpm, 0) + " wpm";
    g.lastEl.className = "p1-lw " + (g.chain.hit ? "hit" : "miss");
    g.hud("score", g.chain.points);
    g.hud("combo", g.chain.best);
    if (g.chain.hit) {
      g.multEl.textContent = "x" + g.chain.mult;
      g.multEl.classList.toggle("big", g.chain.mult >= 10);
      pulse(g.multEl, "p1-pop");
      floatText(g, "+" + g.chain.gained);
    } else if (before > 0) breakChain(g);
  },

  frame(g, t) {
    if (!g.started) return;
    const ms = t - g.t0;
    const left = Math.max(0, CHAIN.duration - ms);
    g.timeFill.style.transform = `scaleX(${(left / CHAIN.duration).toFixed(4)})`;
    g.target = chainTarget(g.base, ms);
    g.tgEl.textContent = fmt(g.target, 0) + " wpm";
    g.hud("target", fmt(g.target, 0));
    g.hud("time", fmt(Math.ceil(left / 1000), 0));
    if (left <= 0) {
      const wpm = Math.round(wpmFrom(g.stream.pos, CHAIN.duration));
      const acc = accuracy(g.ok, g.miss);
      g.finish(g.chain.points, { wpm, acc, bestCombo: g.chain.best, words: g.words, hits: g.hits, base: Math.round(g.base) }, {
        title: "time",
        stats: [["best combo", String(g.chain.best)], ["wpm", String(wpm)], ["acc", acc + "%"], ["fast words", g.hits + "/" + g.words]],
      });
    }
  },
});

function breakChain(g) {
  g.multEl.textContent = "x1";
  g.multEl.classList.remove("big");
  pulse(g.multEl, "p1-broke");
}

function floatText(g, text) {
  const f = document.createElement("div");
  f.className = "p1-float";
  f.textContent = text;
  g.floatHost.appendChild(f);
  g.after(700, () => f.remove());
}
