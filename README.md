# typetrack

A bare-bones typing test in the spirit of Monkeytype, with one addition: every result is kept, so you can watch your speed change over time.

- Time mode (15 / 30 / 60 / 120 s) and words mode (25 / 50 / 100).
- Live caret, per-letter colouring, Tab or Esc to restart.
- Results screen with wpm, accuracy, raw, character counts and a wpm-over-the-test chart.
- Stats page: best / average / trend tiles, wpm-per-test chart with a 10-test moving average, recent results table, filter by mode.
- Everything is stored in your browser (`localStorage`). Export and import JSON to back up or move machines.
- Vanilla HTML/CSS/JS. No dependencies, no build step, no server, no accounts.

## Run it

Open `index.html` in a browser. That's it.

If you prefer a local server (for example so the font loads on a machine that blocks `file://` fonts):

```sh
npx serve .          # or: python3 -m http.server 8000
```

## Test it

The rules of the test (wpm, accuracy, when a test ends, the stats maths) live in `engine.js` with no DOM access, and are covered by `engine.test.js`:

```sh
node --test
```

Requires Node 18 or newer.

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
