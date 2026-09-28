/* UI layer. All game rules live in engine.js; this file only renders and routes input. */
(function () {
  "use strict";
  const E = window.Engine;
  const STORE_KEY = "typetrack.results.v1";
  const CONFIG_KEY = "typetrack.config.v1";

  // ── persistence ───────────────────────────────────────────────────────
  function loadJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  const config = Object.assign({ mode: "time", duration: 30, wordCount: 50 }, loadJSON(CONFIG_KEY, {}));
  let results = loadJSON(STORE_KEY, []).filter(isResult);

  function isResult(r) {
    return r && typeof r.ts === "number" && typeof r.wpm === "number" && typeof r.acc === "number" &&
      (r.mode === "time" || r.mode === "words") && typeof r.target === "number";
  }

  // ── elements ──────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    body: document.body,
    viewTest: $("view-test"), viewStats: $("view-stats"),
    config: $("config"), timeOpts: $("time-opts"), wordsOpts: $("words-opts"),
    typing: $("typing"), counter: $("counter"), words: $("words"), caret: $("caret"),
    result: $("result"), rWpm: $("r-wpm"), rAcc: $("r-acc"), rChart: $("r-chart"),
    rType: $("r-type"), rRaw: $("r-raw"), rChars: $("r-chars"), rTime: $("r-time"), rErrors: $("r-errors"), rErrPanel: $("r-errpanel"), sErrPanel: $("s-errpanel"), nextBtn: $("next-btn"),
    tiles: $("tiles"), sChart: $("s-chart"), sTip: $("s-tip"), sEmpty: $("s-empty"),
    recent: $("recent").querySelector("tbody"), statsModes: $("stats-modes"),
    exportBtn: $("export-btn"), importFile: $("import-file"), clearBtn: $("clear-btn"),
  };

  // ── test lifecycle ────────────────────────────────────────────────────
  let test = null;
  let timer = null;
  let statsFilter = "all";
  let lastCaretWord = -1;

  function newTest() {
    clearInterval(timer);
    test = E.createTest({ mode: config.mode, duration: config.duration, wordCount: config.wordCount, words: window.WORDS });
    el.body.classList.remove("typing-active");
    el.result.hidden = true;
    el.typing.hidden = false;
    renderWords();
    updateCounter();
    placeCaret();
    timer = setInterval(onTick, 100);
  }

  function onTick() {
    if (!test || !E.isRunning(test)) return;
    E.tick(test, Date.now());
    updateCounter();
    if (test.finishedAt !== null) finishTest();
  }

  function finishTest() {
    clearInterval(timer);
    const r = E.results(test);
    r.ts = Date.now();
    results.push(r);
    saveJSON(STORE_KEY, results);
    showResult(r);
  }

  function updateCounter() {
    if (!test) return;
    if (test.mode === "time") {
      const left = test.startedAt === null ? test.duration : Math.max(0, Math.ceil(test.duration - E.elapsedMs(test, Date.now()) / 1000));
      el.counter.textContent = left;
    } else {
      el.counter.textContent = Math.min(test.index, test.wordCount) + "/" + test.wordCount;
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" || (e.key === "Escape" && !e.repeat)) {
      e.preventDefault();
      if (location.hash === "#stats") return;
      newTest();
      return;
    }
    if (!test || location.hash === "#stats" || !el.result.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      E.backspace(test);
      renderWord(test.index); renderWord(test.index + 1);
      placeCaret();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      const before = test.index;
      E.space(test, Date.now());
      afterInput(before);
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      E.input(test, e.key, Date.now());
      afterInput(test.index);
    }
  });

  function afterInput(prevIndex) {
    el.body.classList.add("typing-active");
    if (test.words.length !== el.words.childElementCount) renderWords();
    else { renderWord(prevIndex); renderWord(test.index); }
    updateCounter();
    placeCaret();
    if (test.finishedAt !== null) finishTest();
  }

  // ── word rendering ────────────────────────────────────────────────────
  function renderWords() {
    const frag = document.createDocumentFragment();
    test.words.forEach((_, i) => frag.appendChild(buildWord(i)));
    el.words.replaceChildren(frag);
    el.words.style.transform = "translateY(0)";
    lastCaretWord = -1;
  }

  function buildWord(i) {
    const word = test.words[i];
    const typed = test.typed[i] || "";
    const w = document.createElement("div");
    w.className = "word";
    const done = i < test.index;
    if (done && typed !== word) w.classList.add("error");
    for (let k = 0; k < word.length; k++) {
      const s = document.createElement("span");
      s.className = "letter";
      s.textContent = word[k];
      if (k < typed.length) s.classList.add(typed[k] === word[k] ? "ok" : "bad");
      w.appendChild(s);
    }
    for (let k = word.length; k < typed.length; k++) {
      const s = document.createElement("span");
      s.className = "letter extra";
      s.textContent = typed[k];
      w.appendChild(s);
    }
    return w;
  }

  function renderWord(i) {
    if (i < 0 || i >= test.words.length) return;
    const old = el.words.children[i];
    if (old) el.words.replaceChild(buildWord(i), old);
  }

  function placeCaret() {
    const w = el.words.children[test.index];
    if (!w) return;
    const typed = test.typed[test.index] || "";
    const letters = w.children;
    let left, top;
    if (typed.length < letters.length) {
      const l = letters[typed.length];
      left = l.offsetLeft; top = l.offsetTop;
    } else {
      const l = letters[letters.length - 1];
      left = l.offsetLeft + l.offsetWidth; top = l.offsetTop;
    }
    // scroll so the current line is the middle one once we're past the first line
    const lineH = w.offsetHeight;
    const shift = Math.max(0, Math.round(top / lineH) - 1) * lineH;
    el.words.style.transform = `translateY(${-shift}px)`;
    el.caret.style.left = left + "px";
    el.caret.style.top = top - shift + lineH * 0.82 + "px";
    if (lastCaretWord !== test.index) lastCaretWord = test.index;
  }

  // ── results view ──────────────────────────────────────────────────────
  function showResult(r) {
    el.typing.hidden = true;
    el.result.hidden = false;
    el.body.classList.remove("typing-active");
    el.rWpm.textContent = Math.round(r.wpm);
    el.rAcc.textContent = Math.round(r.acc) + "%";
    el.rType.textContent = E.modeKey(r) + " · english 200";
    el.rRaw.textContent = Math.round(r.raw);
    el.rChars.textContent = `${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`;
    el.rTime.textContent = r.duration + "s";
    const errCount = r.chars.incorrect + r.chars.extra + r.chars.missed;
    el.rErrors.textContent = errCount;
    const p = E.errorProfile([r]);
    el.rErrPanel.innerHTML = errCount === 0 ? `<p class="clean">no errors — clean run</p>` :
      errorBlock("missed keys", p.keys.slice(0, 8).map((k) => keyChip(k.key, `${k.miss}/${k.hits}`, k.rate))) +
      errorBlock("typed instead", p.swaps.slice(0, 6).map((x) => swapChip(x.k, x.n))) +
      errorBlock("wrong words", r.errors.words.slice(0, 12).map((w) =>
        `<span class="chip word-chip"><s>${esc(w.typed)}</s> ${esc(w.word)}</span>`));
    drawLineChart(el.rChart, {
      xs: r.perSecond.map((_, i) => i + 1),
      bars: r.errors.perSecond,
      series: [{ values: r.perSecond, color: css("--caret"), dots: false }],
      xLabel: (x) => x + "s",
      yMin: 0,
    });
  }
  el.nextBtn.addEventListener("click", newTest);

  // ── config bar ────────────────────────────────────────────────────────
  el.config.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mode) config.mode = b.dataset.mode;
    if (b.dataset.duration) config.duration = Number(b.dataset.duration);
    if (b.dataset.count) config.wordCount = Number(b.dataset.count);
    saveJSON(CONFIG_KEY, config);
    renderConfig();
    newTest();
  });

  function renderConfig() {
    el.config.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === config.mode));
    el.timeOpts.hidden = config.mode !== "time";
    el.wordsOpts.hidden = config.mode !== "words";
    el.timeOpts.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.duration) === config.duration));
    el.wordsOpts.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.count) === config.wordCount));
  }

  // ── stats view ────────────────────────────────────────────────────────
  el.statsModes.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    statsFilter = b.dataset.filter;
    el.statsModes.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderStats();
  });

  function renderStats() {
    const rs = E.filterResults(results, statsFilter).sort((a, b) => a.ts - b.ts);
    const s = E.summarize(rs);
    const trend = s.trend === 0 ? "" : `<small class="${s.trend > 0 ? "up" : "down"}">${s.trend > 0 ? "+" : ""}${s.trend}</small>`;
    el.tiles.innerHTML = [
      tile("tests", s.count),
      tile("best wpm", s.best),
      tile("avg wpm (last 10)", s.avgRecent + trend),
      tile("avg wpm (all)", s.avgAll),
      tile("avg accuracy", s.acc + "%"),
      tile("avg errors / test", E.errorProfile(rs).avgErrors),
      tile("time typed", fmtDuration(s.seconds)),
    ].join("");

    el.sEmpty.hidden = rs.length > 0;
    drawLineChart(el.sChart, {
      xs: rs.map((_, i) => i + 1),
      series: [
        { values: rs.map((r) => r.wpm), color: css("--main"), dots: true, line: rs.length < 2 },
        { values: E.movingAverage(rs.map((r) => r.wpm), 10), color: css("--text"), dots: false },
      ],
      xLabel: (x) => (rs[x - 1] ? shortDate(rs[x - 1].ts) : ""),
      yMin: 0,
      hover: (i, px, py) => {
        const r = rs[i];
        if (!r) { el.sTip.hidden = true; return; }
        el.sTip.innerHTML = `<b>${r.wpm} wpm</b> · ${r.acc}% acc<br>${E.modeKey(r)} · ${new Date(r.ts).toLocaleString()}`;
        el.sTip.style.left = px + "px";
        el.sTip.style.top = py + "px";
        el.sTip.hidden = false;
      },
    });

    const p = E.errorProfile(rs);
    el.sErrPanel.innerHTML = !p.tracked ? "" :
      `<div class="chart-title">error breakdown · ${p.tracked} test${p.tracked === 1 ? "" : "s"} tracked</div>` +
      errorBlock("weakest keys (miss rate)", p.keys.slice(0, 12).map((k) => keyChip(k.key, k.rate + "%", k.rate))) +
      errorBlock("common swaps", p.swaps.slice(0, 8).map((x) => swapChip(x.k, x.n))) +
      errorBlock("most missed words", p.words.slice(0, 12).map((w) => `<span class="chip word-chip">${esc(w.k)} <small>×${w.n}</small></span>`));

    el.recent.innerHTML = rs.slice(-15).reverse().map((r) =>
      `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${E.modeKey(r)}</td>` +
      `<td class="num wpm">${r.wpm}</td><td class="num">${r.raw}</td><td class="num">${r.acc}%</td>` +
      `<td class="num err">${r.chars ? r.chars.incorrect + r.chars.extra + r.chars.missed : "–"}</td></tr>`).join("");
  }

  function errorBlock(title, chips) {
    if (!chips.length) return "";
    return `<div class="err-block"><span class="label">${title}</span><div class="chips">${chips.join("")}</div></div>`;
  }
  // heat: miss rate 0-100 tints the chip border from dim to full red
  function keyChip(key, note, rate) {
    const a = Math.min(1, 0.25 + rate / 60).toFixed(2);
    return `<span class="chip key-chip" style="--heat:${a}"><b>${key === " " ? "␣" : esc(key)}</b><small>${note}</small></span>`;
  }
  function swapChip(k, n) {
    const [exp, got] = k.split(">");
    return `<span class="chip">${esc(exp)} → <span class="err">${esc(got)}</span> <small>×${n}</small></span>`;
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function tile(label, value) {
    return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  }
  function fmtDuration(sec) {
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m ${sec % 60}s`;
  }
  function shortDate(ts) {
    const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  // ── data actions ──────────────────────────────────────────────────────
  el.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `typetrack-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  el.importFile.addEventListener("change", async () => {
    const f = el.importFile.files[0];
    if (!f) return;
    try {
      const incoming = JSON.parse(await f.text());
      if (!Array.isArray(incoming)) throw new Error("not an array");
      const seen = new Set(results.map((r) => r.ts));
      const added = incoming.filter((r) => isResult(r) && !seen.has(r.ts));
      results = results.concat(added).sort((a, b) => a.ts - b.ts);
      saveJSON(STORE_KEY, results);
      renderStats();
      alert(`imported ${added.length} result${added.length === 1 ? "" : "s"}`);
    } catch (err) {
      alert("could not import: " + err.message);
    }
    el.importFile.value = "";
  });
  el.clearBtn.addEventListener("click", () => {
    if (!confirm(`delete all ${results.length} results? export first if you want a backup.`)) return;
    results = [];
    saveJSON(STORE_KEY, results);
    renderStats();
  });

  // ── minimal canvas line chart ─────────────────────────────────────────
  // opts: { xs, series: [{values, color, dots, line}], xLabel(x), yMin, hover(i, px, py) }
  const chartState = new WeakMap();
  function drawLineChart(canvas, opts) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const cssH = Number(canvas.getAttribute("height"));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = { l: 40, r: 12, t: 10, b: 24 };
    const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b;
    const n = opts.xs.length;
    const all = opts.series.flatMap((s) => s.values).filter(Number.isFinite);
    const yMin = opts.yMin ?? 0;
    // round tick step (10/20/25/50/100…) so axis labels are whole, round numbers
    const top = Math.max(10, Math.max(...all, 0) * 1.1);
    const rough = (top - yMin) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough);
    const steps = Math.ceil((top - yMin) / step);
    const yMax = yMin + steps * step;
    const x = (i) => pad.l + (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v) => pad.t + H - ((v - yMin) / (yMax - yMin)) * H;

    ctx.font = "11px " + css("--font");
    ctx.textBaseline = "middle";
    // horizontal grid, 4 lines, recessive
    const sub = css("--sub");
    ctx.strokeStyle = sub; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
    ctx.fillStyle = sub;
    for (let k = 0; k <= steps; k++) {
      const v = yMin + ((yMax - yMin) * k) / steps;
      const yy = y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + W, yy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.textAlign = "right"; ctx.fillText(String(Math.round(v)), pad.l - 8, yy); ctx.globalAlpha = 0.25;
    }
    ctx.globalAlpha = 1;
    // x labels: at most ~8, evenly spaced
    if (n > 0 && opts.xLabel) {
      ctx.textAlign = "center";
      const every = Math.max(1, Math.ceil(n / 8));
      for (let i = 0; i < n; i += every) {
        ctx.fillText(opts.xLabel(opts.xs[i]), x(i), cssH - pad.b / 2);
      }
    }
    // error bars on their own scale, bottom 35% of the plot, max labelled on the right
    if (opts.bars && opts.bars.some((v) => v > 0)) {
      const bMax = Math.max(...opts.bars);
      const bw = Math.max(3, Math.min(14, (W / Math.max(1, n)) * 0.5));
      ctx.fillStyle = css("--error"); ctx.globalAlpha = 0.7;
      opts.bars.forEach((v, i) => {
        if (!v) return;
        const h = (v / bMax) * H * 0.35;
        ctx.fillRect(x(i) - bw / 2, pad.t + H - h, bw, h);
      });
      ctx.globalAlpha = 1;
    }
    // series
    for (const s of opts.series) {
      if (s.line !== false) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round";
        ctx.beginPath();
        s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
        if (n > 1) ctx.stroke();
      }
      if (s.dots) {
        ctx.fillStyle = s.color;
        s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 4, 0, Math.PI * 2); ctx.fill(); });
      }
    }
    chartState.set(canvas, { x, y, n, pad, W, opts });
  }

  el.sChart.addEventListener("mousemove", (e) => {
    const st = chartState.get(el.sChart);
    if (!st || !st.n || !st.opts.hover) return;
    const rect = el.sChart.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = st.n <= 1 ? 0 : Math.round(((mx - st.pad.l) / st.W) * (st.n - 1));
    if (i < 0 || i >= st.n) { el.sTip.hidden = true; return; }
    const v = st.opts.series[0].values[i];
    st.opts.hover(i, st.x(i), st.y(v) - 6);
  });
  el.sChart.addEventListener("mouseleave", () => { el.sTip.hidden = true; });

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ── routing ───────────────────────────────────────────────────────────
  function route() {
    const stats = location.hash === "#stats";
    el.viewTest.hidden = stats;
    el.viewStats.hidden = !stats;
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (stats ? "stats" : "test")));
    if (stats) { el.body.classList.remove("typing-active"); renderStats(); }
    else if (!test || test.finishedAt !== null || E.isRunning(test)) newTest();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => {
    if (location.hash === "#stats") renderStats();
    else if (test && test.finishedAt === null) placeCaret();
  });

  renderConfig();
  route();
})();
