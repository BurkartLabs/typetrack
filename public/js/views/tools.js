// Tools: keyboard tester, input latency check, data export/import. Not part of the main nav
// (linked from settings). Uses its own document-level key listeners (not keys.js's single active
// handler — this page wants every key, held state and keyup, not just the typing surface's input).
import { loadCss } from "../core/css.js";
import { esc, toast } from "../core/ui.js";
import layout from "../core/layout.js";
import keys from "../core/keys.js";

// ── CSV export (pure, tested in test/settings.test.js) ─────────────────────────────────────────
export const CSV_COLUMNS = ["date", "lang", "source", "mode", "target", "wpm", "raw", "acc", "duration"];

export function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// One row per result: date, lang, source, mode, target, wpm, raw, acc, duration.
export function resultRow(r) {
  return [
    r.ts ? new Date(r.ts).toISOString() : "",
    r.lang || "",
    r.source || "",
    r.mode || "",
    r.target != null ? r.target : "",
    r.wpm != null ? r.wpm : "",
    r.raw != null ? r.raw : "",
    r.acc != null ? r.acc : "",
    r.duration != null ? r.duration : "",
  ];
}

export function buildCsv(results) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of results || []) lines.push(resultRow(r).map(csvEscape).join(","));
  return lines.join("\n");
}

// ── latency stats (pure) ────────────────────────────────────────────────────────────────────────
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

const LATENCY_SAMPLES = 50;

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const MARKUP = `
  <section class="view view-tools">
    <div class="tools-head">
      <h1 class="tools-h1">tools</h1>
      <a href="#/settings" class="back-link">&larr; settings</a>
    </div>

    <section class="tool-block">
      <h2 class="tool-title">keyboard tester</h2>
      <div class="kb-meta">
        <span>layout: <b data-el="kbLayout"></b></span>
        <span>held: <b data-el="kbHeld">0</b></span>
        <span>max rollover: <b data-el="kbMax">0</b></span>
        <button type="button" data-el="kbReset">reset</button>
      </div>
      <div class="keyboard" data-el="keyboard"></div>
      <div class="kb-readout" data-el="kbReadout">press any key&hellip;</div>
    </section>

    <section class="tool-block">
      <h2 class="tool-title">input latency</h2>
      <p class="tool-note">measures the browser-side leg only: time from the keydown event to this
        page processing it and to the next painted frame. it does not include keyboard scan rate,
        OS/driver latency or display lag &mdash; real end-to-end latency is higher.</p>
      <button type="button" data-el="latStart">start (${LATENCY_SAMPLES} presses)</button>
      <div class="lat-progress" data-el="latProgress"></div>
      <div class="tiles lat-stats" data-el="latStats"></div>
    </section>

    <section class="tool-block">
      <h2 class="tool-title">data</h2>
      <div class="data-actions">
        <button type="button" data-el="exportJson">export json</button>
        <button type="button" data-el="exportCsv">export csv</button>
        <label class="file-btn">import json<input type="file" data-el="importFile" accept="application/json,.json"></label>
      </div>
    </section>
  </section>`;

let cleanup = [];

async function mount(root, ctx) {
  const { store, settings } = ctx;
  await loadCss("css/tools.css");
  root.innerHTML = MARKUP;
  const el = {};
  root.querySelectorAll("[data-el]").forEach((n) => { el[n.dataset.el] = n; });

  // ── keyboard tester ──────────────────────────────────────────────────────────────────────────
  const held = new Map(); // code -> downAt (performance.now())
  let maxHeld = 0;
  const keyEls = new Map(); // code -> element

  function buildKeyboard() {
    const layoutName = settings.get("layout") || "qwerty";
    el.kbLayout.textContent = layout.LABELS[layoutName] || layoutName;
    const rows = layout.keyboardRows(layoutName);
    const extra = {
      0: [{ code: "Backspace", label: "⌫", wide: true }],
      1: [{ code: "Tab", label: "tab" }],
      2: [{ code: "Enter", label: "⏎", wide: true, end: true }],
      3: [{ code: "ShiftLeft", label: "shift" }, { code: "ShiftRight", label: "shift", end: true }],
    };
    el.keyboard.innerHTML = "";
    keyEls.clear();
    rows.forEach((row, i) => {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      const lead = (extra[i] || []).filter((k) => !k.end);
      const trail = (extra[i] || []).filter((k) => k.end);
      [...lead, ...row.map((k) => ({ code: k.code, label: k.label })), ...trail].forEach((k) => {
        const b = document.createElement("div");
        b.className = "kb-key" + (k.wide ? " wide" : "");
        b.dataset.code = k.code;
        b.textContent = k.label;
        rowEl.appendChild(b);
        keyEls.set(k.code, b);
      });
      el.keyboard.appendChild(rowEl);
    });
    const spaceRow = document.createElement("div");
    spaceRow.className = "kb-row";
    const space = document.createElement("div");
    space.className = "kb-key space";
    space.dataset.code = "Space";
    space.textContent = "space";
    spaceRow.appendChild(space);
    el.keyboard.appendChild(spaceRow);
    keyEls.set("Space", space);
  }
  buildKeyboard();

  function resetTester() {
    held.clear();
    maxHeld = 0;
    keyEls.forEach((n) => n.classList.remove("down", "seen"));
    el.kbHeld.textContent = "0";
    el.kbMax.textContent = "0";
    el.kbReadout.textContent = "press any key…";
  }
  el.kbReset.addEventListener("click", resetTester);
  const offSettings = ctx.bus.on("settings:changed", (d) => { if (!d.key || d.key === "layout") buildKeyboard(); });
  cleanup.push(offSettings);

  // ── latency check ────────────────────────────────────────────────────────────────────────────
  let latSamples = [];
  let latActive = false;

  function renderLatProgress() {
    el.latProgress.textContent = latActive ? `press any key… ${latSamples.length} / ${LATENCY_SAMPLES}` : "";
  }
  function tile(label, value) { return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`; }
  function finishLatency() {
    latActive = false;
    const paint = latSamples.map((s) => s.paint).sort((a, b) => a - b);
    el.latStats.innerHTML = [
      tile("min", paint[0].toFixed(1) + "ms"),
      tile("median", percentile(paint, 0.5).toFixed(1) + "ms"),
      tile("p95", percentile(paint, 0.95).toFixed(1) + "ms"),
    ].join("");
    el.latProgress.textContent = "done — start again for another run";
  }
  el.latStart.addEventListener("click", () => {
    latSamples = [];
    latActive = true;
    el.latStats.innerHTML = "";
    renderLatProgress();
  });

  // ── shared keydown/keyup (bypasses keys.js on purpose, see header note) ────────────────────────
  function onKeydown(e) {
    if (keys.inField(e)) return;
    const code = e.code;
    if (!held.has(code)) {
      held.set(code, performance.now());
      maxHeld = Math.max(maxHeld, held.size);
      el.kbHeld.textContent = String(held.size);
      el.kbMax.textContent = String(maxHeld);
    }
    const ev = layout.remap(e, settings.get("layout"));
    const keyEl = keyEls.get(code);
    if (keyEl) { keyEl.classList.add("down", "seen"); }
    el.kbReadout.innerHTML = `key <b>${esc(ev.key)}</b> &middot; code <b>${esc(code)}</b> &middot; repeat <b>${e.repeat}</b>`;

    if (latActive) {
      const evTime = e.timeStamp;
      const handlerNow = performance.now();
      let recorded = false;
      const record = (paintTime) => {
        if (recorded) return;
        recorded = true;
        latSamples.push({ proc: handlerNow - evTime, paint: paintTime - evTime });
        if (latSamples.length >= LATENCY_SAMPLES) finishLatency();
        else renderLatProgress();
      };
      requestAnimationFrame(record);
      // rAF never fires on a tab that isn't actually being composited (backgrounded/occluded) —
      // fall back to a timed callback after 200ms so the test still finishes instead of hanging.
      setTimeout(() => record(performance.now()), 200);
    }
  }
  function onKeyup(e) {
    const code = e.code;
    const downAt = held.get(code);
    held.delete(code);
    el.kbHeld.textContent = String(held.size);
    const keyEl = keyEls.get(code);
    if (keyEl) keyEl.classList.remove("down");
    if (downAt != null) {
      const dur = Math.round(performance.now() - downAt);
      const ev = layout.remap(e, settings.get("layout"));
      el.kbReadout.innerHTML = `key <b>${esc(ev.key)}</b> &middot; code <b>${esc(code)}</b> &middot; held <b>${dur}ms</b>`;
    }
  }
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("keyup", onKeyup);
  cleanup.push(() => document.removeEventListener("keydown", onKeydown));
  cleanup.push(() => document.removeEventListener("keyup", onKeyup));

  // ── data: export / import ───────────────────────────────────────────────────────────────────
  el.exportJson.addEventListener("click", () => {
    download(`typetrack-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.results(), null, 2), "application/json");
  });
  el.exportCsv.addEventListener("click", () => {
    download(`typetrack-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(store.results()), "text/csv");
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
      toast(`imported ${added.length} result${added.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast("could not import: " + err.message);
    }
    el.importFile.value = "";
  });
}

function unmount() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default { mount, unmount };
