// Stacking. A well of cells; every word you type becomes a block as wide as the word and drops into the
// well. Type it at your running pace or better and it lands in the best slot; type it slower and it drops
// at a random offset, awkwardly. Full rows clear with a flash. The stack reaching the top ends the run.
// Score = rows x 100 + words.
import { gameView, alpha, mix, clamp, pick, charMatches, backdrop, font } from "./lib/canvas.js";

// ── pure rules (tested in test/games-pack2.test.js) ─────────────────────
export const ST_COLS = 12;
export const ST_ROWS = 12;
export const ST_SLOW = 1.1; // slower than 110% of your running ms-per-character is "slow"

// grid[row][col], row 0 at the bottom; a cell is null or an object.
export function stGrid(rows = ST_ROWS, cols = ST_COLS) {
  return Array.from({ length: rows }, () => new Array(cols).fill(null));
}
export function stHeights(grid) {
  const cols = grid[0].length, h = new Array(cols).fill(0);
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < cols; c++) if (grid[r][c]) h[c] = r + 1;
  return h;
}
// Row a block of `width` at `col` comes to rest on (it falls until any of its columns touches).
export function stLanding(grid, col, width) {
  const h = stHeights(grid);
  let r = 0;
  for (let c = col; c < col + width; c++) r = Math.max(r, h[c]);
  return r;
}
// The best column for a block: low, no holes underneath, snug against walls and blocks, finishing rows.
export function stBestCol(grid, width) {
  const cols = grid[0].length, h = stHeights(grid);
  let best = 0, bestCost = Infinity;
  for (let col = 0; col + width <= cols; col++) {
    let r = 0;
    for (let c = col; c < col + width; c++) r = Math.max(r, h[c]);
    let holes = 0;
    for (let c = col; c < col + width; c++) holes += r - h[c];
    const row = grid[r] || [];
    const left = col === 0 || !!row[col - 1], right = col + width === cols || !!row[col + width];
    const filled = row.reduce((n, x) => n + (x ? 1 : 0), 0);
    const completes = filled + width === cols;
    const cost = holes * 3 + r * 3 - (left ? 1.5 : 0) - (right ? 1.5 : 0) - (completes ? 12 : 0);
    if (cost < bestCost) { bestCost = cost; best = col; }
  }
  return best;
}
// How far off a slow word may land: 1 column when a little slow (< 1.3x your pace), up to 3 when very slow.
export function stReach(ratio) {
  return ratio < 1.3 ? 1 : ratio < 1.6 ? 2 : 3;
}
// A slow word lands 1..reach columns off the best slot, to a random side (clamped to the well).
export function stAwkwardCol(best, width, cols, rand = Math.random, reach = 3) {
  const max = cols - width;
  if (max <= 0) return 0;
  const d = 1 + Math.floor(rand() * reach);
  const s = rand() < 0.5 ? -1 : 1;
  let col = clamp(best + s * d, 0, max);
  if (col === best) col = clamp(best - s * d, 0, max);
  return col;
}
// Place a block; returns the row it landed on, or -1 when it does not fit (the stack reached the top).
export function stPlace(grid, col, width, cell = {}) {
  const r = stLanding(grid, col, width);
  if (r >= grid.length) return -1;
  for (let c = col; c < col + width; c++) grid[r][c] = Object.assign({ i: c - col }, cell);
  return r;
}
export function stFullRows(grid) {
  const out = [];
  grid.forEach((row, r) => { if (row.every(Boolean)) out.push(r); });
  return out;
}
// Remove full rows, let everything above drop; returns how many rows cleared.
export function stClear(grid) {
  const cols = grid[0].length, keep = grid.filter((row) => !row.every(Boolean));
  const n = grid.length - keep.length;
  for (let i = 0; i < n; i++) keep.push(new Array(cols).fill(null));
  grid.splice(0, grid.length, ...keep);
  return n;
}
// Running average of ms per character: plain mean for the first dozen words, then a moving average.
export function stAvg(avg, x, n) {
  if (avg == null || n <= 0) return x;
  return avg + (x - avg) / Math.min(n + 1, 12);
}
export function stIsSlow(msPerChar, avg) {
  return avg != null && msPerChar > avg * ST_SLOW;
}
export function stScore(rows, words) {
  return rows * 100 + words;
}

const DROP = 0.2; // seconds a block takes to fall
const FLASH = 0.38; // seconds a full row flashes before it clears

// ── game ────────────────────────────────────────────────────────────────
function makeGame() {
  let shell, W = 800, H = 500, cs = 30, wx = 0, wy = 0;
  let grid, queue = [], word = "", typed = "", openedAt = 0, firstKey = null, avg = null, n = 0;
  let rows = 0, words = 0, awkward = 0, drops = [], flashRows = [], clearAt = 0, errFlash = 0, lastWpm = 0, lastSlow = false, over = false, dead = null;
  let keysOk = 0, keysBad = 0, rowBurst = [];

  const game = {
    id: "stacking", name: "stacking", order: "desc", ratio: 16 / 10, minH: 400, maxH: 680,
    rules: "Each word you type drops into the well as a block as wide as the word. Keep your own pace and it lands in the best slot; type it slower than your average and it drops off to one side. Full rows clear. Don't reach the top.",
    scoreLabel: "score",
    init(s) { shell = s; },
    resize(w, h) {
      W = w; H = h;
      cs = Math.floor(Math.min((h - 36) / (ST_ROWS + 2.2), (w * 0.56) / ST_COLS));
      wx = Math.round((w - cs * ST_COLS) / 2);
      wy = Math.round(h - 18 - cs * ST_ROWS);
    },
    reset() {
      grid = stGrid(); queue = []; typed = ""; firstKey = null; avg = null; n = 0;
      rows = 0; words = 0; awkward = 0; drops = []; flashRows = []; clearAt = 0; errFlash = 0; lastWpm = 0; lastSlow = false; over = false; dead = null;
      keysOk = 0; keysBad = 0; rowBurst = [];
      fillQueue();
      word = queue.shift(); fillQueue();
      openedAt = 0;
    },
    start() { game.reset(); openedAt = 0; },
    update(dt) {
      const t = shell.time;
      tick(dt);
      if (dead) { dead.t += dt; if (dead.t > 0.9) finish(); return; }
      if (clearAt && t >= clearAt) {
        const cleared = stClear(grid);
        rows += cleared;
        clearAt = 0; flashRows = [];
        if (cleared) shell.shake = Math.max(shell.shake, 3 + cleared * 2);
      }
      // the fuse: far too slow and the word drops on its own, awkwardly, for no point
      if (t - openedAt > fuse()) drop(true);
    },
    idle(dt) { tick(dt); },
    key(e) {
      if (dead) return;
      const k = e.key;
      if (k.length !== 1 || k === " ") return;
      if (typed.length < word.length && charMatches(word[typed.length], k, shell.pools.lenient)) {
        if (firstKey == null) firstKey = shell.time;
        typed += word[typed.length];
        keysOk++;
        if (typed.length === word.length) drop(false);
      } else {
        keysBad++;
        errFlash = 1;
      }
    },
    draw(ctx, w, h, pal) { draw(ctx, w, h, pal); },
  };

  function tick(dt) {
    for (const d of drops) d.t += dt;
    drops = drops.filter((d) => d.t < DROP);
    for (const b of rowBurst) b.t += dt;
    rowBurst = rowBurst.filter((b) => b.t < 0.5);
    errFlash = Math.max(0, errFlash - dt * 3);
  }

  function fillQueue() {
    const pool = shell.pools.common.filter((w) => w.length <= 10);
    while (queue.length < 4) queue.push(pick(pool.length ? pool : shell.pools.common));
  }
  const expected = () => (avg == null ? null : avg * (word.length + 1) / 1000);
  const fuse = () => Math.max(3, (expected() || 1) * 3);

  function drop(timedOut) {
    const t = shell.time;
    const width = word.length;
    // time for this word: since the previous word dropped (the first word: since its first key)
    const start = n === 0 && firstKey != null ? firstKey : openedAt;
    const ms = Math.max(1, (t - start) * 1000);
    const mpc = Math.max(20, ms / (width + 1)); // 600 wpm cap: keys landing in one frame are not a pace
    const slow = timedOut || stIsSlow(mpc, avg);
    const best = stBestCol(grid, width);
    const col = slow ? stAwkwardCol(best, width, ST_COLS, Math.random, timedOut ? 3 : stReach(mpc / avg)) : best;
    const hover = hoverCol();
    const row = stPlace(grid, col, width, { text: word, slow, born: t });
    if (row < 0) {
      // the stack reached the top: freeze the block sticking out of the well and end
      dead = { col, width, text: word, t: 0 };
      shell.shake = 14;
      shell.particles.burst(wx + (col + width / 2) * cs, wy, { n: 40, color: shell.pal.error, speed: 260 });
      return;
    }
    if (!timedOut) {
      words++;
      avg = stAvg(avg, mpc, n);
      n++;
      lastWpm = 12000 / mpc;
    }
    lastSlow = slow;
    if (slow) awkward++;
    drops.push({ col0: hover, col, row, width, text: word, t: 0, slow });
    const full = stFullRows(grid);
    if (full.length) {
      for (const r of full) if (!flashRows.includes(r)) rowBurst.push({ r, t: -DROP - FLASH });
      flashRows = full;
      if (!clearAt) clearAt = t + DROP + FLASH;
    }
    word = queue.shift(); fillQueue();
    typed = ""; firstKey = null; openedAt = t;
  }

  function hoverCol() { return stBestCol(grid, word.length); }

  function finish() {
    if (over) return;
    over = true;
    const score = stScore(rows, words);
    const wpm = avg ? Math.round(12000 / avg) : 0;
    const acc = keysOk + keysBad ? Math.round((keysOk / (keysOk + keysBad)) * 1000) / 10 : 100;
    shell.end(score, { rows, words, wpm, acc, awkward }, [
      ["rows", String(rows)], ["words", String(words)], ["pace", wpm + " wpm"], ["awkward", String(awkward)], ["acc", acc + "%"],
    ]);
  }

  // ── drawing ───────────────────────────────────────────────────────────
  const cellX = (c) => wx + c * cs;
  const cellY = (r) => wy + (ST_ROWS - 1 - r) * cs;

  function draw(ctx, w, h, pal) {
    backdrop(ctx, w, h, pal, { grid: cs });
    const t = shell.time;
    // the well
    ctx.fillStyle = alpha(pal.bg, 0.85);
    ctx.fillRect(wx, wy, cs * ST_COLS, cs * ST_ROWS);
    ctx.strokeStyle = alpha(pal.edge, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < ST_COLS; c++) { ctx.moveTo(cellX(c) + 0.5, wy); ctx.lineTo(cellX(c) + 0.5, wy + cs * ST_ROWS); }
    for (let r = 1; r < ST_ROWS; r++) { ctx.moveTo(wx, wy + r * cs + 0.5); ctx.lineTo(wx + cs * ST_COLS, wy + r * cs + 0.5); }
    ctx.stroke();
    // walls and floor glow
    ctx.shadowBlur = 14; ctx.shadowColor = pal.caret;
    ctx.fillStyle = pal.main;
    ctx.fillRect(wx - 2, wy, 1.5, cs * ST_ROWS); ctx.fillRect(wx + cs * ST_COLS + 0.5, wy, 1.5, cs * ST_ROWS);
    ctx.fillRect(wx - 2, wy + cs * ST_ROWS, cs * ST_COLS + 4.5, 1.5);
    ctx.shadowBlur = 0;
    // danger line: the top row
    ctx.fillStyle = alpha(pal.error, 0.25 + 0.15 * Math.sin(performance.now() / 300));
    const h0 = Math.max(...stHeights(grid));
    if (h0 >= ST_ROWS - 3) ctx.fillRect(wx, wy, cs * ST_COLS, 1);

    // settled cells (skip the ones still falling)
    const hidden = new Set();
    for (const d of drops) for (let c = d.col; c < d.col + d.width; c++) hidden.add(d.row * 100 + c);
    ctx.font = font(pal, cs * 0.52, 600);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let r = 0; r < ST_ROWS; r++) for (let c = 0; c < ST_COLS; c++) {
      const cell = grid[r][c];
      if (!cell || hidden.has(r * 100 + c)) continue;
      drawCell(ctx, pal, cellX(c), cellY(r), cell.text[cell.i], cell.slow, cell.i === 0, cell.i === cell.text.length - 1, flashRows.includes(r));
    }
    // falling blocks
    for (const d of drops) {
      const k = clamp(d.t / DROP, 0, 1), e = k * k;
      const x = cellX(d.col0 + (d.col - d.col0) * Math.min(1, k * 1.6)) + (d.slow ? Math.sin(k * 20) * cs * 0.08 * (1 - k) : 0);
      const y = hoverY() + (cellY(d.row) - hoverY()) * e;
      for (let i = 0; i < d.width; i++) drawCell(ctx, pal, x + i * cs, y, d.text[i], d.slow, i === 0, i === d.width - 1, false);
    }
    // row clear flash
    for (const b of rowBurst) {
      if (b.t < 0) continue;
      const k = b.t / 0.5;
      ctx.fillStyle = alpha(pal.text, 0.5 * (1 - k));
      const y = cellY(b.r);
      ctx.fillRect(wx - k * 30, y + cs * 0.5 - cs * 0.5 * (1 - k), cs * ST_COLS + k * 60, cs * (1 - k));
    }
    // the word being typed, hovering over its landing column
    if (shell.state === "play" && !dead) hoverBlock(ctx, pal);
    if (dead) {
      const y = wy - cs * 1.1 + Math.sin(dead.t * 40) * 2;
      for (let i = 0; i < dead.width; i++) drawCell(ctx, pal, cellX(dead.col + i), y, dead.text[i], true, i === 0, i === dead.width - 1, false, true);
      ctx.fillStyle = alpha(pal.error, 0.12 * (1 - dead.t));
      ctx.fillRect(0, 0, w, h);
    }
    shell.particles.draw(ctx);
    if (errFlash > 0) { ctx.fillStyle = alpha(pal.error, errFlash * 0.06); ctx.fillRect(0, 0, w, h); }
    side(ctx, w, h, pal, t);
  }

  const hoverY = () => wy - cs * 1.55;

  function drawCell(ctx, pal, x, y, ch, slow, first, last, flash, dead) {
    const edge = dead ? pal.error : slow ? mix(pal.main, pal.error, 0.55) : pal.caret;
    const fill = flash ? mix(pal.main, pal.text, 0.5 + 0.5 * Math.sin(performance.now() / 45)) : alpha(slow ? mix(pal.main, pal.error, 0.35) : pal.main, 0.5);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
    ctx.strokeStyle = edge; ctx.lineWidth = 1;
    // one outline around the word: vertical edges only at its ends
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + 0.5); ctx.lineTo(x + cs - 0.5, y + 0.5);
    ctx.moveTo(x + 0.5, y + cs - 0.5); ctx.lineTo(x + cs - 0.5, y + cs - 0.5);
    if (first) { ctx.moveTo(x + 0.5, y + 0.5); ctx.lineTo(x + 0.5, y + cs - 0.5); }
    if (last) { ctx.moveTo(x + cs - 0.5, y + 0.5); ctx.lineTo(x + cs - 0.5, y + cs - 0.5); }
    ctx.stroke();
    if (ch) { ctx.fillStyle = flash ? pal.bg : alpha(pal.text, 0.85); ctx.fillText(ch, x + cs / 2, y + cs / 2 + 1); }
  }

  function hoverBlock(ctx, pal) {
    const col = hoverCol(), y = hoverY(), x0 = cellX(col);
    const t = shell.time;
    const exp = expected();
    const since = t - openedAt;
    const late = exp != null && since > exp * ST_SLOW;
    const wob = late ? Math.sin(t * 30) * 1.5 : 0;
    // landing guide
    const land = stLanding(grid, col, word.length);
    if (land < ST_ROWS) {
      ctx.fillStyle = alpha(pal.caret, 0.07);
      ctx.fillRect(x0, cellY(land), word.length * cs, (cellY(land) + cs) - (y + cs));
      ctx.strokeStyle = alpha(pal.caret, 0.35);
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(x0 + 0.5, cellY(land) + 0.5, word.length * cs - 1, cs - 1);
      ctx.setLineDash([]);
    }
    ctx.font = font(pal, cs * 0.52, 600);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowBlur = 16; ctx.shadowColor = late ? pal.error : pal.caret;
    ctx.fillStyle = pal.subAlt;
    ctx.fillRect(x0 + wob, y, word.length * cs, cs);
    ctx.shadowBlur = 0;
    for (let i = 0; i < word.length; i++) {
      const x = x0 + i * cs + wob, done = i < typed.length;
      if (done) { ctx.fillStyle = pal.main; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2); }
      ctx.strokeStyle = done ? pal.caret : alpha(pal.sub, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      ctx.fillStyle = done ? pal.text : i === typed.length ? (errFlash > 0 ? mix(pal.text, pal.error, errFlash) : pal.text) : pal.sub;
      ctx.fillText(word[i], x + cs / 2, y + cs / 2 + 1);
      if (i === typed.length) { ctx.fillStyle = errFlash > 0 ? pal.error : pal.caret; ctx.fillRect(x + 3, y + cs - 4, cs - 6, 2); }
    }
    // pace bar: fills to your average; past it the block will drop off to one side
    const bw = word.length * cs, by = y + cs + 4;
    ctx.fillStyle = alpha(pal.sub, 0.3);
    ctx.fillRect(x0, by, bw, 2);
    if (exp != null) {
      const k = clamp(since / (exp * ST_SLOW), 0, 1);
      ctx.fillStyle = late ? pal.error : pal.caret;
      ctx.fillRect(x0, by, bw * k, 2);
    }
  }

  function side(ctx, w, h, pal) {
    const s = clamp(w / 70, 11, 14);
    const lx = Math.max(16, wx - Math.max(150, cs * 4.5)), rx = wx + cs * ST_COLS + 24;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    const stat = (x, y, label, val, color) => {
      ctx.font = font(pal, s * 0.85, 500); ctx.fillStyle = pal.sub; ctx.fillText(label, x, y);
      ctx.font = font(pal, s * 1.6, 700); ctx.fillStyle = color; ctx.fillText(val, x, y + s * 1.2);
    };
    stat(lx, wy, "SCORE", String(stScore(rows, words)), pal.caret);
    stat(lx, wy + s * 4.2, "ROWS", String(rows), pal.text);
    stat(lx, wy + s * 8.4, "WORDS", String(words), pal.text);
    stat(rx, wy, "PACE", avg ? Math.round(12000 / avg) + "" : "—", pal.text);
    stat(rx, wy + s * 4.2, "LAST", lastWpm ? Math.round(lastWpm) + "" : "—", lastSlow ? pal.error : pal.caret);
    // next words
    ctx.font = font(pal, s * 0.85, 500); ctx.fillStyle = pal.sub;
    ctx.fillText("NEXT", rx, wy + s * 9.6);
    ctx.font = font(pal, s * 1.1, 500);
    queue.slice(0, 3).forEach((q, i) => { ctx.fillStyle = alpha(pal.text, 0.8 - i * 0.22); ctx.fillText(q, rx, wy + s * 11 + i * s * 1.6); });
    if (lastSlow && words + awkward > 0 && shell.state === "play") {
      ctx.font = font(pal, s * 0.8, 500); ctx.fillStyle = alpha(pal.error, 0.9);
      ctx.fillText("SLOWER THAN PACE", rx, wy + s * 4.2 + s * 3.1);
    }
  }

  return game;
}

export default gameView(makeGame);
