// Stats: tiles, wpm-per-test chart with tooltip, "where your time goes" timing analysis,
// error breakdown (collapsed on clean runs), recent table, export/import/clear.
// Built for 130-200 wpm typists at ~100% accuracy: the page is about where TIME goes, not errors.
import { loadCss, cssVar } from "../core/css.js";
import { drawLineChart, drawBars } from "../core/chart.js";
import { esc, fmtDuration, shortDate, toast } from "../core/ui.js";
import { errorBlock, keyChip, swapChip } from "./test.js";

const FILTERS = ["all", "time 15", "time 30", "time 60", "time 120", "words 25", "words 50", "words 100"];
const TOP_PAIRS = 15;
const TOP_WORDS = 15;
const RHYTHM_RECENT = 20;
const CONSISTENCY_RECENT = 10;
const STAMINA_MIN_SECONDS = 120;
let cleanup = [];

// ── pure helpers (also used by test/stats.test.js) ─────────────────────────

export function resultLang(r) {
  return (r && r.lang) || "en";
}

export function resultSource(r) {
  return (r && r.source) || "words";
}

export function distinctValues(rs, getter) {
  return [...new Set(rs.map(getter))].sort();
}

export function filterByLangSource(rs, lang, source) {
  return rs.filter(
    (r) => (lang === "all" || resultLang(r) === lang) && (source === "all" || resultSource(r) === source)
  );
}

export function hasLog(r) {
  return !!r && Array.isArray(r.log) && r.log.length > 0 && Array.isArray(r.words) && r.words.length > 0;
}

export function withLogs(rs) {
  return rs.filter(hasLog);
}

// A pairTimes/gap interval is one keystroke: wpm = 12000 / ms (see engine.js rhythm/burst comment).
export function pairWpm(medianMs) {
  return medianMs > 0 ? Math.round(12000 / medianMs) : 0;
}

export function mergeRhythm(E, rs, bucket, max) {
  const logged = withLogs(rs);
  if (!logged.length) return null;
  const b = bucket || 10, m = max || 500;
  let bins = null, over = 0, count = 0, meanSum = 0;
  for (const r of logged) {
    const rr = E.rhythm(r, b, m);
    bins = bins ? bins.map((v, i) => v + rr.bins[i]) : rr.bins.slice();
    over += rr.over;
    count += rr.count;
    meanSum += rr.mean * rr.count;
  }
  return { bucket: b, max: m, bins, over, count, mean: count ? round1(meanSum / count) : 0 };
}

export function burstSummary(E, rs) {
  const logged = withLogs(rs);
  if (!logged.length) return null;
  let bestWord = null, bestWindow = 0, sustainedSum = 0;
  for (const r of logged) {
    const b = E.burst(r);
    if (b.word && (!bestWord || b.word.wpm > bestWord.wpm)) bestWord = b.word;
    if (b.window > bestWindow) bestWindow = b.window;
    sustainedSum += b.overall;
  }
  return { bestWord, bestWindow: round1(bestWindow), sustained: round1(sustainedSum / logged.length) };
}

export function avgConsistency(E, rs, n) {
  const logged = withLogs(rs).slice(-(n || CONSISTENCY_RECENT));
  if (!logged.length) return null;
  const vals = logged.map((r) => E.consistency(r));
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function bestBurstWpm(E, rs) {
  let best = 0;
  for (const r of withLogs(rs)) {
    const b = E.burst(r);
    if (b.word && b.word.wpm > best) best = b.word.wpm;
  }
  return best;
}

export function staminaResults(E, rs, minSeconds) {
  const min = minSeconds || STAMINA_MIN_SECONDS;
  return withLogs(rs)
    .filter((r) => r.duration >= min)
    .map((r) => Object.assign({ ts: r.ts }, E.staminaDrop(r)));
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rs, E) {
  const header = ["date", "lang", "source", "mode", "target", "wpm", "raw", "acc", "consistency", "errors", "duration"];
  const lines = [header.join(",")];
  for (const r of rs) {
    const cons = E && hasLog(r) ? E.consistency(r) : "";
    const errors = r.chars ? r.chars.incorrect + r.chars.extra + r.chars.missed : "";
    lines.push(
      [
        new Date(r.ts).toISOString(),
        resultLang(r),
        resultSource(r),
        r.mode,
        r.target,
        r.wpm,
        r.raw,
        r.acc,
        cons,
        errors,
        r.duration,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── markup ──────────────────────────────────────────────────────────────────

const MARKUP = `
  <section class="view view-stats">
    <div class="config stats-filter">
      <div class="group" data-el="modes">
        ${FILTERS.map((f) => `<button data-filter="${f}">${f}</button>`).join("")}
      </div>
      <div class="sep"></div>
      <div class="group" data-el="langs"></div>
      <div class="sep"></div>
      <div class="group" data-el="sources"></div>
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

    <section class="time-goes" data-el="timeGoes">
      <h2 class="section-title">where your time goes</h2>
      <div data-el="timeGoesBody"></div>
    </section>

    <section class="error-panel stats-errors" data-el="errPanel"></section>

    <table class="recent">
      <thead><tr>
        <th>date</th><th>mode</th><th class="num">wpm</th><th class="num">raw</th><th class="num">acc</th>
        <th class="num">consistency</th><th class="num">hesitations</th><th class="num">errors</th>
      </tr></thead>
      <tbody data-el="recent"></tbody>
    </table>

    <div class="data-actions">
      <button data-el="exportBtn">export json</button>
      <button data-el="exportCsvBtn">export csv</button>
      <label class="file-btn">import json<input type="file" data-el="importFile" accept="application/json,.json"></label>
      <button data-el="clearBtn" class="danger">clear all</button>
    </div>
  </section>`;

function tile(label, value) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function pairChip(p) {
  return `<span class="chip pair-chip" data-pair="${esc(p.pair)}">${esc(p.pair)} <small>${p.medianMs}ms · ${pairWpm(p.medianMs)}wpm</small></span>`;
}

function wordTimeChip(w) {
  return `<span class="chip word-chip">${esc(w.word)} <small>${w.wpm}wpm · ${Math.round(w.medianMs)}ms</small></span>`;
}

function compareBar(label, value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return `<div class="cmp-row"><span class="cmp-label">${esc(label)}</span><div class="cmp-track"><div class="cmp-fill" style="width:${pct}%"></div></div><span class="cmp-value">${value} wpm</span></div>`;
}

function staminaRow(s) {
  const sign = s.drop > 0 ? "-" : "+";
  const cls = s.drop > 0 ? "down" : "up";
  return `<div class="stamina-row"><span class="stamina-date">${new Date(s.ts).toLocaleDateString()}</span>` +
    `<span>${s.first} &rarr; ${s.middle} &rarr; ${s.last} wpm</span>` +
    `<span class="${cls}">${sign}${Math.abs(s.drop)}%</span></div>`;
}

async function mount(root, ctx) {
  const E = window.Engine;
  const { store } = ctx;
  await loadCss("css/stats.css");
  root.innerHTML = MARKUP;
  const el = {};
  root.querySelectorAll("[data-el]").forEach((n) => { el[n.dataset.el] = n; });
  let filter = FILTERS.includes(ctx.query.mode) ? ctx.query.mode : "all";
  let langFilter = ctx.query.lang || "all";
  let sourceFilter = ctx.query.source || "all";
  let errorsExpanded = false;

  function markFilter() {
    el.modes.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.filter === filter));
    el.langs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.filter === langFilter));
    el.sources.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.filter === sourceFilter));
  }

  function renderFacetButtons(all) {
    const langs = distinctValues(all, resultLang);
    const sources = distinctValues(all, resultSource);
    if (!langs.includes(langFilter) && langFilter !== "all") langFilter = "all";
    if (!sources.includes(sourceFilter) && sourceFilter !== "all") sourceFilter = "all";
    el.langs.innerHTML = ["all", ...langs].map((l) => `<button data-filter="${esc(l)}">${esc(l)}</button>`).join("");
    el.sources.innerHTML = ["all", ...sources].map((s) => `<button data-filter="${esc(s)}">${esc(s)}</button>`).join("");
  }

  el.modes.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.filter;
    markFilter();
    render();
  });
  el.langs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    langFilter = b.dataset.filter;
    markFilter();
    render();
  });
  el.sources.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    sourceFilter = b.dataset.filter;
    markFilter();
    render();
  });

  function renderTimeGoes(rs) {
    const logged = withLogs(rs);
    if (!logged.length) {
      el.timeGoesBody.innerHTML = `<p class="empty-inline">timing analysis needs runs recorded after this update</p>`;
      return;
    }
    const pairs = E.pairTimes(logged, 5).slice(0, TOP_PAIRS);
    const words = E.wordTimes(logged).slice(0, TOP_WORDS);
    const rhythm = mergeRhythm(E, logged.slice(-RHYTHM_RECENT), 10, 500);
    const burstS = burstSummary(E, logged);
    const stamina = staminaResults(E, logged, STAMINA_MIN_SECONDS);

    let html = "";

    html += `<div class="tg-block">
      <div class="chart-title">slowest letter pairs</div>
      <div class="chips">${pairs.length ? pairs.map(pairChip).join("") : '<span class="empty-inline">not enough data yet</span>'}</div>
      ${pairs.length ? `<a class="drill-btn" href="#/train/pairs?pairs=${pairs.map((p) => encodeURIComponent(p.pair)).join(",")}">drill these</a>` : ""}
    </div>`;

    html += `<div class="tg-block">
      <div class="chart-title">slowest words</div>
      <div class="chips">${words.length ? words.map(wordTimeChip).join("") : '<span class="empty-inline">not enough data yet</span>'}</div>
    </div>`;

    html += `<div class="tg-block">
      <div class="chart-title">keystroke rhythm &middot; last ${Math.min(RHYTHM_RECENT, logged.length)} tests</div>
      <canvas data-el="rhythmChart" height="140"></canvas>
    </div>`;

    html += `<div class="tg-block">
      <div class="chart-title">burst vs sustained</div>
      ${burstS ? [
        compareBar("best word", burstS.bestWord ? burstS.bestWord.wpm : 0, Math.max(burstS.bestWord ? burstS.bestWord.wpm : 0, burstS.bestWindow, burstS.sustained, 1)),
        compareBar("best 5s window", burstS.bestWindow, Math.max(burstS.bestWord ? burstS.bestWord.wpm : 0, burstS.bestWindow, burstS.sustained, 1)),
        compareBar("sustained avg", burstS.sustained, Math.max(burstS.bestWord ? burstS.bestWord.wpm : 0, burstS.bestWindow, burstS.sustained, 1)),
      ].join("") : '<span class="empty-inline">not enough data yet</span>'}
    </div>`;

    html += `<div class="tg-block">
      <div class="chart-title">consistency over time</div>
      <canvas data-el="consistencyChart" height="140"></canvas>
    </div>`;

    html += `<div class="tg-block">
      <div class="chart-title">stamina &middot; runs &ge; ${STAMINA_MIN_SECONDS}s (first &rarr; middle &rarr; last third)</div>
      ${stamina.length ? stamina.slice(-10).reverse().map(staminaRow).join("") : '<span class="empty-inline">no long runs yet</span>'}
    </div>`;

    el.timeGoesBody.innerHTML = html;

    const tgEl = {};
    el.timeGoesBody.querySelectorAll("[data-el]").forEach((n) => { tgEl[n.dataset.el] = n; });

    if (tgEl.rhythmChart && rhythm) {
      const labels = rhythm.bins.map((_, i) => i * rhythm.bucket);
      labels.push(rhythm.max);
      drawBars(tgEl.rhythmChart, {
        labels,
        values: rhythm.bins.concat([rhythm.over]),
        color: cssVar("--main"),
      });
    }

    if (tgEl.consistencyChart) {
      const vals = logged.map((r) => E.consistency(r));
      drawLineChart(tgEl.consistencyChart, {
        xs: vals.map((_, i) => i + 1),
        series: [{ values: vals, color: cssVar("--main"), dots: vals.length < 30, line: true }],
        xLabel: (x) => (logged[x - 1] ? shortDate(logged[x - 1].ts) : ""),
        yMin: 0,
      });
    }
  }

  function render() {
    const all = store.results();
    renderFacetButtons(all);
    markFilter();
    const modeFiltered = E.filterResults(all, filter);
    const rs = filterByLangSource(modeFiltered, langFilter, sourceFilter).sort((a, b) => a.ts - b.ts);
    const s = E.summarize(rs);
    const trend = s.trend === 0 ? "" : `<small class="${s.trend > 0 ? "up" : "down"}">${s.trend > 0 ? "+" : ""}${s.trend}</small>`;
    const cons = avgConsistency(E, rs, CONSISTENCY_RECENT);
    const bBurst = bestBurstWpm(E, rs);
    el.tiles.innerHTML = [
      tile("tests", s.count),
      tile("best wpm", s.best),
      tile("wpm · last 10", s.avgRecent + trend),
      tile("wpm · overall", s.avgAll),
      tile("accuracy", s.acc + "%"),
      tile("consistency", cons == null ? "–" : cons),
      tile("best burst", bBurst ? bBurst + " wpm" : "–"),
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

    renderTimeGoes(rs);

    const p = E.errorProfile(rs);
    if (!p.tracked) {
      el.errPanel.innerHTML = "";
    } else if (p.avgErrors < 1 && !errorsExpanded) {
      el.errPanel.innerHTML = `<div class="near-perfect">near-perfect accuracy &#8212; errors hidden
        <button data-el="expandErrors" class="link-btn">show anyway</button></div>`;
      el.errPanel.querySelector("[data-el=expandErrors]").addEventListener("click", () => {
        errorsExpanded = true;
        render();
      });
    } else {
      const collapseBtn = p.avgErrors < 1
        ? `<button data-el="collapseErrors" class="link-btn">hide</button>` : "";
      el.errPanel.innerHTML =
        `<div class="chart-title">error breakdown · ${p.tracked} test${p.tracked === 1 ? "" : "s"} tracked ${collapseBtn}</div>` +
        errorBlock("weakest keys (miss rate)", p.keys.slice(0, 12).map((k) => keyChip(k.key, k.rate + "%", k.rate))) +
        errorBlock("common swaps", p.swaps.slice(0, 8).map((x) => swapChip(x.k, x.n))) +
        errorBlock("most missed words", p.words.slice(0, 12).map((w) => `<span class="chip word-chip">${esc(w.k)} <small>×${w.n}</small></span>`));
      const cb = el.errPanel.querySelector("[data-el=collapseErrors]");
      if (cb) cb.addEventListener("click", () => { errorsExpanded = false; render(); });
    }

    el.recent.innerHTML = rs.slice(-15).reverse().map((r) => {
      const consVal = hasLog(r) ? E.consistency(r) : "–";
      const hesVal = hasLog(r) ? E.hesitations(r).items.length : "–";
      return `<tr class="clickable" data-ts="${r.ts}"><td>${new Date(r.ts).toLocaleString()}</td><td>${E.modeKey(r)}</td>` +
        `<td class="num wpm">${r.wpm}</td><td class="num">${r.raw}</td><td class="num">${r.acc}%</td>` +
        `<td class="num">${consVal}</td><td class="num">${hesVal}</td>` +
        `<td class="num err">${r.chars ? r.chars.incorrect + r.chars.extra + r.chars.missed : "–"}</td></tr>`;
    }).join("");
  }

  el.recent.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-ts]");
    if (!tr) return;
    ctx.navigate(`/replay/${tr.dataset.ts}`);
  });

  el.exportBtn.addEventListener("click", () => {
    download(`typetrack-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.results(), null, 2), "application/json");
  });
  el.exportCsvBtn.addEventListener("click", () => {
    download(`typetrack-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(store.results(), E), "text/csv");
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
