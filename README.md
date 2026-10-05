# typetrack

A typing trainer in the spirit of Monkeytype, built for fast typists who want to find their next 10 wpm. It runs
typing tests, keeps every result, and adds drills, typing games, profiles with XP and badges, and leaderboards.
Plain JavaScript, no dependencies and no build step.

## What it does today

- **Test**: time mode (15 / 30 / 60 / 120 s) and words mode, plus quotes, custom text, books and themed
  packs (programming, medicine, legal, finance, science). Hard modes (rare words, punctuation, capitals, numbers,
  code), no-backspace, look-ahead limit, pace caret and stamina tests. Results show wpm, accuracy, raw speed and a
  timing analysis.
- **Languages**: word lists in 16 languages, including right-to-left scripts and romanised Japanese, Chinese
  and Korean. English has 200, 1k and 10k tiers.
- **Stats**: best, average and trend tiles, wpm over time with a moving average, slowest letter pairs and words,
  keystroke rhythm.
- **Train**: drills for your slowest pairs, memory, blind, mirror, metronome, accents, vocabulary and race
  drills, and training plans.
- **Games**: sprint, tower climb, treadmill, word bomb, word ladder, survival, chain combo, code golf, typing
  racer, ghost race and ghost league, daily gauntlet, laser defense, boss fight and stacking.
- **Accounts and online**: register and sign in, leaderboards (all time, week, day), a weekly challenge, public
  profiles with levels, badges, daily goals and a streak calendar, and keystroke-by-keystroke replays. The server
  re-checks every submitted result before it can rank.
- **Settings and tools**: keyboard layouts, themes and custom colours, key sounds, a keyboard tester, a latency
  check and data export.

Without the server, tests, stats, drills and games still work and store results in your browser
(`localStorage`). Accounts, leaderboards, the weekly challenge and shared ghosts need the server.

## Getting started

Prerequisite: Node.js 22.5 or newer (the server uses the built-in `node:sqlite`). There are no packages to install.

```sh
npm start        # serves the app and API, then open http://localhost:5177
npm test         # runs everything in test/ with node:test
```

To run one test file: `node --test test/server.test.js`.

After adding word data under `public/words/`, regenerate the word index with
`node scripts/build-words-index.mjs`.

## Configuration

All optional environment variables:

| Name | Purpose |
|---|---|
| `PORT` | HTTP port (default 5177) |
| `DATA_DIR` | Where the SQLite database is stored (default `./data`, created on start) |
| `TRUST_PROXY` | Set to `1` to read the client IP from `X-Forwarded-For` for rate limiting when behind a reverse proxy |

There is no `.env.example`; the server reads these from the environment directly.

## How wpm is calculated

Same definition Monkeytype uses: characters in fully correct words (plus the space after each) divided by 5, per
minute. Raw wpm counts every keystroke. Accuracy is correct keystrokes over all keystrokes; extra characters
count against you, and backspaced mistakes still count as mistakes.

## Tech stack

- Browser: vanilla HTML, CSS and JavaScript as native ES modules, hash routing, canvas charts and games.
- Server: plain Node (`node:http`, `node:sqlite`, `node:crypto`), session cookie auth, per-IP rate limiting.
- Tests: `node:test`.
- Rules of the test (wpm, accuracy, stats maths) live in a DOM-free engine shared by browser and server.

## Project layout

```
public/      static site: index.html, css/, js/ (engine, core/, views/), words/ (word data)
server/      HTTP server, SQLite storage, auth and API handlers
scripts/     word index generator
test/        unit and server tests
docs/        architecture notes
ROADMAP.md   feature list and plans
```

See `docs/ARCHITECTURE.md` for how the modules fit together.

## Status

Early (version 0.1.0) and under active development. It is a working app with a large feature set, but expect
rough edges, and some items in `ROADMAP.md` are not built yet.

## Licence

All rights reserved. The source is public to read, not to reuse: see [LICENSE](LICENSE).
