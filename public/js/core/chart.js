// Minimal canvas charts. Colours come from CSS variables (pass them in via cssVar()).
import { cssVar } from "./css.js";

const chartState = new WeakMap();
const hooked = new WeakSet();

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 600;
  const cssH = Number(canvas.getAttribute("height")) || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = "11px " + cssVar("--font");
  ctx.textBaseline = "middle";
  return { ctx, cssW, cssH };
}

// round tick step (10/20/25/50/100…) so axis labels are whole, round numbers
function niceScale(maxValue, yMin, minTop = 10) {
  const top = Math.max(minTop, Math.max(maxValue, 0) * 1.1);
  const rough = (top - yMin) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough);
  const steps = Math.ceil((top - yMin) / step);
  return { yMax: yMin + steps * step, steps };
}

function grid(ctx, pad, W, y, yMin, yMax, steps) {
  const sub = cssVar("--sub");
  ctx.strokeStyle = sub; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  ctx.fillStyle = sub;
  for (let k = 0; k <= steps; k++) {
    const v = yMin + ((yMax - yMin) * k) / steps;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + W, yy); ctx.stroke();
    ctx.globalAlpha = 1; ctx.textAlign = "right"; ctx.fillText(String(Math.round(v)), pad.l - 8, yy); ctx.globalAlpha = 0.25;
  }
  ctx.globalAlpha = 1;
}

function hookHover(canvas) {
  if (hooked.has(canvas)) return;
  hooked.add(canvas);
  canvas.addEventListener("mousemove", (e) => {
    const st = chartState.get(canvas);
    if (!st || !st.n || !st.opts.hover) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = st.n <= 1 ? 0 : Math.round(((mx - st.pad.l) / st.W) * (st.n - 1));
    if (i < 0 || i >= st.n) { st.opts.hover(-1); return; }
    const v = st.opts.series[0].values[i];
    st.opts.hover(i, st.x(i), st.y(v) - 6);
  });
  canvas.addEventListener("mouseleave", () => {
    const st = chartState.get(canvas);
    if (st && st.opts.hover) st.opts.hover(-1);
  });
}

// opts: { xs, series: [{values, color, dots, line}], bars?: number[], xLabel(x), yMin,
//         hover?(i, px, py) — called with i = -1 when the pointer leaves }
export function drawLineChart(canvas, opts) {
  const { ctx, cssW, cssH } = setup(canvas);
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b;
  const n = opts.xs.length;
  const all = opts.series.flatMap((s) => s.values).filter(Number.isFinite);
  const yMin = opts.yMin ?? 0;
  const { yMax, steps } = niceScale(Math.max(...all, 0), yMin);
  const x = (i) => pad.l + (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => pad.t + H - ((v - yMin) / (yMax - yMin)) * H;

  grid(ctx, pad, W, y, yMin, yMax, steps);
  // x labels: at most ~8, evenly spaced
  if (n > 0 && opts.xLabel) {
    ctx.textAlign = "center";
    const every = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += every) ctx.fillText(opts.xLabel(opts.xs[i]), x(i), cssH - pad.b / 2);
  }
  // error bars on their own scale, bottom 35% of the plot
  if (opts.bars && opts.bars.some((v) => v > 0)) {
    const bMax = Math.max(...opts.bars);
    const bw = Math.max(3, Math.min(14, (W / Math.max(1, n)) * 0.5));
    ctx.fillStyle = cssVar("--error"); ctx.globalAlpha = 0.7;
    opts.bars.forEach((v, i) => {
      if (!v) return;
      const h = (v / bMax) * H * 0.35;
      ctx.fillRect(x(i) - bw / 2, pad.t + H - h, bw, h);
    });
    ctx.globalAlpha = 1;
  }
  for (const s of opts.series) {
    if (s.line !== false) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath();
      s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
      if (n > 1) ctx.stroke();
    }
    if (s.dots) {
      ctx.fillStyle = s.color;
      s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 4, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  chartState.set(canvas, { x, y, n, pad, W, opts });
  if (opts.hover) hookHover(canvas);
}

// Vertical bars. opts: { labels: string[], values: number[], color?, highlight?: index[], valueLabel?(v) }
export function drawBars(canvas, opts) {
  const { ctx, cssW, cssH } = setup(canvas);
  const pad = { l: 40, r: 12, t: 16, b: 24 };
  const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b;
  const n = opts.values.length;
  const { yMax, steps } = niceScale(Math.max(...opts.values.filter(Number.isFinite), 0), 0, opts.minTop ?? 1);
  const y = (v) => pad.t + H - (v / yMax) * H;
  grid(ctx, pad, W, y, 0, yMax, steps);
  if (!n) return;
  const slot = W / n, bw = Math.max(2, Math.min(40, slot * 0.7));
  const color = opts.color || cssVar("--main");
  const hi = new Set(opts.highlight || []);
  ctx.textAlign = "center";
  opts.values.forEach((v, i) => {
    const cx = pad.l + slot * (i + 0.5);
    ctx.fillStyle = hi.has(i) ? cssVar("--caret") : color;
    ctx.fillRect(cx - bw / 2, y(v), bw, pad.t + H - y(v));
    ctx.fillStyle = cssVar("--sub");
    const every = Math.max(1, Math.ceil(n / 16));
    if (opts.labels && i % every === 0) ctx.fillText(String(opts.labels[i]), cx, cssH - pad.b / 2);
    if (opts.valueLabel && bw >= 18) ctx.fillText(opts.valueLabel(v), cx, y(v) - 7);
  });
}

// Histogram of raw values. opts: { values: number[], bins?: number, color?, xLabel?(lo, hi) }
export function drawHistogram(canvas, opts) {
  const vals = opts.values.filter(Number.isFinite);
  const bins = opts.bins || 10;
  if (!vals.length) return drawBars(canvas, { labels: [], values: [] });
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  const labels = counts.map((_, i) => (opts.xLabel ? opts.xLabel(lo + i * width, lo + (i + 1) * width) : Math.round(lo + i * width)));
  return drawBars(canvas, { labels, values: counts, color: opts.color });
}

export default { drawLineChart, drawBars, drawHistogram };
