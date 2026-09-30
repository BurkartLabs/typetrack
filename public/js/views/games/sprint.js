// Sprint: one short phrase of common words, as fast as possible. Space = new phrase, Enter = same phrase.
// A faint marker runs through the phrase at your personal-best pace.
import store from "../../core/store.js";
import { defineGame, fmt } from "./pack1-kit.js";
import { makePhrase, sprintWpm, accuracy, round1, topScores } from "./pack1-logic.js";

const session = []; // this page load's runs: [{score, ts}]

export default defineGame({
  id: "sprint",
  name: "sprint",
  unit: "wpm",
  rules: "One short phrase. Type it as fast as you can. Space for a new phrase, Enter to retry the same one.",
  hud: [["wpm", "wpm"], ["pb", "best"], ["try", "try"]],
  bestFmt: (s) => fmt(s, 1),
  lockMs: 250,

  build(g) {
    const el = document.createElement("div");
    el.innerHTML = `<div class="p1-phrase" dir="auto"></div><div class="p1-hint">start typing &middot; the underline behind you is your best</div>`;
    g.phraseEl = el.firstChild;
    return el;
  },

  startExtra() {
    return `<p class="p1-rules" style="color:var(--sub);font-size:.8rem">wrong keys don't advance &middot; score is wpm over the phrase</p>`;
  },

  reset(g, { same }) {
    if (!same || !g.phrase) g.phrase = makePhrase(g.pool, g.rng);
    g.pos = 0; g.miss = 0; g.ghost = -1;
    const best = g.best();
    g.pbWpm = best;
    g.hud("pb", best === null ? "-" : fmt(best, 1));
    g.hud("wpm", "-");
    g.hud("try", session.length + 1);
    g.phraseEl.replaceChildren(...[...g.phrase].map((c) => {
      const s = document.createElement("span");
      s.className = "p1-ch";
      s.textContent = c;
      return s;
    }));
    mark(g);
  },

  key(g, k, t) {
    const exp = g.phrase[g.pos];
    const span = g.phraseEl.children[g.pos];
    const ok = exp === " " ? k === " " : g.match(exp, k);
    if (!ok) {
      if (g.started) { g.miss++; span.classList.remove("bad"); void span.offsetWidth; span.classList.add("bad"); }
      return;
    }
    g.go(t);
    span.classList.add("ok");
    g.pos++;
    mark(g);
    if (g.pos >= g.phrase.length) end(g, t);
  },

  frame(g, t) {
    if (!g.started) return;
    const ms = t - g.t0;
    if (g.pos > 1) g.hud("wpm", fmt(sprintWpm(g.phrase.slice(0, g.pos), ms), 0));
    if (g.pbWpm) {
      const at = Math.min(g.phrase.length - 1, 1 + Math.floor((g.pbWpm * 5 * ms) / 60000));
      if (at !== g.ghost) {
        const kids = g.phraseEl.children;
        if (kids[g.ghost]) kids[g.ghost].classList.remove("ghost");
        if (kids[at]) kids[at].classList.add("ghost");
        g.ghost = at;
      }
    }
  },
});

function mark(g) {
  const kids = g.phraseEl.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle("at", i === g.pos);
}

function end(g, t) {
  const ms = t - g.t0;
  const wpm = round1(sprintWpm(g.phrase, ms));
  const acc = accuracy(g.phrase.length, g.miss);
  const prevBest = g.best();
  const entry = { score: wpm, ts: Date.now() };
  session.push(entry);
  const allTime = topScores(store.gameScores("sprint").concat([entry]), 5);
  const sess = topScores(session, 5);
  const list = (rows) => rows.map((r) => `<li class="${r.ts === entry.ts && r.score === entry.score ? "now" : ""}"><b>${fmt(r.score, 1)}</b></li>`).join("");
  const diff = prevBest === null ? "" : (wpm >= prevBest ? "+" : "") + fmt(wpm - prevBest, 1);
  g.finish(wpm, { wpm, acc, ms: Math.round(ms), phrase: g.phrase, chars: g.phrase.length }, {
    title: "sprint",
    stats: [["acc", acc + "%"], ["time", fmt(ms / 1000, 2) + "s"], ["vs best", diff || "-"], ["chars", String(g.phrase.length)]],
    extra: `<div class="p1-pbs">
      <div><span class="p1-label">this session</span><ol>${list(sess)}</ol></div>
      <div><span class="p1-label">all time</span><ol>${list(allTime)}</ol></div>
    </div>
    <div class="p1-press" style="animation:none;margin-bottom:8px"><kbd>enter</kbd> same phrase</div>`,
  });
}
