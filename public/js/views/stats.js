// Stats: tiles, wpm-per-test chart with tooltip, error breakdown, recent table, export/import/clear.
import { loadCss, cssVar } from "../core/css.js";
import { drawLineChart } from "../core/chart.js";
import { esc, fmtDuration, shortDate, toast } from "../core/ui.js";
import { errorBlock, keyChip, swapChip } from "./test.js";

const FILTERS = ["all", "time 15", "time 30", "time 60", "time 120", "words 25", "words 50", "words 100"];
let cleanup = [];

const MARKUP = `
  <section class="view view-stats">
    <div class="config stats-filter">
      <div class="group" data-el="modes">
        ${FILTERS.map((f) => `<button data-filter="${f}">${f}</button>`).join("")}
      </div>
    </div>

    <div class="tiles" data-el="tiles"></div>

    <div class="chart-box tall">
      <div class="chart-head">
        <span class="chart-title">wpm per test</span>
        <span class="legend"><i class="sw dot"></i>test <i class="sw line"></i>10-test average</span>
      </div>
      <canvas data-el="chart" height="260"></canvas>
      <div class="tooltip" data-el="tip" hidden></div>
      <p class="empty" data-el="empty" hidden>no results yet &#8212; take a test</p>
    </div>

    <section class="error-panel stats-errors" data-el="errPanel"></section>

    <table class="recent">
      <thead><tr><th>date</th><th>mode</th><th class="num">wpm</th><th class="num">raw</th><th class="num">acc</th><th class="num">errors</th></tr></thead>
      <tbody data-el="recent"></tbody>
    </table>

    <div class="data-actions">
      <button data-el="exportBtn">export json</button>
      <label class="file-btn">import json<input type="file" data-el="importFile" accept="application/json,.json"></label>
      <button data-el="clearBtn" class="danger">clear all</button>
    </div>
  </section>`;

function tile(label, value) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

async function mount(root, ctx) {
  const E = window.Engine;
  const { store } = ctx;
  await loadCss("css/stats.css");
  root.innerHTML = MARKUP;
  const el = {};
  root.querySelectorAll("[data-el]").forEach((n) => { el[n.dataset.el] = n; });
  let filter = FILTERS.includes(ctx.query.mode) ? ctx.query.mode : "all";

  function markFilter() {
    el.modes.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.filter === filter));
  }

  el.modes.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.filter;
    markFilter();
    render();
  });

  function render() {
    const rs = E.filterResults(store.results(), filter).sort((a, b) => a.ts - b.ts);
    const s = E.summarize(rs);
    const trend = s.trend === 0 ? "" : `<small class="${s.trend > 0 ? "up" : "down"}">${s.trend > 0 ? "+" : ""}${s.trend}</small>`;
    el.tiles.innerHTML = [
      tile("tests", s.count),
      tile("best wpm", s.best),
      tile("wpm · last 10", s.avgRecent + trend),
      tile("wpm · overall", s.avgAll),
      tile("accuracy", s.acc + "%"),
      tile("errors / test", E.errorProfile(rs).avgErrors),
      tile("time typed", fmtDuration(s.seconds)),
    ].join("");

    el.empty.hidden = rs.length > 0;
    drawLineChart(el.chart, {
      xs: rs.map((_, i) => i + 1),
      series: [
        { values: rs.map((r) => r.wpm), color: cssVar("--main"), dots: true, line: rs.length < 2 },
        { values: E.movingAverage(rs.map((r) => r.wpm), 10), color: cssVar("--text"), dots: false },
      ],
      xLabel: (x) => (rs[x - 1] ? shortDate(rs[x - 1].ts) : ""),
      yMin: 0,
      hover: (i, px, py) => {
        const r = rs[i];
        if (!r) { el.tip.hidden = true; return; }
        el.tip.innerHTML = `<b>${r.wpm} wpm</b> · ${r.acc}% acc<br>${E.modeKey(r)} · ${new Date(r.ts).toLocaleString()}`;
        el.tip.style.left = px + "px";
        el.tip.style.top = py + "px";
        el.tip.hidden = false;
      },
    });

    const p = E.errorProfile(rs);
    el.errPanel.innerHTML = !p.tracked ? "" :
      `<div class="chart-title">error breakdown · ${p.tracked} test${p.tracked === 1 ? "" : "s"} tracked</div>` +
      errorBlock("weakest keys (miss rate)", p.keys.slice(0, 12).map((k) => keyChip(k.key, k.rate + "%", k.rate))) +
      errorBlock("common swaps", p.swaps.slice(0, 8).map((x) => swapChip(x.k, x.n))) +
      errorBlock("most missed words", p.words.slice(0, 12).map((w) => `<span class="chip word-chip">${esc(w.k)} <small>×${w.n}</small></span>`));

    el.recent.innerHTML = rs.slice(-15).reverse().map((r) =>
      `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${E.modeKey(r)}</td>` +
      `<td class="num wpm">${r.wpm}</td><td class="num">${r.raw}</td><td class="num">${r.acc}%</td>` +
      `<td class="num err">${r.chars ? r.chars.incorrect + r.chars.extra + r.chars.missed : "–"}</td></tr>`).join("");
  }

  el.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.results(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `typetrack-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  el.importFile.addEventListener("change", async () => {
    const f = el.importFile.files[0];
    if (!f) return;
    try {
      const incoming = JSON.parse(await f.text());
      if (!Array.isArray(incoming)) throw new Error("not an array");
      const current = store.results();
      const seen = new Set(current.map((r) => r.ts));
      const added = incoming.filter((r) => store.isResult(r) && !seen.has(r.ts));
      store.replaceResults(current.concat(added));
      render();
      toast(`imported ${added.length} result${added.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast("could not import: " + err.message);
    }
    el.importFile.value = "";
  });
  el.clearBtn.addEventListener("click", () => {
    const n = store.results().length;
    if (!confirm(`delete all ${n} results? export first if you want a backup.`)) return;
    store.replaceResults([]);
    render();
  });

  const onResize = () => render();
  window.addEventListener("resize", onResize);
  cleanup.push(() => window.removeEventListener("resize", onResize));
  const offSaved = ctx.bus.on("result:saved", render);
  cleanup.push(offSaved);

  markFilter();
  render();
}

function unmount() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default { mount, unmount };
