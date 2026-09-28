// Replays: #/replay/<id> re-types a run keystroke by keystroke; #/replay/<id>?vs=<id2> stacks two runs on one
// clock with a gap readout. id is a local result's ts, or s<id> for a server result (/api/ghosts/<id>).
import { loadCss, cssVar } from "../core/css.js";
import { h } from "../core/ui.js";
import { timeline, frameAt, typedAt, wpmAt, gapAt } from "../core/gamify.js";

const SPEEDS = [0.5, 1, 2, 4];
let stopFns = [];

async function loadRun(ctx, id) {
  id = String(id || "");
  if (/^s\d+$/.test(id)) {
    const g = await ctx.api.get("/api/ghosts/" + id.slice(1));
    return Object.assign({}, g, { id, who: g.name || "player" });
  }
  const r = ctx.store.results().find((x) => String(x.ts) === id);
  if (!r) throw { status: 404, error: "no such run" };
  return Object.assign({}, r, { id, who: "you" });
}

const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const hasLog = (r) => Array.isArray(r.log) && r.log.length && Array.isArray(r.words) && r.words.length;

// One run drawn on the page: words, caret, live wpm.
function pane(run, label) {
  const tl = timeline(window.Engine, run);
  const wordsEl = h("div", { class: "words" });
  const caret = h("div", { class: "caret main-caret" });
  const win = h("div", { class: "words-window" }, wordsEl, caret);
  const wpm = h("span", { class: "rp-wpm" }, "–");
  const el = h("div", { class: "rp-pane" },
    h("div", { class: "rp-pane-head" },
      h("span", { class: "rp-who" }, label),
      h("span", { class: "rp-meta" }, `${run.mode} ${run.target} · ${Math.round(run.wpm)} wpm · ${Math.round(run.acc)}%` + (run.ts ? ` · ${when(run.ts)}` : "")),
      h("span", { class: "rp-live" }, wpm, h("small", {}, " wpm"))),
    h("div", { class: "typing rp-typing" }, win));
  const wordEls = tl.words.map((w) => wordsEl.appendChild(h("div", { class: "word" }, [...w].map((c) => h("span", { class: "letter" }, c)))));
  const shown = [];
  let lastJ = -2, shift = 0;

  function drawWord(i, typed) {
    const w = tl.words[i];
    const we = wordEls[i];
    const t = typed == null ? "" : typed;
    if (shown[i] === t) return;
    shown[i] = t;
    const kids = [];
    for (let p = 0; p < Math.max(w.length, t.length); p++) {
      const cls = p >= w.length ? "letter extra" : p >= t.length ? "letter" : t[p] === w[p] ? "letter ok" : "letter bad";
      kids.push(h("span", { class: cls }, p < w.length ? w[p] : t[p]));
    }
    we.replaceChildren(...kids);
  }

  function draw(t) {
    const j = frameAt(tl, t);
    const live = wpmAt(tl, Math.min(t, tl.end || t));
    wpm.textContent = t >= tl.end && tl.end > 0 ? Math.round(run.wpm) : live == null ? "–" : Math.round(live);
    if (j === lastJ) return;
    lastJ = j;
    const typed = j < 0 ? [] : typedAt(tl, j);
    const index = j < 0 ? 0 : tl.frames[j].index;
    for (let i = 0; i < wordEls.length; i++) {
      drawWord(i, typed[i]);
      wordEls[i].classList.toggle("error", i < index && typed[i] !== tl.words[i]);
    }
    // keep the caret's line second of three, like the test
    const we = wordEls[Math.min(index, wordEls.length - 1)];
    if (!we) return;
    const line = we.offsetHeight || 1;
    const want = Math.max(0, we.offsetTop - line);
    if (want !== shift) { shift = want; wordsEl.style.transform = `translateY(${-shift}px)`; }
    const cur = typed[index] || "";
    const letters = we.children;
    const at = letters[Math.min(cur.length, letters.length - 1)];
    const x = at ? (cur.length >= letters.length ? at.offsetLeft + at.offsetWidth : at.offsetLeft) : we.offsetLeft;
    caret.style.left = x + "px";
    caret.style.top = `calc(${(at || we).offsetTop - shift}px + var(--line) * .82)`;
  }
  return { el, tl, draw, run, label };
}

// Gap over time between two panes (a leads above the line), with a playhead.
function gapChart(a, b, end) {
  const canvas = h("canvas", { class: "rp-gap-chart", height: 70 });
  const samples = [];
  for (let t = 0; t <= end; t += Math.max(50, end / 400)) samples.push([t, gapAt(a.tl, b.tl, t)]);
  const max = Math.max(5, ...samples.map((s) => Math.abs(s[1])));
  function draw(now) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = 70;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = (t) => (t / (end || 1)) * W, y = (v) => H / 2 - (v / max) * (H / 2 - 4);
    g.strokeStyle = cssVar("--edge"); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    for (const [sign, col] of [[1, cssVar("--caret")], [-1, cssVar("--sub")]]) {
      g.fillStyle = col; g.globalAlpha = 0.55;
      g.beginPath(); g.moveTo(0, H / 2);
      for (const [t, v] of samples) g.lineTo(x(t), y(sign > 0 ? Math.max(0, v) : Math.min(0, v)));
      g.lineTo(x(samples[samples.length - 1][0]), H / 2); g.closePath(); g.fill();
    }
    g.globalAlpha = 1; g.strokeStyle = cssVar("--text");
    g.beginPath(); g.moveTo(x(now), 0); g.lineTo(x(now), H); g.stroke();
  }
  return { el: canvas, draw };
}

function errorTicks(panes, end) {
  const box = h("div", { class: "rp-ticks" });
  panes.forEach((p, k) => p.tl.errors.forEach((t) =>
    box.appendChild(h("i", { class: "rp-tick" + (k ? " b" : ""), style: { left: ((t / (end || 1)) * 100).toFixed(2) + "%" } }))));
  return box;
}

function compareMenu(ctx, run, vsId) {
  const others = ctx.store.results().filter((r) => hasLog(r) && r.mode === run.mode && r.target === run.target && String(r.ts) !== run.id)
    .sort((x, y) => y.wpm - x.wpm).slice(0, 50);
  if (!others.length) return h("span", { class: "rp-dim" }, "no other local runs of this mode to compare");
  const sel = h("select", { class: "rp-select", "aria-label": "compare with" },
    h("option", { value: "" }, "compare with…"),
    others.map((r) => h("option", { value: r.ts, selected: String(r.ts) === vsId }, `${Math.round(r.wpm)} wpm · ${Math.round(r.acc)}% · ${when(r.ts)}`)));
  sel.addEventListener("change", () => ctx.navigate(`#/replay/${run.id}` + (sel.value ? `?vs=${sel.value}` : "")));
  return sel;
}

function notice(root, title, text) {
  root.replaceChildren(h("div", { class: "notice" }, h("div", { class: "notice-title" }, title), h("p", {}, text), h("a", { href: "#/profile" }, "back to your profile")));
}

async function mount(root, ctx) {
  await loadCss("css/profile.css");
  const id = ctx.params.id, vsId = ctx.query.vs;
  let a, b = null;
  try {
    [a, b] = await Promise.all([loadRun(ctx, id), vsId ? loadRun(ctx, vsId) : null]);
  } catch (err) {
    if (!root.isConnected) return;
    if (ctx.auth.online == null) await ctx.auth.refresh();
    const serverRun = [id, vsId].some((x) => /^s\d+$/.test(String(x || "")));
    if (err && err.status === 404 && (!serverRun || ctx.auth.online)) return notice(root, "run not found", "that run isn't in this browser's history (or on the server).");
    return notice(root, "replay offline", "shared runs come from the server, which isn't reachable right now. local runs still replay.");
  }
  if (!root.isConnected) return;
  if (!hasLog(a) || (b && !hasLog(b))) return notice(root, "nothing to replay", "this run was saved before keystroke logs existed, so it can't be replayed.");

  const pa = pane(a, b ? "A · " + a.who : a.who);
  const pb = b ? pane(b, "B · " + b.who) : null;
  const panes = pb ? [pa, pb] : [pa];
  const end = Math.max(...panes.map((p) => p.tl.end), 1);

  let t = 0, playing = false, speed = 1, last = 0, timer = null;
  const playBtn = h("button", { class: "rp-play", "aria-label": "play" }, "▶");
  const clock = h("span", { class: "rp-clock" }, "0.0s");
  const scrub = h("input", { type: "range", class: "rp-scrub", min: 0, max: Math.ceil(end), step: 10, value: 0, "aria-label": "position" });
  const speedBtns = SPEEDS.map((s) => h("button", { class: s === 1 ? "active" : "", onclick: () => setSpeed(s) }, s + "x"));
  const gap = pb ? h("div", { class: "rp-gap" }) : null;
  const chart = pb ? gapChart(pa, pb, end) : null;

  function setSpeed(s) {
    speed = s;
    speedBtns.forEach((btn, i) => btn.classList.toggle("active", SPEEDS[i] === s));
  }
  function render() {
    panes.forEach((p) => p.draw(t));
    scrub.value = t;
    clock.textContent = (t / 1000).toFixed(1) + "s / " + (end / 1000).toFixed(1) + "s";
    if (gap) {
      const d = gapAt(pa.tl, pb.tl, t);
      gap.className = "rp-gap " + (d > 0 ? "a" : d < 0 ? "b" : "");
      const done = [[pa, "A"], [pb, "B"]].filter(([p]) => t > p.tl.end).map(([, k]) => k);
      gap.textContent = (d === 0 ? "level" : `${d > 0 ? "A" : "B"} ahead by ${Math.abs(d)} char${Math.abs(d) === 1 ? "" : "s"} (≈ ${(Math.abs(d) / 5).toFixed(1)} words)`) +
        (done.length ? ` · ${done.join(" and ")} finished, carried on at average pace` : "");
      chart.draw(t);
    }
  }
  function frame() {
    const now = performance.now();
    t = Math.min(end, t + (now - last) * speed);
    last = now;
    render();
    if (t >= end) pause();
  }
  function play() {
    if (t >= end) t = 0;
    playing = true; last = performance.now();
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "pause");
    clearInterval(timer);
    timer = setInterval(frame, 33); // not rAF: it stops in background tabs and the clock would jump
  }
  function pause() {
    playing = false; clearInterval(timer);
    playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "play");
  }
  function seek(v) {
    t = Math.max(0, Math.min(end, v)); last = performance.now(); render();
  }
  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  scrub.addEventListener("input", () => seek(Number(scrub.value)));

  const scrubWrap = h("div", { class: "rp-scrub-wrap" }, scrub, errorTicks(panes, end));
  root.replaceChildren(h("div", { class: "view view-replay" + (pb ? " vs" : "") },
    h("div", { class: "rp-top" },
      h("h1", { class: "rp-title" }, pb ? "side by side" : "replay"),
      compareMenu(ctx, a, vsId),
      pb ? h("a", { class: "back-link", href: `#/replay/${a.id}` }, "single") : null),
    h("div", { class: "rp-panes" }, panes.map((p) => p.el)),
    gap ? h("div", { class: "rp-gap-box" }, gap, chart.el, h("div", { class: "rp-gap-legend" }, h("span", {}, "A ahead ▲"), h("span", {}, "▼ B ahead"))) : null,
    h("div", { class: "rp-controls" },
      playBtn,
      h("div", { class: "rp-speeds config" }, speedBtns),
      scrubWrap,
      clock),
    h("p", { class: "hint" }, "space play/pause · ← → seek 1s · red ticks are mistakes")));

  ctx.keys.set((e) => {
    if (e.target && /^(SELECT|INPUT)$/.test(e.target.tagName) && e.key !== " ") return;
    if (e.key === " ") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek(t - 1000); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seek(t + 1000); }
  });
  const onResize = () => { panes.forEach((p) => p.draw(-1)); render(); };
  window.addEventListener("resize", onResize);
  stopFns.push(() => { pause(); window.removeEventListener("resize", onResize); });
  render();
  play();
}

function unmount() {
  stopFns.forEach((f) => f());
  stopFns = [];
}

export default { mount, unmount };
