// Pure gamification maths: XP, levels, badges, streaks, daily goals. No DOM, no storage.
// Imported by the browser (views) and by the Node server (../public/js/core/progress.js).
//
// Tuned for fast, accurate typists (130-200 wpm, ~100% accuracy): speed badges start where most sites stop,
// accuracy badges ask for 100% at speed, and XP pays for clean runs.

// ── XP ──────────────────────────────────────────────────────────────────────

// Correct characters in a typing result (falls back to wpm × minutes × 5 for results without a tally).
function correctChars(r) {
  if (r && r.chars && typeof r.chars.correct === "number") return r.chars.correct;
  return Math.round(((r && r.wpm) || 0) * 5 * (((r && r.duration) || 0) / 60));
}

// XP for one typing result: 1 XP per correct word (5 correct chars), × 1.3 at 100% accuracy, × 1.15 at ≥ 98%,
// × 0.5 under 90% (mashing earns little). A personal best (flags.pb or r.pb) adds 25 XP + 25% of the base.
// 30 s at 150 wpm and 100% ≈ 98 XP.
export function xpForResult(r, flags) {
  if (!r) return 0;
  const base = correctChars(r) / 5;
  const acc = Number(r.acc) || 0;
  const mult = acc >= 100 ? 1.3 : acc >= 98 ? 1.15 : acc < 90 ? 0.5 : 1;
  const pb = (flags && flags.pb) || r.pb;
  return Math.max(0, Math.round(base * mult + (pb ? 25 + base * 0.25 : 0)));
}

// XP for one game: 10 for playing, up to 40 more on a log scale of the score (every game scores differently),
// +15 for a win (meta.won, e.g. beating a ghost). score may be a number or { score, meta }.
export function xpForGame(game, score, meta) {
  const s = typeof score === "number" ? score : (score && Number(score.score)) || 0;
  const m = meta || (score && typeof score === "object" ? score.meta : null) || {};
  const won = m.won || m.win ? 15 : 0;
  return 10 + Math.min(40, Math.round(4 * Math.log2(1 + Math.max(0, s)))) + won;
}

// ── Levels ──────────────────────────────────────────────────────────────────
// Total XP to reach level L is 75 × (L - 1)²: level 2 at 75, level 10 at 6,075 (about a week of ten daily tests
// plus a few games), level 25 at 43,200, level 50 at 180,075 (six months or more of daily practice).

export const LEVEL_XP = 75;

export function xpForLevel(level) {
  return LEVEL_XP * Math.pow(Math.max(1, level) - 1, 2);
}

// → { level, into (XP earned inside this level), next (XP this level spans; progress = into / next) }
export function levelFor(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let level = Math.floor(1 + Math.sqrt(x / LEVEL_XP));
  while (xpForLevel(level + 1) <= x) level++;
  while (level > 1 && xpForLevel(level) > x) level--;
  return { level, into: x - xpForLevel(level), next: xpForLevel(level + 1) - xpForLevel(level) };
}

// ── Days and streaks ────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" in local time for a timestamp (ms) or Date; a string is taken as already being a day key.
export function dayKey(d) {
  if (typeof d === "string") return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
}

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// dates: timestamps, Dates or "YYYY-MM-DD" (duplicates fine). today defaults to now.
// → { current, best }: current counts back from today, or from yesterday if today has no practice yet.
export function streak(dates, today) {
  const days = [...new Set((dates || []).map(dayKey))].map(dayNumber).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  const set = new Set(days);
  let d = dayNumber(dayKey(today == null ? new Date() : today));
  if (!set.has(d)) d--;
  let current = 0;
  while (set.has(d)) {
    current++;
    d--;
  }
  return { current, best };
}

// ── Summary (what badges test) ──────────────────────────────────────────────

// gameScores: { [gameId]: [{ score, ts, meta }] } (store.gameScores per game) or [{ game, score, ts, meta }].
function gameList(gameScores) {
  if (Array.isArray(gameScores)) return gameScores.filter(Boolean);
  const out = [];
  for (const [game, list] of Object.entries(gameScores || {})) {
    for (const s of list || []) out.push(Object.assign({ game }, typeof s === "number" ? { score: s } : s));
  }
  return out;
}

/**
 * summarize(results, gameScores, extra) → the object every badge's test() reads.
 *
 * results: typing results (Engine.results() plus ts), oldest first or with ts.
 * gameScores: see gameList above. extra (all optional):
 *   { games: string[] every game id there is, ghostWins: number, xp: number, today: Date|ms|"YYYY-MM-DD" }
 *
 * Summary shape:
 * {
 *   tests,            number of typing results
 *   bestWpm,          best wpm at any accuracy
 *   bestCleanWpm,     best wpm on a 100%-accuracy run
 *   cleanStreak,      longest run of consecutive 100%-accuracy tests (by ts)
 *   cleanStreakNow,   the run of 100% tests ending with the latest test
 *   secondsTyped,     sum of result durations
 *   charsTyped,       sum of correct characters
 *   longestTest,      longest single test in seconds
 *   stamina,          longest test (s) at 120+ wpm
 *   languages,        distinct result languages (lang, default "en")
 *   days,             sorted distinct "YYYY-MM-DD" with a test or a game
 *   streak,           { current, best } daily streak over days
 *   gamesPlayed,      { [gameId]: plays }
 *   gamesDistinct,    number of different games played
 *   allGames,         true when every id in extra.games has been played (false without extra.games)
 *   ghostWins,        extra.ghostWins, else game entries with meta.won in a game whose id contains "ghost"
 *   xp,               extra.xp, else the sum of xpForResult and xpForGame over everything given
 *   level,            levelFor(xp).level
 * }
 */
export function summarize(results, gameScores, extra) {
  const rs = (results || []).filter(Boolean).slice();
  if (rs.every((r) => typeof r.ts === "number")) rs.sort((a, b) => a.ts - b.ts);
  const games = gameList(gameScores);
  const x = extra || {};
  let bestWpm = 0, bestCleanWpm = 0, cleanStreak = 0, run = 0, secondsTyped = 0, charsTyped = 0;
  let longestTest = 0, stamina = 0;
  const langs = new Set();
  const dates = [];
  for (const r of rs) {
    const wpm = Number(r.wpm) || 0;
    const clean = Number(r.acc) >= 100;
    bestWpm = Math.max(bestWpm, wpm);
    if (clean) bestCleanWpm = Math.max(bestCleanWpm, wpm);
    run = clean ? run + 1 : 0;
    cleanStreak = Math.max(cleanStreak, run);
    const secs = Number(r.duration) || 0;
    secondsTyped += secs;
    charsTyped += correctChars(r);
    longestTest = Math.max(longestTest, secs);
    if (wpm >= 120) stamina = Math.max(stamina, secs);
    langs.add(r.lang || "en");
    if (r.ts != null) dates.push(r.ts);
  }
  const gamesPlayed = {};
  let ghostWins = 0;
  for (const g of games) {
    gamesPlayed[g.game] = (gamesPlayed[g.game] || 0) + 1;
    if (g.ts != null) dates.push(g.ts);
    if (/ghost/.test(g.game) && g.meta && (g.meta.won || g.meta.win)) ghostWins++;
  }
  const xp =
    typeof x.xp === "number"
      ? x.xp
      : rs.reduce((a, r) => a + xpForResult(r), 0) + games.reduce((a, g) => a + xpForGame(g.game, g.score, g.meta), 0);
  const all = Array.isArray(x.games) && x.games.length > 0 && x.games.every((id) => gamesPlayed[id] > 0);
  return {
    tests: rs.length,
    bestWpm,
    bestCleanWpm,
    cleanStreak,
    cleanStreakNow: run,
    secondsTyped,
    charsTyped,
    longestTest,
    stamina,
    languages: langs.size,
    days: [...new Set(dates.map(dayKey))].sort(),
    streak: streak(dates, x.today),
    gamesPlayed,
    gamesDistinct: Object.keys(gamesPlayed).length,
    allGames: all,
    ghostWins: typeof x.ghostWins === "number" ? x.ghostWins : ghostWins,
    xp,
    level: levelFor(xp).level,
  };
}

// ── Badges ──────────────────────────────────────────────────────────────────
// { id, name, desc, icon (one unicode glyph), test(summary) → boolean }

const badge = (id, name, desc, icon, test) => ({ id, name, desc, icon, test });

export const BADGES = [
  // speed tiers
  badge("wpm-100", "Triple digits", "Finish a test at 100 wpm", "⚡", (s) => s.bestWpm >= 100),
  badge("wpm-120", "Quick hands", "Finish a test at 120 wpm", "🔥", (s) => s.bestWpm >= 120),
  badge("wpm-140", "Fast lane", "Finish a test at 140 wpm", "🚀", (s) => s.bestWpm >= 140),
  badge("wpm-160", "Comet", "Finish a test at 160 wpm", "☄", (s) => s.bestWpm >= 160),
  badge("wpm-180", "Shooting star", "Finish a test at 180 wpm", "🌠", (s) => s.bestWpm >= 180),
  badge("wpm-200", "Two hundred", "Finish a test at 200 wpm", "👑", (s) => s.bestWpm >= 200),
  // accuracy
  badge("clean-5", "Clean five", "5 tests in a row at 100% accuracy", "✓", (s) => s.cleanStreak >= 5),
  badge("clean-10", "Clean ten", "10 tests in a row at 100% accuracy", "✔", (s) => s.cleanStreak >= 10),
  badge("clean-25", "Flawless", "25 tests in a row at 100% accuracy", "💎", (s) => s.cleanStreak >= 25),
  badge("perfect-150", "Sharpshooter", "100% accuracy at 150 wpm or more", "🎯", (s) => s.bestCleanWpm >= 150),
  badge("perfect-180", "Marksman", "100% accuracy at 180 wpm or more", "🏹", (s) => s.bestCleanWpm >= 180),
  // time typed
  badge("stamina", "Endurance", "A test of 3 minutes or more at 120+ wpm", "⏳", (s) => s.stamina >= 180),
  badge("marathon-1h", "First hour", "1 hour of typing tests", "⏱", (s) => s.secondsTyped >= 3600),
  badge("marathon-5h", "Long haul", "5 hours of typing tests", "🏃", (s) => s.secondsTyped >= 5 * 3600),
  badge("marathon-24h", "Round the clock", "24 hours of typing tests", "🌍", (s) => s.secondsTyped >= 24 * 3600),
  // daily streaks
  badge("streak-3", "Habit", "Practise 3 days in a row", "📅", (s) => s.streak.best >= 3),
  badge("streak-7", "Full week", "Practise 7 days in a row", "🗓", (s) => s.streak.best >= 7),
  badge("streak-30", "Moon cycle", "Practise 30 days in a row", "🌙", (s) => s.streak.best >= 30),
  badge("streak-100", "Centurion", "Practise 100 days in a row", "🌟", (s) => s.streak.best >= 100),
  // volume
  badge("tests-1", "First steps", "Finish your first test", "🌱", (s) => s.tests >= 1),
  badge("tests-100", "Regular", "Finish 100 tests", "🌿", (s) => s.tests >= 100),
  badge("tests-1000", "Veteran", "Finish 1,000 tests", "🌳", (s) => s.tests >= 1000),
  // games
  badge("game-first", "Player one", "Play a game", "🎮", (s) => s.gamesDistinct >= 1),
  badge("games-all", "Arcade", "Play every game", "🕹", (s) => s.allGames),
  badge("ghost-1", "Ghostbuster", "Beat a ghost", "👻", (s) => s.ghostWins >= 1),
  badge("ghost-10", "Exorcist", "Beat 10 ghosts", "🕯", (s) => s.ghostWins >= 10),
  // languages
  badge("lang-2", "Bilingual", "Finish tests in 2 languages", "🌐", (s) => s.languages >= 2),
  badge("lang-5", "Polyglot", "Finish tests in 5 languages", "🗺", (s) => s.languages >= 5),
  // levels
  badge("level-10", "Level 10", "Reach level 10", "⭐", (s) => s.level >= 10),
  badge("level-25", "Level 25", "Reach level 25", "🏅", (s) => s.level >= 25),
  badge("level-50", "Level 50", "Reach level 50", "🏆", (s) => s.level >= 50),
];

// Ids of every badge the summary earns.
export function earnedBadges(summary) {
  return BADGES.filter((b) => b.test(summary)).map((b) => b.id);
}

// ── Daily goals ─────────────────────────────────────────────────────────────

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Goal templates. ctx = { today (results today), games (game plays today), avg (recent average wpm, 0 if none) }.
const GOALS = [
  (c) => ({ id: "tests", title: "Finish 10 tests", target: 10, value: c.today.length }),
  (c) => ({ id: "clean", title: "3 runs at 100% accuracy", target: 3, value: c.today.filter((r) => r.acc >= 100).length }),
  (c) => {
    const target = c.avg ? Math.round(c.avg * 1.03) : 60;
    return { id: "speed", title: `Hit ${target} wpm`, target, value: Math.max(0, ...c.today.map((r) => r.wpm || 0)) };
  },
  (c) => ({ id: "minutes", title: "Type for 10 minutes", target: 600, value: c.today.reduce((a, r) => a + (r.duration || 0), 0) }),
  (c) => ({ id: "games", title: "Play 3 games", target: 3, value: c.games.length }),
  (c) => ({ id: "stamina", title: "Finish a test of 60 s or more", target: 1, value: c.today.filter((r) => r.duration >= 60).length }),
  (c) => {
    const at = c.avg ? Math.round(c.avg) : 60;
    const n = c.today.filter((r) => r.acc >= 100 && r.wpm >= at).length;
    return { id: "clean-fast", title: `A 100% run at ${at}+ wpm`, target: 1, value: n };
  },
  (c) => ({ id: "chars", title: "Type 5,000 correct characters", target: 5000, value: c.today.reduce((a, r) => a + correctChars(r), 0) }),
];

// Three goals for the day, the same for everyone on that date (seeded by it), measured on that day's results and
// games. date: Date | ms | "YYYY-MM-DD" (default today). The speed goals follow the average of the last 20 results
// before that day, so they stay a stretch at 180 wpm.
// → [{ id, title, target, progress (0..target), done }]
export function dailyGoals(results, gameScores, date) {
  const day = dayKey(date == null ? new Date() : date);
  const rs = (results || []).filter((r) => r && r.ts != null);
  const today = rs.filter((r) => dayKey(r.ts) === day);
  const before = rs.filter((r) => dayKey(r.ts) < day).sort((a, b) => a.ts - b.ts).slice(-20);
  const avg = before.length ? before.reduce((a, r) => a + (r.wpm || 0), 0) / before.length : 0;
  const games = gameList(gameScores).filter((g) => g.ts != null && dayKey(g.ts) === day);
  const ctx = { today, games, avg };
  const rand = rng(hash(day));
  const order = GOALS.map((g, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, 3).map((x) => x[1]);
  return order.map((i) => {
    const g = GOALS[i](ctx);
    return { id: g.id, title: g.title, target: g.target, progress: Math.min(g.target, g.value), done: g.value >= g.target };
  });
}
