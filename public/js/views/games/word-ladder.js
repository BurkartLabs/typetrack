// Word ladder: one word per rung, each with a time window 3% shorter than the last. One missed window
// ends the climb. Wrong keys don't end it; they just cost time.
import { defineGame, BigWord, fmt, pulse } from "./pack1-kit.js";
import { LADDER, ladderWindow, ladderNeed, wpmFrom, accuracy, pickWord } from "./pack1-logic.js";

const VISIBLE_RUNGS = 40;

export default defineGame({
  id: "word-ladder",
  name: "word ladder",
  unit: "rungs",
  rules: "One word per rung. Every rung's time window is 3% shorter than the last. Miss one window and you fall.",
  hud: [["score", "rung"], ["window", "window"], ["need", "need"], ["wpm", "wpm"]],

  build(g) {
    const el = document.createElement("div");
    el.className = "p1-ladder-wrap";
    el.innerHTML = `
      <div class="p1-rungs"><div class="p1-rails"></div><div class="p1-rungset"></div><div class="p1-climber"></div></div>
      <div class="p1-ladder-main"></div>`;
    g.rungset = el.querySelector(".p1-rungset");
    g.rungset.innerHTML = Array.from({ length: VISIBLE_RUNGS }, () => `<div class="p1-rung"></div>`).join("");
    g.big = new BigWord();
    const main = el.querySelector(".p1-ladder-main");
    main.appendChild(g.big.el);
    main.insertAdjacentHTML("beforeend", `
      <div class="p1-barwrap"><div class="p1-bar"><i></i></div>
        <div class="p1-barnote"><span class="p1-winms"></span><span class="p1-needn"></span></div></div>`);
    el.insertAdjacentHTML("beforeend", `<div class="p1-hint">start typing &middot; the clock starts on your first key</div>`);
    g.bar = main.querySelector(".p1-bar");
    g.fill = g.bar.firstElementChild;
    g.winNote = main.querySelector(".p1-winms");
    g.needNote = main.querySelector(".p1-needn");
    return el;
  },

  reset(g) {
    g.rung = 0; g.ok = 0; g.miss = 0; g.chars = 0; g.freeFirst = true;
    g.word = pickWord(g.pool, g.rng, null);
    g.next = pickWord(g.pool, g.rng, g.word);
    arm(g, 0);
    drawRungs(g);
    g.hud("score", 0); g.hud("wpm", "-");
  },

  key(g, k, t) {
    const r = g.big.type(k, g.match);
    if (r === "skip") return;
    if (r === "bad") { if (g.started) { g.miss++; pulse(g.bar, "p1-shake"); } return; }
    if (!g.started) { g.go(t); g.start = t; }
    g.ok++;
    if (r === "done") {
      g.rung++;
      g.chars += g.word.length + 1;
      g.freeFirst = false;
      g.hud("score", g.rung);
      g.hud("wpm", fmt(wpmFrom(g.chars, t - g.t0), 0));
      pulse(g.hudEls.score, "p1-pop");
      drawRungs(g);
      g.word = g.next;
      g.next = pickWord(g.pool, g.rng, g.word);
      arm(g, t);
    }
  },

  frame(g, t) {
    if (!g.started) return;
    const left = g.window - (t - g.start);
    const f = Math.max(0, left / g.window);
    g.fill.style.transform = `scaleX(${f.toFixed(3)})`;
    g.bar.classList.toggle("hot", f < 0.3);
    if (left <= 0) {
      g.big.boom();
      g.shake();
      const ms = t - g.t0;
      const wpm = Math.round(wpmFrom(g.chars, ms));
      g.finish(g.rung, { wpm, acc: accuracy(g.ok, g.miss), lastWindow: Math.round(g.window), lastNeed: Math.round(g.need) }, {
        title: "fell from rung " + g.rung,
        stats: [["last window", fmt(g.window, 0) + " ms"], ["it needed", fmt(g.need, 0) + " wpm"], ["wpm", String(wpm)], ["acc", accuracy(g.ok, g.miss) + "%"]],
      });
    }
  },
});

function arm(g, t) {
  g.window = ladderWindow(g.word, g.rung);
  g.need = ladderNeed(g.word, g.window);
  g.start = t;
  g.big.set(g.word, g.next);
  g.fill.style.transform = "scaleX(1)";
  g.bar.classList.remove("hot");
  g.winNote.textContent = fmt(g.window, 0) + " ms";
  g.needNote.textContent = fmt(g.need, 0) + " wpm";
  g.hud("window", fmt(g.window, 0));
  g.hud("need", fmt(g.need, 0));
}

// The ladder scrolls down as you climb: rungs below you are lit, the climber sits a few rungs from the bottom.
function drawRungs(g) {
  const kids = g.rungset.children;
  const shown = Math.max(0, g.rung - 3);
  for (let i = 0; i < kids.length; i++) {
    const n = VISIBLE_RUNGS - 1 - i + shown; // top of the list is the highest rung
    kids[i].classList.toggle("on", n < g.rung);
  }
  const climber = g.rungset.parentNode.querySelector(".p1-climber");
  climber.style.transform = `translateY(${-Math.min(g.rung, 3) * 18}px)`;
  if (g.rung > 3) pulse(g.rungset, "p1-scroll");
}
