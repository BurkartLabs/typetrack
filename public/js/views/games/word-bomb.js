// Word bomb: one word at a time, each on a fuse sized to your running average speed (seeded from your best
// typing-test wpm). Beat the fuse or lose a life; the target creeps up with every word. Three lives.
import store from "../../core/store.js";
import { defineGame, BigWord, fmt, pulse } from "./pack1-kit.js";
import { BOMB, bombTarget, bombFuse, ema, wpmFrom, accuracy, bestWpm, pickWord } from "./pack1-logic.js";

const LIVES = 3;
const BOOM_PAUSE = 450;

export default defineGame({
  id: "word-bomb",
  name: "word bomb",
  unit: "words",
  rules: "Each word burns a fuse set to your running average speed, and the target rises as you clear. Miss a fuse and lose a life. Three lives.",
  hud: [["score", "cleared"], ["target", "target"], ["avg", "avg"], ["lives", "lives"]],

  startExtra(g) {
    const b = bestWpm(store.results(), g.lang);
    return `<p class="p1-rules" style="color:var(--sub);font-size:.8rem">first fuse: ${b ? "your best, " + Math.round(b) + " wpm" : BOMB.fallback + " wpm (no test results yet)"}</p>`;
  },

  build(g) {
    const el = document.createElement("div");
    g.big = new BigWord();
    el.appendChild(g.big.el);
    el.insertAdjacentHTML("beforeend", `
      <div class="p1-barwrap"><div class="p1-bar"><i></i></div>
        <div class="p1-barnote"><span class="p1-fusems"></span><span class="p1-need"></span></div></div>
      <div class="p1-hint">start typing &middot; the first fuse lights on your first key</div>`);
    g.bar = el.querySelector(".p1-bar");
    g.fill = g.bar.firstElementChild;
    g.fuseNote = el.querySelector(".p1-fusems");
    g.needNote = el.querySelector(".p1-need");
    return el;
  },

  reset(g) {
    g.base = bestWpm(store.results(), g.lang) || BOMB.fallback;
    g.avg = g.base; g.cleared = 0; g.lives = LIVES; g.ok = 0; g.miss = 0; g.chars = 0; g.pauseUntil = 0; g.pending = false; g.freeFirst = true;
    g.word = pickWord(g.pool, g.rng, null);
    g.next = pickWord(g.pool, g.rng, g.word);
    arm(g, 0);
    g.hud("score", 0); g.hud("lives", hearts(g.lives)); g.hud("avg", fmt(g.avg, 0));
  },

  key(g, k, t) {
    if (t < g.pauseUntil) return;
    const r = g.big.type(k, g.match);
    if (r === "skip") return;
    if (r === "bad") { if (g.started) { g.miss++; g.shake(); } return; }
    if (!g.started) { g.go(t); g.fuseStart = t; }
    g.ok++;
    if (r === "done") {
      const ms = t - g.fuseStart;
      // the first word's clock starts on its first letter, so that letter is free
      const chars = g.freeFirst ? g.word.length - 1 : g.word.length + 1;
      g.freeFirst = false;
      g.avg = ema(g.avg, wpmFrom(chars, ms));
      g.cleared++;
      g.chars += g.word.length + 1;
      g.hud("score", g.cleared);
      g.hud("avg", fmt(g.avg, 0));
      pulse(g.hudEls.score, "p1-pop");
      advance(g, t);
    }
  },

  frame(g, t) {
    if (!g.started || t < g.pauseUntil) return;
    if (g.pending) { g.pending = false; advance(g, t); }
    const left = g.fuse - (t - g.fuseStart);
    const f = Math.max(0, left / g.fuse);
    g.fill.style.transform = `scaleX(${f.toFixed(3)})`;
    g.bar.classList.toggle("hot", f < 0.3);
    g.fuseNote.textContent = fmt(Math.max(0, left), 0) + " ms";
    if (left <= 0) boom(g, t);
  },
});

function hearts(n) {
  return "■".repeat(n) + "□".repeat(LIVES - n);
}

// set up the fuse for the current word; startAt 0 = wait for the first key
function arm(g, startAt) {
  g.target = bombTarget(g.avg, g.cleared);
  g.fuse = bombFuse(g.word, g.target);
  g.fuseStart = startAt;
  g.big.set(g.word, g.next);
  g.fill.style.transform = "scaleX(1)";
  g.bar.classList.remove("hot");
  g.fuseNote.textContent = fmt(g.fuse, 0) + " ms";
  g.needNote.textContent = "beat " + fmt(g.target, 0) + " wpm";
  g.hud("target", fmt(g.target, 0));
}

function advance(g, t) {
  g.word = g.next;
  g.next = pickWord(g.pool, g.rng, g.word);
  arm(g, t);
}

function boom(g, t) {
  g.lives--;
  g.hud("lives", hearts(g.lives));
  g.big.boom();
  g.shake();
  pulse(g.hudEls.lives, "p1-broke");
  g.avg *= BOMB.boomDecay; // a miss lets the target breathe a little
  if (g.lives <= 0) {
    const ms = t - g.t0;
    const wpm = Math.round(wpmFrom(g.chars, ms));
    g.finish(g.cleared, { wpm, acc: accuracy(g.ok, g.miss), avg: Math.round(g.avg), base: Math.round(g.base) }, {
      title: "boom",
      stats: [["wpm", String(wpm)], ["avg", fmt(g.avg, 0)], ["acc", accuracy(g.ok, g.miss) + "%"], ["time", fmt(ms / 1000, 1) + "s"]],
    });
    return;
  }
  g.pauseUntil = t + BOOM_PAUSE; // keys are ignored while the word burns; the next word arms after
  g.pending = true;
  g.freeFirst = false;
}
