// Metronome: a WebAudio click at a chosen speed (one beat per keystroke: wpm x 5 per minute), scored on
// timing evenness: the mean absolute deviation of your inter-key gaps from the beat, shown live.
import { createTyping } from "../../core/typing.js";
import * as L from "./lib.js";
import { drillPage, loadPool, group, SEP, bindConfig, tiles, actions, note, save, langName } from "./shell.js";
import { esc } from "../../core/ui.js";

let typing = null, click = null;

// Look-ahead scheduler (setInterval + AudioContext clock). every: beats per click; accent: clicks per bar.
function createClick() {
  let ac = null, timer = null, next = 0, n = 0, beat = 100, every = 1;
  function tone(at, strong) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "square";
    o.frequency.value = strong ? 2000 : 1400;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(strong ? 0.25 : 0.12, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
    o.connect(g).connect(ac.destination);
    o.start(at);
    o.stop(at + 0.03);
  }
  function pump() {
    const step = (beat * every) / 1000;
    while (next < ac.currentTime + 0.12) {
      tone(next, every > 1 || n % 5 === 0);
      next += step;
      n++;
    }
  }
  return {
    get running() { return !!timer; },
    start(beatMs, everyN) {
      beat = beatMs; every = everyN;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === "suspended") ac.resume();
      } catch { return false; }
      if (timer) return true;
      next = ac.currentTime + 0.05; n = 0;
      timer = setInterval(pump, 25);
      pump();
      return true;
    },
    stop() { clearInterval(timer); timer = null; },
    close() { this.stop(); if (ac) ac.close().catch(() => {}); ac = null; },
  };
}

async function mount(root, ctx) {
  const { store, settings } = ctx;
  const lang = settings.get("lang") || "en";
  const cfg = Object.assign({ wpm: 150, duration: 30, click: "key", sound: "on" }, store.get("train.metronome", {}));
  const el = drillPage(root, {
    title: "metronome",
    sub: "type on the click. evenness beats bursts: 100 = every key on the beat.",
    config: group("wpm", [[120, "120"], [150, "150"], [180, "180"], [200, "200"]], cfg.wpm) + `<span class="unit">wpm</span>` + SEP +
      group("duration", [[30, "30s"], [60, "60s"]], cfg.duration) + SEP +
      group("click", [["key", "every key"], ["word", "every 5"]], cfg.click) + SEP +
      group("sound", [["on", "sound"], ["off", "mute"]], cfg.sound),
    hint: "the click starts with your first key &nbsp;&middot;&nbsp; tab / esc &#8212; new round",
  });
  const { common, missing } = await loadPool(ctx.words, lang, { rare: false });
  if (!root.isConnected) return;
  if (missing) note(el, `no word list for ${esc(langName(lang))} yet, so these are english words.`);

  click = createClick();
  const beat = () => L.beatMs(cfg.wpm);
  const BARS = 48;
  el.live.innerHTML = `
    <div class="metro">
      <div class="metro-nums">
        <div class="tile"><div class="label">evenness</div><div class="value" data-m="score">&#8212;</div></div>
        <div class="tile"><div class="label">off beat</div><div class="value" data-m="mad">&#8212;</div></div>
        <div class="tile"><div class="label">your pace</div><div class="value" data-m="pace">&#8212;</div></div>
        <div class="tile"><div class="label">beat</div><div class="value" data-m="beat"></div></div>
      </div>
      <div class="metro-bars" data-m="bars" title="each bar is one gap between keys; the line is the beat"><i class="beat-line"></i></div>
      <button class="metro-listen" data-act="listen">&#9654; listen</button>
    </div>`;
  const m = {};
  el.live.querySelectorAll("[data-m]").forEach((n) => { m[n.dataset.m] = n; });

  function renderBeat() {
    m.beat.innerHTML = `${Math.round(beat())}<small>ms &middot; ${cfg.wpm * 5}/min</small>`;
  }
  function renderLive(log) {
    const gaps = L.gapsFromLog(log);
    const ev = L.evenness(gaps, beat());
    m.score.innerHTML = ev.n ? String(ev.score) : "&#8212;";
    m.mad.innerHTML = ev.n ? `&plusmn;${Math.round(ev.mad)}<small>ms</small>` : "&#8212;";
    m.pace.innerHTML = ev.n ? `${Math.round(60000 / ev.meanGap / 5)}<small>wpm</small>` : "&#8212;";
    const b = beat(), max = b * 2;
    const last = gaps.slice(-BARS);
    m.bars.innerHTML = `<i class="beat-line" style="bottom:50%"></i>` + last.map((g) => {
      const h = Math.min(100, (g / max) * 100);
      const off = Math.abs(g - b) / b;
      return `<span class="${off < 0.15 ? "on" : off < 0.4 ? "near" : "off"}" style="height:${h.toFixed(1)}%"></span>`;
    }).join("");
    return ev;
  }

  function startClick() {
    if (cfg.sound === "on") click.start(beat(), cfg.click === "word" ? 5 : 1);
  }
  function newRound() {
    click.stop();
    const lb = el.live.querySelector("[data-act=listen]");
    if (lb) lb.innerHTML = "&#9654; listen";
    el.result.hidden = true;
    el.live.classList.remove("finished");
    el.typing.hidden = false;
    typing.restart({ words: common, duration: cfg.duration });
    renderBeat();
    renderLive([]);
  }

  typing = createTyping(el.typing, {
    words: common, mode: "time", duration: cfg.duration, lang,
    onRestart: newRound,
    onStart: startClick,
    onProgress: (t) => renderLive(t.log),
    onFinish(r) {
      click.stop();
      const ev = renderLive(r.log);
      save(store, r, "metronome", lang, { metronome: { wpm: cfg.wpm, beatMs: Math.round(beat() * 10) / 10, mad: ev.mad, evenness: ev.score } });
      el.typing.hidden = true;
      el.live.classList.add("finished");
      el.result.hidden = false;
      el.result.innerHTML = tiles([["evenness", ev.score], ["off beat", `&plusmn;${Math.round(ev.mad)}`, "ms"],
        ["wpm", Math.round(r.wpm), `target ${cfg.wpm}`], ["acc", Math.round(r.acc) + "%"]]) + actions();
    },
  });
  renderBeat();
  renderLive([]);

  el.live.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act=listen]");
    if (!b) return;
    b.blur();
    if (click.running) { click.stop(); b.innerHTML = "&#9654; listen"; }
    else if (cfg.sound === "on") { startClick(); b.innerHTML = "&#9632; stop"; }
  });
  el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
  bindConfig(el.config, (k, v) => {
    cfg[k] = /^\d+$/.test(v) ? Number(v) : v;
    store.set("train.metronome", cfg);
    newRound();
  });
}

function unmount() {
  if (click) click.close();
  click = null;
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
