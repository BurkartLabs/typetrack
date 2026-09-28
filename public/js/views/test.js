// The standard test: config bar (source, mode, length, language, list tier, hard modes, modifiers), typing
// surface, results screen with timing analysis.
import { loadCss, cssVar } from "../core/css.js";
import { createTyping, splitText } from "../core/typing.js";
import { drawLineChart, drawBars } from "../core/chart.js";
import { esc } from "../core/ui.js";
import words, { pick, punctuate, numberize, capitalize, interleave, tierFor, splitCode } from "../core/words.js";

const CONFIG_KEY = "config.v1"; // typetrack.config.v1, same as v1 (extended)
const CUSTOM_KEY = "custom.v1"; // typetrack.custom.v1: the pasted custom text
const BOOKS_KEY = "books.v1"; // typetrack.books.v1: { [bookId]: { para, total, title, ts } }
const LIST_NAMES = { "common-200": "200", "common-1k": "1k", "common-10k": "10k", rare: "rare" };
const TIERS = ["common-200", "common-1k", "common-10k"];
const DURATIONS = [15, 30, 60, 120, 180, 300];
const COUNTS = [25, 50, 100];
const TEXT_SOURCES = new Set(["quotes", "code", "custom", "book"]);
const COMMON_SOURCES = new Set(["words", "punctuation", "numbers", "capitals"]);
const HARD = { rare: "rare", punctuation: "punct", numbers: "123", capitals: "Aa", theme: "theme" };
const CODE_LANGS = ["js", "py", "cs", "sql", "rs", "sh"];
const ROMANISED = new Set(["ja", "zh", "ko"]);
const GEN = 1200; // words generated for ordered sources: 300 s at 200 wpm, plus slack

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

const btns = (attr, xs, label = (x) => x) => xs.map((x) => `<button data-${attr}="${x}">${label(x)}</button>`).join("");

const MARKUP = `
  <section class="view view-test">
    <div class="config-stack" data-el="configs">
      <div class="config">
        <div class="group">${btns("source", ["words", "quotes", "code", "custom", "book"])}</div>
        <span class="sep"></span>
        <div class="group" data-el="modeOpts">${btns("mode", ["time", "words"])}</div>
        <span class="sep" data-el="modeSep"></span>
        <div class="group" data-el="timeOpts">${btns("duration", DURATIONS)}</div>
        <div class="group" data-el="wordsOpts">${btns("count", COUNTS)}</div>
        <div class="group" data-el="codeOpts">${btns("code", CODE_LANGS)}</div>
        <div class="group" data-el="bookOpts"><select data-el="bookSel" title="book"></select></div>
        <div class="group" data-el="customOpts"><button data-act="editCustom">edit text</button></div>
      </div>
      <div class="config config-sub">
        <div class="group"><select data-el="langSel" title="language"></select></div>
        <span class="sep" data-el="tierSep"></span>
        <div class="group" data-el="tierOpts">${btns("tier", TIERS, (t) => LIST_NAMES[t])}</div>
        <span class="sep"></span>
        <div class="group" data-el="hardOpts">${Object.entries(HARD).map(([k, v]) => `<button data-hard="${k}" title="${k}">${v}</button>`).join("")}
          <select data-el="themeSel" title="theme pack"></select></div>
        <span class="sep"></span>
        <div class="more-wrap">
          <button data-act="more" data-el="moreBtn">more &#9662;</button>
          <div class="more-pop" data-el="more" hidden>
            <div class="row"><span class="label">backspace</span><div class="group">${btns("nobs", ["on", "off"])}</div></div>
            <div class="row"><span class="label">look-ahead</span><div class="group">${btns("look", [0, 1, 2, 3], (n) => (n ? n : "off"))}</div></div>
            <div class="row"><span class="label">pace caret</span><div class="group">${btns("pace", ["off", "pb", "custom"], (p) => (p === "pb" ? "pb+5%" : p))}
              <input data-el="paceInput" type="number" min="20" max="400" step="5" title="pace wpm"></div></div>
            <div class="row"><span class="label">accents</span><div class="group">${btns("accents", ["strict", "lenient"])}</div></div>
            <div class="row"><span class="label">mix with</span><div class="group"><select data-el="mixSel" title="second language"></select></div></div>
            <p class="pop-note" data-el="paceNote"></p>
          </div>
        </div>
      </div>
    </div>

    <div class="run-note" data-el="note"></div>

    <div class="custom-panel" data-el="customPanel" hidden>
      <textarea data-el="customText" rows="7" spellcheck="false" placeholder="paste an article, a chapter, your own code..."></textarea>
      <div class="custom-actions"><button data-act="saveCustom">save &amp; type</button><button data-act="cancelCustom">cancel</button></div>
    </div>

    <div data-el="typingWrap">
      <div data-el="typing"></div>
      <div class="hint" data-el="hint"></div>
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
      <div class="result-note" data-el="resNote"></div>
      <div class="error-panel" data-el="errPanel"></div>
      <div class="timing" data-el="timing">
        <div class="timing-stats" data-el="timingStats"></div>
        <div class="timing-row">
          <div class="rhythm-box"><span class="label">rhythm <small data-el="rhythmNote"></small></span><canvas data-el="rhythm" height="110"></canvas></div>
          <div class="pairs-box"><span class="label">slowest pairs</span><div class="chips" data-el="pairs"></div></div>
        </div>
        <div class="strip-box"><span class="label">your run <small>(underlined: a hesitation before that word)</small></span><div class="run-strip" data-el="strip"></div></div>
      </div>
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
  const config = Object.assign({
    mode: "time", duration: 30, wordCount: 50, source: "words", theme: null, codeLang: "js", book: null,
    noBackspace: false, lookAhead: 0, pace: "off", paceWpm: 150, mix: null,
  }, store.get(CONFIG_KEY, {}));
  if (config.mode !== "time" && config.mode !== "words") config.mode = "time";
  if (!DURATIONS.includes(config.duration)) config.duration = 30;
  let lastResult = null, run = null, buildId = 0, lastPick = null;

  const manifest = await words.manifest();
  if (!root.isConnected || !el.typing.isConnected) return; // navigated away while loading
  const langs = manifest.languages && manifest.languages.length ? manifest.languages : [{ code: "en", name: "english", dir: "ltr", lists: ["common-200"] }];
  const themes = manifest.themes || [];
  const books = manifest.books || [];
  const langEntry = (code) => langs.find((l) => l.code === code) || { code, name: code, dir: "ltr", lists: ["common-200"] };
  const langLabel = (l) => (ROMANISED.has(l.code) && !/roman|romaji|pinyin/i.test(l.name) ? l.name + " (romanised)" : l.name);
  if (!langs.some((l) => l.code === settings.get("lang"))) settings.set("lang", langs[0].code);
  if (config.mix && !langs.some((l) => l.code === config.mix)) config.mix = null;
  if (!config.theme || !themes.includes(config.theme)) config.theme = themes[0] || null;
  if (!config.book || !books.includes(config.book)) config.book = books[0] || null;

  // ── building a run ──────────────────────────────────────────────────
  const save = () => store.set(CONFIG_KEY, config);
  const bookState = () => store.get(BOOKS_KEY, {}) || {};

  function pbWpm(mode, target, lang) {
    let best = 0;
    for (const r of store.results()) {
      if (r.mode === mode && (target == null || r.target === target) && (r.lang || "en") === lang && r.wpm > best) best = r.wpm;
    }
    return best;
  }

  // → { opts for typing, meta for the result, note } or { blocked: note } when the source needs input first
  async function buildRun() {
    const lang = settings.get("lang");
    const L = langEntry(lang);
    const tier = tierFor(L, settings.get("list") || "common-1k");
    const src = config.source;
    const opts = {
      mode: config.mode, duration: config.duration, wordCount: config.wordCount, lang, dir: L.dir,
      accents: settings.get("accents"), noBackspace: !!config.noBackspace, lookAhead: Number(config.lookAhead) || 0,
      words: undefined, text: undefined, ordered: false, code: false, ghost: null, paceWpm: 0,
    };
    const meta = { source: src, lang, list: null };
    let note = "";
    const rand = Math.random;
    if (src === "words") {
      const pool = await words.list(lang, tier);
      meta.list = tier;
      if (config.mix && config.mix !== lang) {
        const M = langEntry(config.mix);
        const other = await words.list(config.mix, tierFor(M, tier));
        opts.words = interleave(pool, other, GEN, rand);
        opts.ordered = true;
        meta.source = "mixed:" + config.mix;
        note = `mixed: ${esc(langLabel(L))} + ${esc(langLabel(M))}, alternating`;
      } else opts.words = pool;
    } else if (src === "punctuation" || src === "numbers" || src === "capitals") {
      const pool = await words.list(lang, tier);
      meta.list = tier;
      const base = pick(pool, GEN, rand);
      opts.words = src === "punctuation" ? punctuate(base, rand) : src === "numbers" ? numberize(base, rand) : capitalize(base, rand);
      opts.ordered = true;
    } else if (src === "rare") {
      const has = (L.lists || []).includes("rare");
      opts.words = await words.list(has ? lang : "en", "rare");
      if (!has) { meta.lang = opts.lang = "en"; note = `no rare list for ${esc(langLabel(L))} yet: english rare words`; }
      meta.list = "rare";
    } else if (src === "theme") {
      const pool = config.theme ? await words.theme(config.theme) : [];
      if (!pool.length) return { blocked: "no theme packs available yet" };
      opts.words = pool;
      meta.source = "theme:" + config.theme;
      meta.lang = opts.lang = "en"; // theme packs are english
      opts.dir = "ltr";
    } else if (src === "quotes") {
      let qs = await words.quotes(lang), qlang = lang;
      if (!qs.length && lang !== "en") { qs = await words.quotes("en"); qlang = "en"; note = `no ${esc(langLabel(L))} quotes yet: english`; }
      if (!qs.length) return { blocked: "no quotes available yet" };
      let q;
      do q = qs[Math.floor(rand() * qs.length)]; while (qs.length > 1 && q === lastPick);
      lastPick = q;
      opts.mode = "text"; opts.text = q.text;
      meta.quoteSource = q.source || "";
      meta.lang = opts.lang = qlang;
      if (qlang !== lang) opts.dir = langEntry(qlang).dir;
    } else if (src === "code") {
      const snippets = await words.code(config.codeLang);
      if (!snippets.length) return { blocked: `no ${config.codeLang} snippets available yet` };
      const parts = [];
      let len = 0;
      for (const s of pick(snippets, 12, rand)) {
        if (parts.includes(s.text)) continue;
        parts.push(s.text); len += s.text.length;
        if (len >= 220) break;
      }
      opts.mode = "text"; opts.text = parts.join("\n"); opts.code = true; opts.dir = "ltr";
      meta.codeLang = config.codeLang;
      meta.lang = opts.lang = "en";
      note = "enter &#8212; new line &nbsp;&middot;&nbsp; indentation is typed for you";
    } else if (src === "custom") {
      const text = store.get(CUSTOM_KEY, "");
      if (!splitText(text).length) return { blocked: "custom", needsCustom: true };
      opts.mode = "text";
      opts.text = text;
      opts.code = /\n[ \t]+\S/.test(text); // keep line layout for pasted code
      note = `custom text &middot; ${splitText(text).length} words`;
    } else if (src === "book") {
      if (!config.book) return { blocked: "no books available yet" };
      const b = await words.book(config.book);
      if (!b || !b.paragraphs.length) return { blocked: "that book could not be loaded" };
      const st = bookState()[config.book] || {};
      let para = Number(st.para) || 0;
      if (para >= b.paragraphs.length) para = 0;
      opts.mode = "text"; opts.text = b.paragraphs[para];
      meta.book = { id: config.book, para, total: b.paragraphs.length, title: b.title || config.book };
      note = `${para ? "continue" : "start"}: <b>${esc(meta.book.title)}</b>${b.author ? " &middot; " + esc(b.author) : ""} &middot; paragraph ${para + 1} of ${b.paragraphs.length}` +
        (para ? ` &nbsp;<button class="link-btn" data-act="bookRestart">start over</button>` : "");
    }
    // pace caret: PB (same mode + target + language) + 5%, or a custom wpm
    el.paceNote.textContent = "";
    if (config.pace === "custom") opts.paceWpm = Number(config.paceWpm) || 0;
    else if (config.pace === "pb") {
      const target = opts.mode === "time" ? opts.duration : opts.mode === "words" ? opts.wordCount
        : (opts.code ? splitCode(opts.text).words : splitText(opts.text)).length;
      const pb = pbWpm(opts.mode, target, opts.lang);
      opts.paceWpm = pb ? Math.round(pb * 1.05) : 0;
      el.paceNote.textContent = pb ? `pace ${opts.paceWpm} wpm (pb ${Math.round(pb)} + 5%)` : "no pb yet for this test: no pace caret";
    }
    return { opts, meta, note };
  }

  function setNote(html) {
    el.note.innerHTML = html || "";
    el.note.hidden = !html;
  }

  function showTyping() {
    el.result.hidden = true;
    el.customPanel.hidden = true;
    el.typingWrap.hidden = false;
    lastResult = null;
  }

  async function newTest() {
    const id = ++buildId;
    const built = await buildRun();
    if (id !== buildId || !typing) return; // superseded or unmounted
    if (built.blocked) {
      run = null;
      el.result.hidden = true;
      el.typingWrap.hidden = true;
      if (built.needsCustom) { openCustom(); setNote(""); } else { el.customPanel.hidden = true; setNote(esc(built.blocked)); }
      return;
    }
    run = built;
    showTyping();
    setNote(built.note);
    el.hint.innerHTML = config.source === "code"
      ? "esc &#8212; restart &nbsp;&middot;&nbsp; tab &#8212; indent (automatic)"
      : "tab &#8212; restart &nbsp;&middot;&nbsp; esc &#8212; restart";
    typing.restart(built.opts);
  }

  typing = createTyping(el.typing, {
    words: words.FALLBACK, mode: config.mode, duration: config.duration, wordCount: config.wordCount,
    onRestart: () => { showTyping(); newTest(); },
    onFinish(r) {
      if (!run) return;
      const m = run.meta;
      r.source = m.source;
      r.lang = m.lang;
      if (m.list) r.list = m.list;
      if (m.quoteSource != null) r.quoteSource = m.quoteSource;
      if (m.codeLang) r.codeLang = m.codeLang;
      if (m.book) {
        r.book = { id: m.book.id, para: m.book.para };
        const all = bookState();
        all[m.book.id] = { para: m.book.para + 1, total: m.book.total, title: m.book.title, ts: Date.now() };
        store.set(BOOKS_KEY, all);
        fillSelects();
      }
      store.addResult(r);
      showResult(r, m);
    },
  });

  // ── results ─────────────────────────────────────────────────────────
  function sourceLabel(r, m) {
    const L = langLabel(langEntry(r.lang || "en"));
    const s = r.source || "words";
    const tier = LIST_NAMES[r.list] || "";
    if (s === "words") return `${L} ${tier}`;
    if (s.startsWith("mixed:")) return `${L} + ${langLabel(langEntry(s.slice(6)))} ${tier}`;
    if (s.startsWith("theme:")) return `theme ${s.slice(6)}`;
    if (s === "code") return `code ${r.codeLang}`;
    if (s === "book") return `book ¶${m.book.para + 1}`;
    if (COMMON_SOURCES.has(s)) return `${L} ${tier} ${s}`;
    return `${L} ${s}`;
  }

  function showResult(r, m) {
    lastResult = r;
    el.typingWrap.hidden = true;
    el.result.hidden = false;
    setNote("");
    el.wpm.textContent = Math.round(r.wpm);
    el.acc.textContent = Math.round(r.acc) + "%";
    el.type.textContent = `${r.mode === "text" ? "text " + r.target : E.modeKey(r)} · ${sourceLabel(r, m)}`;
    el.raw.textContent = Math.round(r.raw);
    el.chars.textContent = `${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`;
    el.time.textContent = r.duration + "s";
    const errCount = r.chars.incorrect + r.chars.extra + r.chars.missed;
    el.errors.textContent = errCount;

    const notes = [];
    if (m.quoteSource) notes.push(`<span class="quote-src">&#8212; ${esc(m.quoteSource)}</span>`);
    if (m.book) {
      const done = m.book.para + 1 >= m.book.total;
      notes.push(`<span>${esc(m.book.title)} &middot; paragraph ${m.book.para + 1} of ${m.book.total}${done ? " &middot; finished the book" : " &middot; place saved"}</span>`);
    }
    if (r.duration >= 180 || (r.mode === "time" && r.target >= 180)) {
      const s = E.staminaDrop(r);
      notes.push(`<span class="stamina"><span class="label">stamina</span> ${Math.round(s.first)} &#8594; ${Math.round(s.middle)} &#8594; ${Math.round(s.last)} wpm &middot; ` +
        `<b class="${s.drop > 5 ? "err" : ""}">${s.drop >= 0 ? "drop " + s.drop : "gain " + Math.abs(s.drop)}%</b> first third to last</span>`);
    }
    el.resNote.innerHTML = notes.join("");
    el.resNote.hidden = !notes.length;

    const p = E.errorProfile([r]);
    el.errPanel.innerHTML = errCount === 0 ? `<p class="clean">clean run &#8212; no errors</p>` :
      errorBlock("missed keys", p.keys.slice(0, 8).map((k) => keyChip(k.key, `${k.miss}/${k.hits}`, k.rate))) +
      errorBlock("typed instead", p.swaps.slice(0, 6).map((x) => swapChip(x.k, x.n))) +
      errorBlock("wrong words", r.errors.words.slice(0, 12).map((w) =>
        `<span class="chip word-chip"><s>${esc(w.typed)}</s> ${esc(w.word)}</span>`));
    el.result.classList.toggle("is-clean", errCount === 0);
    showTiming(r);
    drawResultChart(r);
  }

  function showTiming(r) {
    let cons = 0, b = { word: null, window: 0 }, hes = { items: [], median: 0 }, pairs = [];
    try { cons = E.consistency(r); b = E.burst(r); hes = E.hesitations(r); pairs = E.pairTimes([r], 1).slice(0, 5); } catch (err) { console.warn("[test] timing", err); }
    const stat = (label, value, sub) => `<div><span class="label">${label}</span><span class="v">${value}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    el.timingStats.innerHTML =
      stat("consistency", Math.round(cons) + "%") +
      stat("best word", b.word ? Math.round(b.word.wpm) : "—", b.word ? esc(b.word.word) : "") +
      stat("best 5 s", Math.round(b.window), "wpm") +
      stat("median gap", Math.round(hes.median || 0), "ms") +
      stat("hesitations", hes.items.length, hes.threshold ? `&gt; ${Math.round(hes.threshold)} ms` : "");
    el.pairs.innerHTML = pairs.length
      ? pairs.map((x) => `<span class="chip"><b>${esc(x.pair)}</b> <small>${Math.round(x.medianMs)} ms</small></span>`).join("")
      : `<span class="muted">not enough pairs</span>`;
    // your run: the words reached, a hesitation marked on the word it ended in
    const byWord = new Map();
    for (const h of hes.items) byWord.set(h.index, Math.max(byWord.get(h.index) || 0, h.gap));
    const list = (r.words || []).slice(0, 400);
    el.strip.innerHTML = list.map((w, i) => {
      const g = byWord.get(i);
      return g ? `<span class="hes" title="paused ${Math.round(g)} ms">${esc(w)}</span>` : `<span>${esc(w)}</span>`;
    }).join(" ") + ((r.words || []).length > 400 ? " &hellip;" : "");
    el.strip.dir = langEntry(r.lang || "en").dir === "rtl" && r.source !== "code" ? "rtl" : "ltr";
    drawRhythm(r);
  }

  function drawRhythm(r) {
    let rh;
    try { rh = E.rhythm(r, 10, 300); } catch { return; }
    el.rhythmNote.textContent = rh.count ? `median ${Math.round(rh.median)} ms · p90 ${Math.round(rh.p90)} ms` : "";
    const medBin = Math.min(rh.bins.length - 1, Math.floor((rh.median || 0) / rh.bucket));
    drawBars(el.rhythm, { values: rh.bins, labels: rh.bins.map((_, i) => i * rh.bucket), highlight: [medBin], minTop: 1 });
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

  // ── custom text ─────────────────────────────────────────────────────
  function openCustom() {
    el.typingWrap.hidden = true;
    el.result.hidden = true;
    el.customPanel.hidden = false;
    el.customText.value = store.get(CUSTOM_KEY, "") || "";
    el.customText.focus();
  }

  // ── config bar ──────────────────────────────────────────────────────
  function fillSelects() {
    const lang = settings.get("lang");
    el.langSel.innerHTML = langs.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? " selected" : ""}>${esc(langLabel(l))}</option>`).join("");
    el.mixSel.innerHTML = `<option value="">off</option>` + langs.filter((l) => l.code !== lang)
      .map((l) => `<option value="${esc(l.code)}"${l.code === config.mix ? " selected" : ""}>${esc(langLabel(l))}</option>`).join("");
    el.themeSel.innerHTML = themes.map((t) => `<option value="${esc(t)}"${t === config.theme ? " selected" : ""}>${esc(t)}</option>`).join("");
    const st = bookState();
    el.bookSel.innerHTML = books.length ? books.map((b) => {
      const s = st[b];
      const pos = s && s.total ? ` (${Math.min(s.para, s.total)}/${s.total})` : "";
      return `<option value="${esc(b)}"${b === config.book ? " selected" : ""}>${esc((s && s.title) || b)}${pos}</option>`;
    }).join("") : `<option value="">no books yet</option>`;
  }

  function renderConfig() {
    const src = config.source, text = TEXT_SOURCES.has(src);
    const on = (sel, pred) => root.querySelectorAll(sel).forEach((b) => b.classList.toggle("active", pred(b)));
    on("[data-source]", (b) => b.dataset.source === src);
    on("[data-hard]", (b) => b.dataset.hard === src);
    on("[data-mode]", (b) => b.dataset.mode === config.mode);
    on("[data-duration]", (b) => Number(b.dataset.duration) === config.duration);
    on("[data-count]", (b) => Number(b.dataset.count) === config.wordCount);
    on("[data-code]", (b) => b.dataset.code === config.codeLang);
    on("[data-nobs]", (b) => (b.dataset.nobs === "off") === !!config.noBackspace);
    on("[data-look]", (b) => Number(b.dataset.look) === (Number(config.lookAhead) || 0));
    on("[data-pace]", (b) => b.dataset.pace === config.pace);
    on("[data-accents]", (b) => b.dataset.accents === settings.get("accents"));
    const L = langEntry(settings.get("lang"));
    const tier = tierFor(L, settings.get("list") || "common-1k");
    root.querySelectorAll("[data-tier]").forEach((b) => {
      b.hidden = !(L.lists || []).includes(b.dataset.tier);
      b.classList.toggle("active", b.dataset.tier === tier);
    });
    el.modeOpts.hidden = el.modeSep.hidden = text;
    el.timeOpts.hidden = text || config.mode !== "time";
    el.wordsOpts.hidden = text || config.mode !== "words";
    el.codeOpts.hidden = src !== "code";
    el.bookOpts.hidden = src !== "book";
    el.customOpts.hidden = src !== "custom";
    el.tierOpts.hidden = el.tierSep.hidden = !COMMON_SOURCES.has(src);
    el.themeSel.hidden = src !== "theme" || !themes.length;
    el.paceInput.hidden = config.pace !== "custom";
    el.paceInput.value = config.paceWpm;
    const mods = [config.noBackspace && "no backspace", config.lookAhead && "look-ahead " + config.lookAhead,
      config.pace !== "off" && "pace caret", config.mix && src === "words" && "mixed"].filter(Boolean);
    el.moreBtn.innerHTML = (mods.length ? `more <b>${mods.length}</b>` : "more") + " &#9662;";
    el.moreBtn.classList.toggle("on", mods.length > 0);
    el.moreBtn.title = mods.join(", ") || "modifiers";
  }

  function apply() {
    save();
    renderConfig();
    newTest();
  }

  el.configs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.act === "more") { el.more.hidden = !el.more.hidden; b.blur(); return; }
    if (d.act === "editCustom") { openCustom(); b.blur(); return; }
    if (d.source) config.source = d.source;
    else if (d.hard) config.source = config.source === d.hard ? "words" : d.hard;
    else if (d.mode) config.mode = d.mode;
    else if (d.duration) config.duration = Number(d.duration);
    else if (d.count) config.wordCount = Number(d.count);
    else if (d.code) config.codeLang = d.code;
    else if (d.tier) settings.set("list", d.tier);
    else if (d.nobs) config.noBackspace = d.nobs === "off";
    else if (d.look != null) config.lookAhead = Number(d.look);
    else if (d.pace) config.pace = d.pace;
    else if (d.accents) settings.set("accents", d.accents);
    else return;
    b.blur(); // keep space from re-pressing the button
    apply();
  });

  el.configs.addEventListener("change", (e) => {
    const t = e.target;
    if (t === el.langSel) {
      settings.set("lang", t.value);
      if (config.mix === t.value) config.mix = null;
      fillSelects();
    } else if (t === el.mixSel) config.mix = t.value || null;
    else if (t === el.themeSel) config.theme = t.value;
    else if (t === el.bookSel) config.book = t.value || null;
    else if (t === el.paceInput) config.paceWpm = Math.max(20, Math.min(400, Number(t.value) || 150));
    else return;
    t.blur();
    apply();
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    const act = b && b.dataset.act;
    if (act === "saveCustom") {
      store.set(CUSTOM_KEY, el.customText.value);
      config.source = "custom";
      apply();
    } else if (act === "cancelCustom") {
      if (!splitText(store.get(CUSTOM_KEY, "")).length) config.source = "words";
      apply();
    } else if (act === "bookRestart") {
      const all = bookState();
      if (all[config.book]) { all[config.book].para = 0; store.set(BOOKS_KEY, all); }
      fillSelects();
      newTest();
    }
    if (!el.more.hidden && !e.target.closest(".more-wrap")) el.more.hidden = true;
  });

  el.next.addEventListener("click", () => { el.next.blur(); newTest(); });

  const onResize = () => { if (lastResult) { drawResultChart(lastResult); drawRhythm(lastResult); } };
  window.addEventListener("resize", onResize);
  cleanup.push(() => window.removeEventListener("resize", onResize));

  fillSelects();
  renderConfig();
  await newTest();
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default { mount, unmount };
