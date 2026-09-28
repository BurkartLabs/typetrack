// Treadmill: a pace wall starts at 80 wpm and speeds up 5 wpm every 10 s. It's a belt: it never falls more
// than a few words behind you, so a fast start banks nothing. When the wall reaches your caret, you're off.
import { defineGame, Stream, fmt } from "./pack1-kit.js";
import { TREADMILL, treadmillSpeed, treadmillStep, wpmFrom, accuracy, pickWord } from "./pack1-logic.js";

const C = TREADMILL;

export default defineGame({
  id: "treadmill",
  name: "treadmill",
  unit: "wpm",
  rules: `A pace wall starts at ${C.start} wpm and rises ${C.step} wpm every ${C.every / 1000} s. Stay ahead of it; it never falls more than ${C.lead} characters behind.`,
  hud: [["pace", "pace"], ["wpm", "you"], ["lead", "lead"], ["time", "time"]],

  build(g) {
    const el = document.createElement("div");
    g.stream = new Stream((i, prev) => pickWord(g.pool, g.rng, prev));
    g.belt = document.createElement("div");
    g.belt.className = "p1-belt";
    el.appendChild(g.stream.el);
    el.insertAdjacentHTML("beforeend", `
      <div class="p1-lead"><div class="p1-bar"><i></i></div>
        <div class="p1-barnote"><span>lead</span><span class="p1-upnext"></span></div></div>
      <div class="p1-hint">start typing &middot; the wall starts with your first key</div>`);
    g.leadBar = el.querySelector(".p1-lead .p1-bar");
    g.leadFill = g.leadBar.firstElementChild;
    g.nextNote = el.querySelector(".p1-lead .p1-upnext");
    return el;
  },

  reset(g) {
    g.stream.reset();
    g.stream.strip.appendChild(g.belt);
    g.pace = -C.headStart; g.last = 0; g.ok = 0; g.miss = 0; g.speed = C.start;
    g.root.classList.remove("p1-danger");
    drawPace(g);
    g.hud("pace", C.start); g.hud("wpm", "-"); g.hud("lead", fmt(C.headStart, 0)); g.hud("time", "0");
    g.nextNote.textContent = `next ${C.start + C.step} in ${C.every / 1000}s`;
  },

  key(g, k, t) {
    const r = g.stream.type(k, g.match);
    if (!r.ok) { if (g.started) g.miss++; return; }
    if (!g.started) { g.go(t); g.last = t; }
    g.ok++;
  },

  frame(g, t) {
    if (!g.started) return;
    const ms = t - g.t0;
    g.speed = treadmillSpeed(ms);
    g.pace = treadmillStep(g.pace, t - g.last, g.speed, g.stream.pos);
    g.last = t;
    const lead = g.stream.pos - g.pace;
    drawPace(g);
    g.hud("pace", g.speed);
    g.hud("wpm", fmt(wpmFrom(g.stream.pos, ms), 0));
    g.hud("lead", fmt(Math.max(0, lead), 0));
    g.hud("time", fmt(ms / 1000, 0));
    const toNext = C.every - (ms % C.every);
    g.nextNote.textContent = `next ${g.speed + C.step} in ${fmt(toNext / 1000, 1)}s`;
    g.root.classList.toggle("p1-danger", lead < 8);
    if (lead <= 0) {
      g.stream.fail();
      g.shake();
      g.finish(g.speed, { wpm: Math.round(wpmFrom(g.stream.pos, ms)), acc: accuracy(g.ok, g.miss), ms: Math.round(ms), chars: g.stream.pos }, {
        title: "caught at " + g.speed + " wpm",
        stats: [["you", fmt(wpmFrom(g.stream.pos, ms), 0) + " wpm"], ["time", fmt(ms / 1000, 1) + "s"], ["acc", accuracy(g.ok, g.miss) + "%"], ["words", String(g.stream.word())]],
      });
    }
  },
});

function drawPace(g) {
  const lead = Math.max(0, Math.min(C.lead, g.stream.pos - g.pace));
  g.belt.style.transform = `translateX(${g.pace.toFixed(2)}ch)`;
  g.belt.dataset.wpm = g.speed;
  g.leadFill.style.transform = `scaleX(${(lead / C.lead).toFixed(3)})`;
  g.leadBar.classList.toggle("hot", lead < 8);
}
