# typetrack

A bare-bones typing test in the spirit of Monkeytype, with one addition: every result is kept, so you can watch your speed change over time.

- Time mode (15 / 30 / 60 / 120 s) and words mode (25 / 50 / 100).
- Live caret, per-letter colouring, Tab or Esc to restart.
- Results screen with wpm, accuracy, raw, character counts and a wpm-over-the-test chart.
- Stats page: best / average / trend tiles, wpm-per-test chart with a 10-test moving average, recent results table, filter by mode.
- Everything is stored in your browser (`localStorage`). Export and import JSON to back up or move machines.
- Vanilla HTML/CSS/JS. No dependencies, no build step, no server, no accounts.

## Run it

Node 22.5 or newer, no `npm install` needed (no dependencies).

```sh
npm start            # then open http://localhost:5177
```

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `5177` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database (`typetrack.db`) lives; created on start |
| `TRUST_PROXY` | unset | `1` = take the client IP from `X-Forwarded-For` (rate limiting) when behind a reverse proxy |

The site works without the server too (results stay in `localStorage`); accounts, leaderboards and shared ghosts need it.

## Server API

JSON over same-origin, session in an HttpOnly `tt_session` cookie (30 days). Errors are `{error}` with a 4xx status.

| Route | |
|---|---|
| `POST /api/register {name, email, password}` | 201; 400 invalid, 409 email or name taken. Active immediately |
| `POST /api/login {email, password}` | sets the cookie, `{user:{id,name}}`; 401 "invalid email or password" |
| `POST /api/logout`, `GET /api/me` | `{user}` or 401 |
| `POST /api/results` (signed in) | a result with `log`, `words`, `lang`, `mode`, `target`, `wpm`, `acc` -> `{id, rank, ranked}`. wpm/acc are re-derived from the log by the engine (+-1); mismatches, wpm > 350, time tests under 5 s and missing logs are 422 |
| `GET /api/leaderboard?mode=time&target=30&lang=en&period=all\|week\|day` | top 50, best per user: `[{rank, name, wpm, acc, raw, ts, resultId}]` |
| `GET /api/ghosts/:resultId` | `{name, wpm, acc, mode, target, lang, words, log}` |
| `POST /api/games/:game/score {score, meta}` (signed in); `GET /api/games/:game/leaderboard?period=&order=desc\|asc` | best per user |
| `GET /api/profile/:name` | `{name, joined, xp, level, progress, pbs, badges, tests, seconds, recent, games}` |

Only results whose words all come from the language's `words/<lang>/common-*.json` lists are **ranked** (shown on
leaderboards); others are stored and count on the profile. Login and register are rate limited per IP (10/min).

## Test it

The rules of the test (wpm, accuracy, when a test ends, the stats maths) live in `engine.js` with no DOM access, and are covered by `engine.test.js`:

```sh
npm test                              # everything
node --test test/server.test.js       # just the server
```

## How wpm is calculated

Same definition Monkeytype uses: characters in fully correct words (plus the space after each) divided by 5, per minute. `raw` counts every keystroke. Accuracy is correct keystrokes over all keystrokes; extra characters count against you, backspaced mistakes still count as mistakes.

## Files

| File | What it is |
|---|---|
| `index.html` | Markup for the test and stats views |
| `style.css` | Theme (Monkeytype's default palette) and layout |
| `engine.js` | Pure test engine and stats maths; no DOM |
| `app.js` | Rendering, keyboard handling, storage, the canvas chart |
| `words.js` | 200 common English words |
| `engine.test.js` | Unit tests (`node --test`) |

## Data format

`localStorage["typetrack.results.v1"]` is a JSON array of results:

```json
{ "ts": 1758800000000, "mode": "time", "target": 30, "duration": 30,
  "wpm": 82.4, "raw": 88.1, "acc": 96.2,
  "chars": { "correct": 412, "incorrect": 9, "extra": 3, "missed": 4 },
  "perSecond": [60, 72, 80, "..."] }
```

Export produces the same array; import merges by `ts` and ignores duplicates.
