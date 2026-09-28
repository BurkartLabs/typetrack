// The reusable typing surface (Test, Train, text-based games). Renders words + caret; every rule lives
// in window.Engine. Newer engine features (keystroke log, stateAt, noBackspace, accents) are
// feature-detected so this works before and after the engine is extended.
//
// createTyping(el, {
//   words?: string[]        pool for time/words mode (random picks)
//   text?: string           mode 'text': type this exact text, in order (quotes, code, books)
//   mode: 'time'|'words'|'text', duration, wordCount,
//   noBackspace, lookAhead (show only the next N words), blind (no correctness shown until the end),
//   mirror (each word rendered reversed), accents ('lenient'|'strict'), paceWpm (faint pace caret),
//   ghost: {words, log} (a second caret replaying a run; the test uses the ghost's words),
//   lang, seed, keys (false = don't take the keyboard, call handleKey yourself),
//   onStart(), onProgress(state), onFinish(result), onRestart()
// }) -> { restart(opts?), destroy(), handleKey(e), test }
import keys from "./keys.js";
import settings from "./settings.js";
import { FALLBACK } from "./words.js";

const CARET_TOP = { underline: 0.82, line: 0.2, block: 0.2 };

export function splitText(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

// Where a caret moving at `wpm` is after `ms`: {index, typed} counting word.length + 1 per word.
export function paceAt(words, wpm, ms) {
  let chars = Math.max(0, (wpm * 5 * ms) / 60000);
  for (let i = 0; i < words.length; i++) {
    const len = words[i].length + 1;
    if (chars < len) return { index: i, typed: Math.min(Math.floor(chars), words[i].length) };
    chars -= len;
  }
  const last = words.length - 1;
  return { index: Math.max(0, last), typed: last >= 0 ? words[last].length : 0 };
}

export function createTyping(el, options = {}) {
  const E = window.Engine;
  let o = Object.assign({ mode: "time", duration: 30, wordCount: 50 }, options);
  let test = null, fixed = null, log = [], finished = false, started = false;
  let timer = null, raf = 0, shift = 0;

  el.classList.add("typing");
  el.innerHTML =
    '<div class="counter"></div>' +
    '<div class="words-window"><div class="words"></div>' +
    '<div class="caret pace-caret" hidden></div><div class="caret ghost-caret" hidden></div>' +
    '<div class="caret main-caret"></div></div>';
  const counterEl = el.querySelector(".counter");
  const wordsEl = el.querySelector(".words");
  const caretEl = el.querySelector(".main-caret");
  const paceEl = el.querySelector(".pace-caret");
  const ghostEl = el.querySelector(".ghost-caret");

  const removeKeys = o.keys === false ? () => {} : keys.set(handleKey);
  const onResize = () => { if (test) placeCarets(); };
  window.addEventListener("resize", onResize);

  // ── lifecycle ─────────────────────────────────────────────────────────
  function build() {
    stopTimers();
    finished = false; started = false; log = []; shift = 0;
    const engMode = o.mode === "time" ? "time" : "words";
    if (o.mode === "text") fixed = splitText(o.text != null ? o.text : (o.words || []).join(" "));
    else if (o.ghost && Array.isArray(o.ghost.words) && o.ghost.words.length) fixed = o.ghost.words.slice();
    else fixed = null;
    let pool = o.words && o.words.length ? o.words : fixed && fixed.length ? fixed : FALLBACK;
    if (o.mode === "text" && (!fixed || !fixed.length)) fixed = pool.slice(0, 1);
    const wordCount = fixed && engMode === "words" ? fixed.length : Number(o.wordCount) || 50;
    test = E.createTest({
      mode: engMode, duration: o.duration, wordCount, words: pool, seed: o.seed,
      noBackspace: !!o.noBackspace, accents: o.accents || settings.get("accents"), lang: o.lang,
    });
    if (fixed) {
      test.words = fixed.slice();
      if (engMode === "words") test.wordCount = fixed.length;
    }
    el.classList.toggle("blind", !!o.blind);
    el.classList.toggle("mirror", !!o.mirror);
    const caretStyle = CARET_TOP[settings.get("caret")] ? settings.get("caret") : "underline";
    el.dataset.caret = caretStyle;
    el.style.maxWidth = (o.width || settings.get("width") || 1000) + "px";
    counterEl.hidden = !!(o.hideCounter || settings.get("hideTimer"));
    document.body.classList.remove("typing-active");
    renderWords();
    updateCounter();
    placeCarets();
    timer = setInterval(onTick, 100);
  }

  function restart(newOpts) {
    if (newOpts) o = Object.assign({}, o, newOpts);
    build();
  }

  function destroy() {
    stopTimers();
    removeKeys();
    window.removeEventListener("resize", onResize);
    document.body.classList.remove("typing-active");
    el.replaceChildren();
    el.classList.remove("blind", "mirror");
    test = null;
  }

  function stopTimers() {
    clearInterval(timer); timer = null;
    cancelAnimationFrame(raf); raf = 0;
  }

  function onTick() {
    if (!test || !E.isRunning(test)) return;
    E.tick(test, Date.now());
    updateCounter();
    if (test.finishedAt !== null) finish();
  }

  function frame() {
    raf = 0;
    if (!test || finished) return;
    placeSecondaryCarets();
    if (started) raf = requestAnimationFrame(frame);
  }

  function finish() {
    if (finished) return;
    finished = true;
    stopTimers();
    const r = E.results(test);
    r.ts = Date.now();
    r.words = test.words.slice(0, test.index + 1);
    r.lang = o.lang || settings.get("lang");
    if (!Array.isArray(r.log)) r.log = log;
    if (o.mode === "text") { r.mode = "text"; r.target = fixed.length; }
    const flags = ["noBackspace", "blind", "mirror", "lookAhead", "paceWpm"].filter((k) => o[k]);
    if (flags.length) r.flags = Object.fromEntries(flags.map((k) => [k, o[k]]));
    document.body.classList.remove("typing-active");
    if (o.blind) { el.classList.remove("blind"); renderWords(); }
    paceEl.hidden = true; ghostEl.hidden = true;
    if (o.onFinish) o.onFinish(r);
  }

  // ── input ─────────────────────────────────────────────────────────────
  function record(k, now) {
    if (Array.isArray(test.log)) return; // the engine keeps its own log
    log.push([test.startedAt === null ? 0 : now - test.startedAt, k]);
  }

  function handleKey(e) {
    if (!test || keys.inField(e)) return;
    if (e.key === "Tab" || (e.key === "Escape" && !e.repeat)) {
      e.preventDefault();
      restart();
      if (o.onRestart) o.onRestart();
      return;
    }
    if (finished) return;
    const altGr = e.ctrlKey && e.altKey; // AltGr on Windows arrives as ctrl+alt
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
    const now = Date.now();
    if (e.key === "Backspace") {
      e.preventDefault();
      if (o.noBackspace) return;
      const before = test.index;
      E.backspace(test);
      record("\b", now);
      if (test.index !== before) applyLookAhead();
      renderWord(test.index); renderWord(test.index + 1);
      placeCarets();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      const before = test.index;
      E.space(test, now);
      if (test.startedAt !== null) record(" ", now);
      afterInput(before);
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      E.input(test, e.key, now);
      record(e.key, now);
      afterInput(test.index);
    }
  }

  function afterInput(prevIndex) {
    if (!started && test.startedAt !== null) {
      started = true;
      if (o.onStart) o.onStart();
      if ((o.paceWpm || o.ghost) && !raf) raf = requestAnimationFrame(frame);
    }
    document.body.classList.add("typing-active");
    if (test.words.length !== wordsEl.childElementCount) appendWords();
    renderWord(prevIndex);
    if (prevIndex !== test.index) { renderWord(test.index); applyLookAhead(); }
    updateCounter();
    placeCarets();
    if (o.onProgress) o.onProgress(test);
    if (test.finishedAt !== null) finish();
  }

  function updateCounter() {
    if (!test) return;
    if (test.mode === "time") {
      counterEl.textContent = test.startedAt === null ? test.duration
        : Math.max(0, Math.ceil(test.duration - E.elapsedMs(test, Date.now()) / 1000));
    } else {
      counterEl.textContent = Math.min(test.index, test.words.length) + "/" + test.words.length;
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────
  function renderWords() {
    const frag = document.createDocumentFragment();
    test.words.forEach((_, i) => frag.appendChild(buildWord(i)));
    wordsEl.replaceChildren(frag);
    wordsEl.style.transform = "translateY(0)";
    applyLookAhead();
  }

  function appendWords() {
    if (test.words.length < wordsEl.childElementCount) return renderWords();
    for (let i = wordsEl.childElementCount; i < test.words.length; i++) wordsEl.appendChild(buildWord(i));
    applyLookAhead();
  }

  function buildWord(i) {
    const word = test.words[i];
    const typed = test.typed[i] || "";
    const blind = o.blind && !finished;
    const w = document.createElement("div");
    w.className = "word";
    if (!blind && i < test.index && typed !== word) w.classList.add("error");
    for (let k = 0; k < word.length; k++) {
      const s = document.createElement("span");
      s.className = "letter";
      s.textContent = word[k];
      if (k < typed.length) s.classList.add(blind ? "typed" : typed[k] === word[k] ? "ok" : "bad");
      w.appendChild(s);
    }
    for (let k = word.length; k < typed.length; k++) {
      const s = document.createElement("span");
      s.className = blind ? "letter typed" : "letter extra";
      s.textContent = typed[k];
      w.appendChild(s);
    }
    return w;
  }

  function renderWord(i) {
    if (i < 0 || i >= test.words.length) return;
    const old = wordsEl.children[i];
    if (old) {
      const fresh = buildWord(i);
      if (old.classList.contains("ahead")) fresh.classList.add("ahead");
      wordsEl.replaceChild(fresh, old);
    }
  }

  function applyLookAhead() {
    const n = Number(o.lookAhead) || 0;
    const kids = wordsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle("ahead", n > 0 && i > test.index + n);
  }

  // {left, top, h} of the caret for word `index` with `typedLen` characters typed
  function pos(index, typedLen) {
    const w = wordsEl.children[index];
    if (!w || !w.children.length) return null;
    const letters = w.children, h = w.offsetHeight;
    if (typedLen < letters.length) {
      const l = letters[typedLen];
      return { left: l.offsetLeft, top: l.offsetTop, h };
    }
    const l = letters[letters.length - 1];
    const left = o.mirror ? l.offsetLeft - l.offsetWidth : l.offsetLeft + l.offsetWidth;
    return { left, top: l.offsetTop, h };
  }

  function put(caret, p) {
    const f = CARET_TOP[el.dataset.caret] || CARET_TOP.underline;
    caret.style.left = p.left + "px";
    caret.style.top = p.top - shift + p.h * f + "px";
  }

  function placeCarets() {
    const p = pos(test.index, (test.typed[test.index] || "").length);
    if (!p) return;
    // scroll so the current line is the middle one once we're past the first line
    shift = Math.max(0, Math.round(p.top / p.h) - 1) * p.h;
    wordsEl.style.transform = `translateY(${-shift}px)`;
    put(caretEl, p);
    placeSecondaryCarets();
  }

  function placeSecondary(caret, st) {
    const p = st && pos(st.index, st.typed);
    const visible = p && p.top - shift >= 0 && p.top - shift < p.h * 3;
    caret.hidden = !visible;
    if (visible) put(caret, p);
  }

  function placeSecondaryCarets() {
    if (!test) return;
    const ms = test.startedAt === null ? 0 : E.elapsedMs(test, Date.now());
    if (o.paceWpm && started) placeSecondary(paceEl, paceAt(test.words, Number(o.paceWpm), ms));
    else paceEl.hidden = true;
    if (o.ghost && started && typeof E.stateAt === "function" && Array.isArray(o.ghost.log)) {
      let st = null;
      try { st = E.stateAt(o.ghost.words, o.ghost.log, ms); } catch { st = null; }
      if (st) {
        const t = st.typed;
        const typedLen = typeof t === "string" ? t.length : Array.isArray(t) ? (t[st.index] || "").length : 0;
        placeSecondary(ghostEl, { index: st.index, typed: typedLen });
      } else ghostEl.hidden = true;
    } else ghostEl.hidden = true;
  }

  build();
  return {
    restart,
    destroy,
    handleKey,
    get test() { return test; },
    get finished() { return finished; },
  };
}

export default createTyping;
