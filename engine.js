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

  // mode: "time" (duration seconds, endless words) | "words" (fixed wordCount)
  function createTest(opts) {
    const rand = opts.rand || mulberry32(opts.seed == null ? Date.now() : opts.seed);
    const mode = opts.mode === "words" ? "words" : "time";
    const duration = mode === "time" ? Number(opts.duration) || 30 : 0;
    const wordCount = mode === "words" ? Number(opts.wordCount) || 50 : 0;
    // Time mode starts with a generous buffer and tops itself up as you go.
    const initial = mode === "words" ? wordCount : 100;
    return {
      mode,
      duration,
      wordCount,
      pool: opts.words,
      rand,
      words: pickWords(opts.words, initial, rand),
      typed: [""], // typed[i] is what has been typed for words[i]
      index: 0, // current word
      startedAt: null,
      finishedAt: null,
      // keystroke tally, monkeytype-style
      correct: 0,
      incorrect: 0,
      extra: 0,
      missed: 0,
      events: [], // {t, ok} per character keystroke, t = ms since start
    };
  }

  function isRunning(s) {
    return s.startedAt !== null && s.finishedAt === null;
  }

  function ensureBuffer(s) {
    if (s.mode === "time" && s.words.length - s.index < 40) {
      s.words.push(...pickWords(s.pool, 60, s.rand));
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
    const ok = pos < word.length && word[pos] === ch;
    if (pos < word.length) {
      if (ok) s.correct++;
      else s.incorrect++;
    } else {
      if (pos - word.length >= 10) return s; // cap runaway extras
      s.extra++;
    }
    s.typed[s.index] = typed + ch;
    s.events.push({ t: now - s.startedAt, ok });
    // Words mode ends on the final character of the final word if it is all correct.
    if (s.mode === "words" && s.index === s.words.length - 1 && s.typed[s.index] === word) {
      finish(s, now);
    }
    return s;
  }

  function backspace(s) {
    if (s.finishedAt !== null) return s;
    const typed = s.typed[s.index];
    if (typed.length > 0) {
      s.typed[s.index] = typed.slice(0, -1);
    } else if (s.index > 0 && s.typed[s.index - 1] !== s.words[s.index - 1]) {
      // Allow backing into a previous word only if it was wrong (monkeytype behaviour).
      s.typed.pop();
      s.index--;
    }
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
    if (s.mode === "words" && s.index === s.words.length - 1) {
      finish(s, now);
      return s;
    }
    s.index++;
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
        if (s.mode === "words" && t === w) correctChars += 1;
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
      // cumulative wpm sampled once per second, for the results chart
      perSecond: perSecond(s, ms),
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
  };
});
