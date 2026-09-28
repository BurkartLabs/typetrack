// The standard test: config bar, typing surface, results screen.
import { loadCss, cssVar } from "../core/css.js";
import { createTyping } from "../core/typing.js";
import { drawLineChart } from "../core/chart.js";
import { esc } from "../core/ui.js";

const CONFIG_KEY = "config.v1"; // typetrack.config.v1, same as v1
const LIST_NAMES = { "common-200": "200", "common-1k": "1k", "common-10k": "10k", rare: "rare" };

let typing = null, cleanup = [];

export function errorBlock(title, chips) {
  if (!chips.length) return "";
  return `<div class="err-block"><span class="label">${title}</span><div class="chips">${chips.join("")}</div></div>`;
}
// heat: miss rate 0-100 tints the chip border from dim to full red
export function keyChip(key, note, rate) {
  const a = Math.min(1, 0.25 + rate / 60).toFixed(2);
  return `<span class="chip key-chip" style="--heat:${a}"><b>${key === " " ? "␣" : esc(key)}</b><small>${note}</small></span>`;
}
export function swapChip(k, n) {
  const [exp, got] = k.split(">");
  return `<span class="chip">${esc(exp)} → <span class="err">${esc(got)}</span> <small>×${n}</small></span>`;
}

const MARKUP = `
  <section class="view view-test">
    <div class="config" data-el="config">
      <div class="group">
        <button data-mode="time">time</button>
        <button data-mode="words">words</button>
      </div>
      <span class="sep"></span>
      <div class="group" data-el="timeOpts">
        <button data-duration="15">15</button>
        <button data-duration="30">30</button>
        <button data-duration="60">60</button>
        <button data-duration="120">120</button>
      </div>
      <div class="group" data-el="wordsOpts">
        <button data-count="25">25</button>
        <button data-count="50">50</button>
        <button data-count="100">100</button>
      </div>
    </div>

    <div data-el="typingWrap">
      <div data-el="typing"></div>
      <div class="hint">tab &#8212; restart &nbsp;&middot;&nbsp; esc &#8212; restart</div>
    </div>

    <div class="result" data-el="result" hidden>
      <div class="result-grid">
        <div class="big">
          <div class="label">wpm</div>
          <div class="value" data-el="wpm">0</div>
          <div class="label">acc</div>
          <div class="value" data-el="acc">0%</div>
        </div>
        <div class="chart-box"><div class="chart-head"><span class="chart-title"></span><span class="legend"><i class="sw line main"></i>wpm <i class="sw bar"></i>errors</span></div><canvas data-el="chart" height="180"></canvas></div>
      </div>
      <div class="result-details">
        <div><span class="label">test type</span><span data-el="type"></span></div>
        <div><span class="label">raw</span><span data-el="raw"></span></div>
        <div><span class="label">characters</span><span data-el="chars" title="correct / incorrect / extra / missed"></span></div>
        <div><span class="label">errors</span><span data-el="errors" class="err"></span></div>
        <div><span class="label">time</span><span data-el="time"></span></div>
      </div>
      <div class="error-panel" data-el="errPanel"></div>
      <div class="result-actions">
        <button data-el="next" class="icon-btn" title="next test (tab)">&#8635; next test</button>
      </div>
    </div>
  </section>`;

async function mount(root, ctx) {
  const E = window.Engine;
  const { store, settings } = ctx;
  await loadCss("css/test.css");
  root.innerHTML = MARKUP;
  const el = {};
  root.querySelectorAll("[data-el]").forEach((n) => { el[n.dataset.el] = n; });
  const config = Object.assign({ mode: "time", duration: 30, wordCount: 50 }, store.get(CONFIG_KEY, {}));
  if (config.mode !== "time" && config.mode !== "words") config.mode = "time";
  let lastResult = null;

  const lang = settings.get("lang"), list = settings.get("list") || "common-1k";
  const pool = await ctx.words.list(lang, list);
  if (!root.isConnected || !el.typing.isConnected) return; // navigated away while loading

  function typingOpts() {
    return { words: pool, mode: config.mode, duration: config.duration, wordCount: config.wordCount, lang };
  }

  function showTyping() {
    el.result.hidden = true;
    el.typingWrap.hidden = false;
    lastResult = null;
  }

  function newTest() {
    showTyping();
    typing.restart(typingOpts());
  }

  typing = createTyping(el.typing, Object.assign(typingOpts(), {
    onRestart: showTyping,
    onFinish(r) {
      store.addResult(r);
      showResult(r);
    },
  }));

  function showResult(r) {
    lastResult = r;
    el.typingWrap.hidden = true;
    el.result.hidden = false;
    el.wpm.textContent = Math.round(r.wpm);
    el.acc.textContent = Math.round(r.acc) + "%";
    el.type.textContent = `${E.modeKey(r)} · ${langName(lang)} ${LIST_NAMES[list] || list}`;
    el.raw.textContent = Math.round(r.raw);
    el.chars.textContent = `${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`;
    el.time.textContent = r.duration + "s";
    const errCount = r.chars.incorrect + r.chars.extra + r.chars.missed;
    el.errors.textContent = errCount;
    const p = E.errorProfile([r]);
    el.errPanel.innerHTML = errCount === 0 ? `<p class="clean">no errors — clean run</p>` :
      errorBlock("missed keys", p.keys.slice(0, 8).map((k) => keyChip(k.key, `${k.miss}/${k.hits}`, k.rate))) +
      errorBlock("typed instead", p.swaps.slice(0, 6).map((x) => swapChip(x.k, x.n))) +
      errorBlock("wrong words", r.errors.words.slice(0, 12).map((w) =>
        `<span class="chip word-chip"><s>${esc(w.typed)}</s> ${esc(w.word)}</span>`));
    drawResultChart(r);
  }

  function drawResultChart(r) {
    drawLineChart(el.chart, {
      xs: r.perSecond.map((_, i) => i + 1),
      bars: r.errors.perSecond,
      series: [{ values: r.perSecond, color: cssVar("--caret"), dots: false }],
      xLabel: (x) => x + "s",
      yMin: 0,
    });
  }

  el.next.addEventListener("click", newTest);

  el.config.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mode) config.mode = b.dataset.mode;
    if (b.dataset.duration) config.duration = Number(b.dataset.duration);
    if (b.dataset.count) config.wordCount = Number(b.dataset.count);
    store.set(CONFIG_KEY, config);
    renderConfig();
    newTest();
    b.blur(); // keep space from re-pressing the button
  });

  function renderConfig() {
    el.config.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === config.mode));
    el.timeOpts.hidden = config.mode !== "time";
    el.wordsOpts.hidden = config.mode !== "words";
    el.timeOpts.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.duration) === config.duration));
    el.wordsOpts.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.count) === config.wordCount));
  }

  const onResize = () => { if (lastResult) drawResultChart(lastResult); };
  window.addEventListener("resize", onResize);
  cleanup.push(() => window.removeEventListener("resize", onResize));

  renderConfig();
}

function langName(code) {
  return { en: "english" }[code] || code;
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default { mount, unmount };
