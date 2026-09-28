// Survival: an endless line of common words. One wrong key ends the run. Words get longer the longer you last.
import { defineGame, Stream, fmt, pulse } from "./pack1-kit.js";
import { survivalMinLen, wpmFrom, pickWord } from "./pack1-logic.js";

export default defineGame({
  id: "survival",
  name: "survival",
  unit: "words",
  rules: "Endless words. A single wrong key ends the run. Every 20 words, the words get a letter longer.",
  hud: [["score", "words"], ["wpm", "wpm"], ["len", "min len"], ["time", "time"]],

  build(g) {
    const el = document.createElement("div");
    g.score = 0;
    g.stream = new Stream((i, prev) => pickWord(g.pool, g.rng, prev, survivalMinLen(i)));
    el.appendChild(g.stream.el);
    el.insertAdjacentHTML("beforeend", `<div class="p1-hint">start typing &middot; no mistakes</div>`);
    return el;
  },

  reset(g) {
    g.score = 0;
    g.stream.reset();
    g.hud("score", 0); g.hud("wpm", "-"); g.hud("len", survivalMinLen(0)); g.hud("time", "0");
  },

  key(g, k, t) {
    const r = g.stream.type(k, g.match);
    if (!r.ok) {
      if (!g.started) return; // a stray key before the run starts doesn't count
      g.stream.fail();
      g.shake();
      const ms = t - g.t0;
      const wpm = Math.round(wpmFrom(g.stream.pos, ms));
      const exp = g.stream.expected();
      g.finish(g.score, { wpm, acc: 100, ms: Math.round(ms), chars: g.stream.pos }, {
        title: "one slip",
        stats: [["wpm", String(wpm)], ["time", fmt(ms / 1000, 1) + "s"], ["wanted", exp === " " ? "space" : exp], ["typed", k === " " ? "space" : k]],
      });
      return;
    }
    g.go(t);
    if (r.done >= 0) {
      g.score = r.done + 1;
      g.hud("score", g.score);
      g.hud("len", survivalMinLen(g.score));
      if (g.score % 20 === 0) pulse(g.hudEls.len, "p1-pop");
    }
  },

  frame(g, t) {
    if (!g.started) return;
    const ms = t - g.t0;
    g.hud("wpm", fmt(wpmFrom(g.stream.pos, ms), 0));
    g.hud("time", fmt(ms / 1000, 0));
  },
});
