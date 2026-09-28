// Pure typing-test engine. No DOM, no timers, no storage.
// Loaded as a plain script in the browser (window.Engine) and via require() in tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Deterministic PRNG so a seed reproduces a word sequence (handy in tests).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickWords(pool, count, rand) {
    const out = [];
    let last = null;
    while (out.length < count) {
      const w = pool[Math.floor(rand() * pool.length)];
      if (w === last && pool.length > 1 && out.length < count * 4) continue; // no immediate repeats
      out.push(w);
      last = w;
    }
    return out;
  }

  // Repeat an ordered list until it has n entries (drills, quotes, replays).
  function cycle(list, n, from) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(list[(i + (from || 0)) % list.length]);
    return out;
  }

  // Base letter of an accented character ("é" -> "e", "ñ" -> "n", "ç" -> "c").
  // Only single-character NFD decompositions count: "ß", "ø", "æ" have none.
  function baseChar(c) {
    const d = c.normalize("NFD");
    return d.length > 1 && /^[\u0300-\u036f]+$/.test(d.slice(1)) ? d[0] : c;
  }

  // opts:
  //   mode: "time" (duration seconds, endless words) | "words" (fixed wordCount) | "text" (a fixed text)
  //   words: the pool to draw from; with ordered:true (or mode "text"), the exact list, used in order
  //   text: for mode "text", a string split on whitespace
  //   ordered: use opts.words in order (drills, quotes, replays) instead of shuffling
  //   accents: "strict" (default) | "lenient" (a typed base letter matches its accented target: e for é)
  //   noBackspace: backspace is ignored
  //   lang: recorded on the result (default "en")
  function createTest(opts) {
    const rand = opts.rand || mulberry32(opts.seed == null ? Date.now() : opts.seed);
    const mode = opts.mode === "words" || opts.mode === "text" ? opts.mode : "time";
    let list = opts.words;
    if (mode === "text") {
      list = opts.text != null ? String(opts.text).split(/\s+/).filter(Boolean) : (opts.words || []).slice();
      if (!list.length) throw new Error("text mode needs a non-empty text");
    }
    const ordered = mode === "text" || opts.ordered === true;
    const duration = mode === "time" ? Number(opts.duration) || 30 : 0;
    const wordCount =
      mode === "text" ? list.length : mode === "words" ? Number(opts.wordCount) || (ordered ? list.length : 50) : 0;
    // Time mode starts with a generous buffer and tops itself up as you go.
    const initial = mode === "time" ? 100 : wordCount;
    return {
      mode,
      duration,
      wordCount,
      pool: list,
      ordered,
      rand,
      lang: opts.lang || "en",
      accents: opts.accents === "lenient" ? "lenient" : "strict",
      noBackspace: !!opts.noBackspace,
      words: ordered ? cycle(list, initial) : pickWords(list, initial, rand),
      typed: [""], // typed[i] is what has been typed for words[i]
      index: 0, // current word
      maxIndex: 0, // furthest word reached
      startedAt: null,
      finishedAt: null,
      // keystroke tally, monkeytype-style
      correct: 0,
      incorrect: 0,
      extra: 0,
      missed: 0,
      events: [], // {t, ok} per character keystroke, t = ms since start
      log: [], // [t, key] per effective keystroke: key is a character, " " or "\b"
      keyHits: {}, // expected char -> times it was attempted
      keyMiss: {}, // expected char -> times it was mistyped
      swaps: {}, // "expected>typed" -> count
    };
  }

  function isRunning(s) {
    return s.startedAt !== null && s.finishedAt === null;
  }

  function ensureBuffer(s) {
    if (s.mode === "time" && s.words.length - s.index < 40) {
      if (s.ordered) s.words.push(...cycle(s.pool, 60, s.words.length));
      else s.words.push(...pickWords(s.pool, 60, s.rand));
    }
  }

  function start(s, now) {
    if (s.startedAt === null) s.startedAt = now;
  }

  function input(s, ch, now) {
    if (s.finishedAt !== null) return s;
    start(s, now);
    const word = s.words[s.index];
    const typed = s.typed[s.index];
    const pos = typed.length;
    const key = ch;
    // Lenient accents: store the accented target so every later comparison just works.
    if (s.accents === "lenient" && pos < word.length && ch !== word[pos] && baseChar(word[pos]) === ch) ch = word[pos];
    const ok = pos < word.length && word[pos] === ch;
    if (pos < word.length) {
      const exp = word[pos].toLowerCase();
      s.keyHits[exp] = (s.keyHits[exp] || 0) + 1;
      if (ok) s.correct++;
      else {
        s.incorrect++;
        s.keyMiss[exp] = (s.keyMiss[exp] || 0) + 1;
        const k = exp + ">" + key;
        s.swaps[k] = (s.swaps[k] || 0) + 1;
      }
    } else {
      if (pos - word.length >= 10) return s; // cap runaway extras
      s.extra++;
    }
    s.typed[s.index] = typed + ch;
    s.events.push({ t: now - s.startedAt, ok });
    logKey(s, now, key);
    // Words and text mode end on the final character of the final word if it is all correct.
    if (s.mode !== "time" && s.index === s.words.length - 1 && s.typed[s.index] === word) {
      finish(s, now);
    }
    return s;
  }

  function logKey(s, now, key) {
    const last = s.log.length ? s.log[s.log.length - 1][0] : 0;
    const t = now == null ? last : Math.max(last, Math.round(now - s.startedAt));
    s.log.push([t, key]);
  }

  // now is optional (older callers); without it the backspace is logged at the previous keystroke's time.
  function backspace(s, now) {
    if (s.finishedAt !== null || s.noBackspace) return s;
    const typed = s.typed[s.index];
    if (typed.length > 0) {
      s.typed[s.index] = typed.slice(0, -1);
    } else if (s.index > 0 && s.typed[s.index - 1] !== s.words[s.index - 1]) {
      // Allow backing into a previous word only if it was wrong (monkeytype behaviour).
      s.typed.pop();
      s.index--;
    } else return s;
    if (s.startedAt !== null) logKey(s, now, "\b");
    return s;
  }

  function space(s, now) {
    if (s.finishedAt !== null) return s;
    const typed = s.typed[s.index];
    if (typed.length === 0) return s; // ignore leading spaces
    start(s, now);
    const word = s.words[s.index];
    if (typed === word) s.correct++; // the space itself counts as a correct char
    else s.missed += Math.max(0, word.length - typed.length);
    s.events.push({ t: now - s.startedAt, ok: typed === word });
    logKey(s, now, " ");
    if (s.mode !== "time" && s.index === s.words.length - 1) {
      finish(s, now);
      return s;
    }
    s.index++;
    if (s.index > s.maxIndex) s.maxIndex = s.index;
    s.typed.push("");
    ensureBuffer(s);
    return s;
  }

  // Call regularly; ends a time-mode test when the clock runs out.
  function tick(s, now) {
    if (!isRunning(s)) return s;
    if (s.mode === "time" && now - s.startedAt >= s.duration * 1000) {
      // Count the unfinished tail of the current word as missed.
      const word = s.words[s.index];
      const typed = s.typed[s.index];
      s.missed += Math.max(0, word.length - typed.length);
      finish(s, s.startedAt + s.duration * 1000);
    }
    return s;
  }

  function finish(s, now) {
    if (s.finishedAt === null) s.finishedAt = now;
  }

  function elapsedMs(s, now) {
    if (s.startedAt === null) return 0;
    return (s.finishedAt !== null ? s.finishedAt : now) - s.startedAt;
  }

  // WPM the way monkeytype defines it: correct characters (including the space
  // after each fully correct word) / 5, per minute. Raw counts every keystroke.
  function results(s) {
    const ms = Math.max(1, elapsedMs(s, s.finishedAt));
    const minutes = ms / 60000;
    let correctChars = 0;
    for (let i = 0; i < s.typed.length; i++) {
      const w = s.words[i];
      const t = s.typed[i];
      if (i < s.index) {
        if (t === w) correctChars += w.length + 1;
      } else {
        // current word: correct prefix only
        let n = 0;
        while (n < t.length && n < w.length && t[n] === w[n]) n++;
        correctChars += n;
        if (s.mode !== "time" && t === w) correctChars += 1;
      }
    }
    const rawChars = s.typed.reduce((a, t) => a + t.length, 0) + Math.max(0, s.typed.length - 1);
    const keystrokes = s.correct + s.incorrect + s.extra;
    return {
      mode: s.mode,
      duration: Math.round(ms / 1000),
      target: s.mode === "time" ? s.duration : s.wordCount,
      wpm: round1(correctChars / 5 / minutes),
      raw: round1(rawChars / 5 / minutes),
      acc: keystrokes ? round1((s.correct / keystrokes) * 100) : 0,
      chars: { correct: s.correct, incorrect: s.incorrect, extra: s.extra, missed: s.missed },
      errors: {
        perSecond: errorsPerSecond(s, ms),
        keyHits: Object.assign({}, s.keyHits),
        keyMiss: Object.assign({}, s.keyMiss),
        swaps: Object.assign({}, s.swaps),
        words: wrongWords(s),
      },
      // cumulative wpm sampled once per second, for the results chart
      perSecond: perSecond(s, ms),
      // everything needed to replay the run (Engine.replay / verify / stateAt)
      lang: s.lang,
      accents: s.accents,
      noBackspace: s.noBackspace,
      words: s.words.slice(0, s.maxIndex + 1),
      log: s.log.map((e) => e.slice()),
    };
  }

  function perSecond(s, ms) {
    const secs = Math.max(1, Math.ceil(ms / 1000));
    const out = [];
    let good = 0;
    let idx = 0;
    for (let sec = 1; sec <= secs; sec++) {
      while (idx < s.events.length && s.events[idx].t <= sec * 1000) {
        if (s.events[idx].ok) good++;
        idx++;
      }
      out.push(round1(good / 5 / (sec / 60)));
    }
    return out;
  }

  // errors (bad keystrokes, including a space ending a wrong word) in each second
  function errorsPerSecond(s, ms) {
    const secs = Math.max(1, Math.ceil(ms / 1000));
    const out = new Array(secs).fill(0);
    for (const e of s.events) if (!e.ok) out[Math.min(secs - 1, Math.max(0, Math.ceil(e.t / 1000) - 1))]++;
    return out;
  }

  // committed words that did not match: [{word, typed}]
  function wrongWords(s) {
    const out = [];
    for (let i = 0; i < s.typed.length; i++) {
      const committed = i < s.index || s.finishedAt !== null;
      if (committed && s.typed[i] && s.typed[i] !== s.words[i]) out.push({ word: s.words[i], typed: s.typed[i] });
    }
    return out;
  }

  // Merge error data across stored results. Results saved before error
  // tracking existed contribute nothing. Returns keys sorted worst first.
  function errorProfile(rs) {
    const hits = {}, miss = {}, swaps = {}, words = {};
    let errs = 0, tests = 0;
    for (const r of rs) {
      if (r.chars) errs += (r.chars.incorrect || 0) + (r.chars.extra || 0) + (r.chars.missed || 0);
      if (!r.errors) continue;
      tests++;
      for (const [k, v] of Object.entries(r.errors.keyHits || {})) hits[k] = (hits[k] || 0) + v;
      for (const [k, v] of Object.entries(r.errors.keyMiss || {})) miss[k] = (miss[k] || 0) + v;
      for (const [k, v] of Object.entries(r.errors.swaps || {})) swaps[k] = (swaps[k] || 0) + v;
      for (const w of r.errors.words || []) words[w.word] = (words[w.word] || 0) + 1;
    }
    const keys = Object.keys(hits)
      .map((k) => ({ key: k, hits: hits[k], miss: miss[k] || 0, rate: round1(((miss[k] || 0) / hits[k]) * 100) }))
      .filter((k) => k.miss > 0)
      .sort((a, b) => b.rate - a.rate || b.miss - a.miss);
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
    return {
      avgErrors: rs.length ? round1(errs / rs.length) : 0,
      tracked: tests,
      keys,
      swaps: top(swaps),
      words: top(words),
    };
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  // ── Stats over stored results ─────────────────────────────────────────────
  // A stored result is results() plus { ts: epoch ms }.

  function modeKey(r) {
    return r.mode + " " + r.target;
  }

  function filterResults(all, key) {
    if (!key || key === "all") return all.slice();
    return all.filter((r) => modeKey(r) === key);
  }

  function movingAverage(values, n) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      out.push(round1(sum / Math.min(n, i + 1)));
    }
    return out;
  }

  function summarize(rs) {
    if (rs.length === 0) return { count: 0, best: 0, avgRecent: 0, avgAll: 0, acc: 0, seconds: 0, trend: 0 };
    const wpms = rs.map((r) => r.wpm);
    const recent = wpms.slice(-10);
    const prev = wpms.slice(-20, -10);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      count: rs.length,
      best: Math.max(...wpms),
      avgRecent: round1(mean(recent)),
      avgAll: round1(mean(wpms)),
      acc: round1(mean(rs.map((r) => r.acc))),
      seconds: rs.reduce((a, r) => a + r.duration, 0),
      trend: prev.length ? round1(mean(recent) - mean(prev)) : 0,
    };
  }

  return {
    mulberry32,
    createTest,
    input,
    backspace,
    space,
    tick,
    finish,
    isRunning,
    elapsedMs,
    results,
    modeKey,
    filterResults,
    movingAverage,
    summarize,
    errorProfile,
  };
});
