# typetrack v2 architecture (the contract every contributor builds against)

Vanilla JS, **no build step, no npm dependencies**. Browser code is native ES modules. Server is plain Node
(>= 22.5) using `node:http`, `node:sqlite`, `node:crypto`. Tests use `node:test` (`npm test` runs `test/*.test.js`).

Read `ROADMAP.md` for the feature list. Keep the look: tokens in `public/css/base.css` (`--bg --main --caret --sub
--sub-alt --text --error --error-extra --edge --font`), square corners (2px), uppercase small labels with letter
spacing, crimson accents, JetBrains Mono. Never hard-code colours in JS; read CSS vars (canvas games too).

## Layout

```
public/                     static root, served by the server
  index.html                shell: header (logo, nav, auth slot), <main id="app">
  css/base.css              tokens + shared components (buttons, .config bar, .tile, .chip, tables)
  css/<feature>.css         one file per feature, loaded by the view with loadCss()
  js/engine.js              UMD pure engine (window.Engine in browser, require() in node). Loaded as a classic
                            <script> BEFORE the module entry. Modules use window.Engine.
  js/app.js                 module entry: boots router, header, auth state
  js/routes.js              THE route registry (the only file several contributors append to)
  js/core/                  shared infrastructure (below)
  js/views/<name>.js        one module per page
  js/views/games/<id>.js    one module per game
  js/views/games/pack1.js   game registries, one per games contributor (pack1, pack2, pack3)
  words/                    word data (JSON, below)
server/
  index.js                  entry: static files from public/ + /api
  db.js  auth.js  api/*.js
test/*.test.js               (logic shared by browser and server lives in public/js/core/*.js as DOM-free ESM;
                             the server imports it by relative path, e.g. ../public/js/core/progress.js)
data/                       runtime data (sqlite), gitignored. DATA_DIR env overrides.
```

## Core modules (`public/js/core/`)

- `router.js` — hash routes `#/<path>[/<sub>][?query]`. `routes.js` exports an array of
  `{ path, title, nav?: 'main'|'right'|false, load: () => import('./views/x.js') }`. A view module's default
  export is `{ mount(root, ctx), unmount?() }` (mount may be async). `ctx = { params, query, navigate(hash),
  keys, bus, store, settings, api, auth, words }`. Unknown route → `#/test`. Default route `#/test`.
- `keys.js` — the single `keydown` listener. `keys.set(handler)` makes `handler(e)` the active one (returns a
  remover); the router clears it on unmount. Global shortcuts: none besides what views register.
- `bus.js` — `on(event, fn)` returns off; `emit(event, data)`. Events: `result:saved` (typing result),
  `game:finished` ({game, score, meta}), `auth:changed` (user|null), `settings:changed`, `pb` ({kind, key, value}),
  `xp` ({gained, total, levelUp}), `badge` ({id}).
- `store.js` — localStorage wrapper, every call try/catch. `store.results()` (typing results, key
  `typetrack.results.v1`, keep compatible), `store.addResult(r)` (saves, emits `result:saved`),
  `store.gameScores(game)`, `store.addGameScore(game, score, meta)` (emits `game:finished`), `store.get(key, fb)`,
  `store.set(key, v)` for everything else (namespace `typetrack.<key>`).
- `settings.js` — `settings.get(k)`, `settings.set(k, v)` (emits `settings:changed`), defaults:
  `{ lang:'en', list:'common-1k', accents:'lenient', layout:'qwerty', sound:'off', caret:'underline',
  hideTimer:false, hideLiveWpm:false, width:1000, theme:null }`.
- `words.js` — `await words.list(lang, name)` → string[] (cached fetch of `words/<lang>/<name>.json`);
  `await words.manifest()`; `words.quotes(lang)`, `words.theme(name)`, `words.code(lang)`, `words.translations(lang)`.
- `typing.js` — the reusable typing surface used by Test, Train and text-based games:
  `createTyping(el, { words?: string[], text?: string, mode:'time'|'words'|'text', duration, wordCount,
  noBackspace, lookAhead, blind, mirror, accents, paceWpm, ghost, onStart, onProgress(state), onFinish(result) })`
  → `{ restart(opts?), destroy(), test }`. Renders words + caret like the current test, delegates rules to Engine.
- `chart.js` — `drawLineChart(canvas, opts)` (the existing one, moved) plus `drawBars`, `drawHistogram`.
- `css.js` — `loadCss(href)` (idempotent `<link>` insert). Views load their own CSS; do NOT edit index.html for it.
- `api.js` — `api.get(path)`, `api.post(path, body)` → parsed JSON; throws `{status, error}`. Same-origin, cookies.
- `auth.js` — `auth.user` (null or `{id, name}`), `await auth.refresh()` (GET /api/me), `login`, `logout`,
  `register`. Emits `auth:changed`. Works offline: if the API is unreachable, user stays null and the rest of
  the site keeps working.
- `progress.js` — pure gamification maths (no DOM): `xpForResult(r)`, `xpForGame(game, score)`,
  `levelFor(xp)` → `{level, into, next}`, `BADGES` (id, name, desc, test(summary)), `streak(dates)`.
- `ui.js` — small helpers: `h(tag, attrs, ...children)`, `esc(s)`, `toast(msg)`, `fmtDuration(s)`.

## Engine (`public/js/engine.js`)

Pure, UMD, covered by `test/engine.test.js`. Every result carries a **keystroke log** so any run can be replayed
or raced as a ghost: `result.log = [[t, k], ...]` with `t` ms since start and `k` a character, `" "` (space) or
`"\b"` (backspace), plus `result.words` (the word list used, trimmed to what was reached) and `result.lang`.
`Engine.replay(words, log, opts)` rebuilds a test from a log; `Engine.stateAt(words, log, t)` gives
`{index, typed}` at time t (used to draw a ghost caret). Timing analytics are pure functions on a result.

## Words (`public/words/`, JSON arrays, lower-case unless the language needs otherwise)

```
words/index.json                    { languages: [{code, name, dir:'ltr'|'rtl', lists:[...]}], themes:[...], code:[...] }
words/<lang>/common-200.json        the 200 most common words
words/<lang>/common-1k.json         the 1000 most common words   <- STANDARD TESTS USE COMMON LISTS ONLY
words/<lang>/common-10k.json        (en at least)
words/<lang>/rare.json              rare / long words for hard modes, drills, games only
words/quotes/<lang>.json            [{ text, source }]  public-domain
words/themes/<name>.json            programming, medicine, legal ...
words/code/<lang>.json              [{ text }] short realistic snippets (js, py, cs, sql, rs, sh)
words/translate/<lang>.json         [{ en, word }] for vocabulary mode and translation race
words/books/<id>.json               { title, author, paragraphs: [...] } public-domain
```

## Server API (JSON, same origin, cookie session)

- `POST /api/register {name, email, password}` → 201 `{ok:true}`; 400 invalid; 409 email or name taken.
  Account is active immediately (email verification comes later). Client then redirects to `#/login?registered=1`.
- `POST /api/login {email, password}` → sets `tt_session` (HttpOnly, SameSite=Lax, 30 days) → `{user:{id,name}}`.
- `POST /api/logout`; `GET /api/me` → `{user}` or 401.
- `POST /api/results` (auth) body = a typing result incl. `log`, `words`, `lang`, `mode`, `target`. The server
  **re-derives wpm/acc from the log with Engine** and rejects mismatches. → `{id, rank}`.
- `GET /api/leaderboard?mode=time&target=30&lang=en&period=all|week|day` →
  `[{rank, name, wpm, acc, ts, resultId}]` (best per user).
- `GET /api/ghosts/:resultId` → `{name, wpm, acc, mode, target, lang, words, log}`.
- `POST /api/games/:game/score {score, meta}` (auth); `GET /api/games/:game/leaderboard?period=` → rows.
- `GET /api/profile/:name` → `{name, joined, xp, level, pbs, badges, tests}`.
- Passwords: scrypt with per-user salt, timingSafeEqual. Sessions: random 32-byte token, stored hashed.
  Basic rate limit on login/register. No multiplayer / websockets.

## Rules for contributors

- Stay inside the files you own. Shared files you may append to: `routes.js`, `words/index.json`. Keep appends
  small and self-contained so merges are trivial.
- No new dependencies. No build step. No frameworks.
- Tests for pure logic you add (`test/<area>.test.js`). Run only your tests while building.
- Everything must work with the server down (localStorage), except leaderboards / shared ghosts / accounts,
  which show a clear "sign in" or "offline" state.
- Commit in small commits on your branch: `feat(<area>): ...`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push; the integrator merges.
