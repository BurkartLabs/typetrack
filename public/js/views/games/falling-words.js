// Falling words, elite tier. Words rain down; typing letters locks onto the lowest word that matches what
// you have typed, finishing it clears it. Spawn rate and fall speed climb without a ceiling, tuned so a
// 150 wpm typist lasts roughly a minute and a half. Three lives; score = words cleared.
import { gameView, alpha, mix, clamp, pick, prefixMatches, wpmOf, backdrop, font, drawTypedWord } from "./lib/canvas.js";

// ── pure rules (tested in test/games-pack2.test.js) ─────────────────────
// Words spawned per second at t seconds into the run: rises forever.
export function fwSpawnRate(t) {
  return 0.8 + 0.026 * t + 0.00012 * t * t;
}
// Seconds a word takes to fall the full height at t (shrinks to a floor of 2.4 s).
export function fwFallTime(t) {
  return Math.max(2.4, 8.5 - 0.06 * t);
}
// Longer words as the run goes on: sample a few and keep the longest with a rising probability.
export function fwPickWord(pool, t, rand = Math.random) {
  const a = pick(pool, rand);
  if (rand() > clamp(t / 100, 0, 0.75)) return a;
  let best = a;
  for (let i = 0; i < 2; i++) { const b = pick(pool, rand); if (b.length > best.length) best = b; }
  return best;
}
// Index of the lowest (largest y) live word whose text starts with `typed`; -1 if none.
export function fwTarget(list, typed, lenient) {
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (w.dead || !prefixMatches(w.text, typed, lenient)) continue;
    if (best < 0 || w.y > list[best].y) best = i;
  }
  return best;
}

// ── game ────────────────────────────────────────────────────────────────
function makeGame() {
  let shell, W = 800, H = 450, fs = 18;
  let list = [], typed = "", target = null, lives = 3, score = 0, spawnAcc = 0, gridY = 0;
  let chars = 0, keysOk = 0, keysBad = 0, flash = 0, errFlash = 0, rings = [], peak = 0;

  const game = {
    id: "falling-words", name: "falling words", order: "desc", ratio: 16 / 10, minH: 360, maxH: 640,
    rules: "Type the falling words before they land. Letters lock onto the lowest matching word. It never stops speeding up. Three lives.",
    scoreLabel: "words cleared",
    init(s) { shell = s; },
    resize(w, h) { W = w; H = h; fs = clamp(w / 44, 14, 22); },
    reset() { list = []; typed = ""; target = null; lives = 3; score = 0; spawnAcc = 0.6; chars = 0; keysOk = 0; keysBad = 0; rings = []; peak = 0; },
    start() { game.reset(); spawn(); },
    update(dt) {
      const t = shell.time;
      const rate = fwSpawnRate(t);
      peak = rate;
      spawnAcc += dt * rate;
      while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); }
      gridY += dt * H / fwFallTime(t) * 0.25;
      const floor = H - 34;
      for (const w of list) {
        if (w.dead) { w.dead += dt; continue; }
        w.y += w.vy * dt;
        if (w.y >= floor) {
          w.dead = 0.0001;
          lives--;
          errFlash = 1;
          shell.shake = 9;
          shell.particles.burst(w.x, floor, { n: 18, color: shell.pal.error, speed: 220, dir: -Math.PI / 2, spread: Math.PI, gravity: 400 });
          if (w === target) { target = null; typed = ""; }
          if (lives <= 0) return finish();
        }
      }
      list = list.filter((w) => !w.dead || w.dead < 0.35);
      if (target && target.dead) { target = null; typed = ""; }
      for (const r of rings) r.t += dt;
      rings = rings.filter((r) => r.t < 0.45);
      flash = Math.max(0, flash - dt * 4);
      errFlash = Math.max(0, errFlash - dt * 2.5);
    },
    idle(dt) {
      gridY += dt * 12;
      for (const r of rings) r.t += dt;
      rings = rings.filter((r) => r.t < 0.45);
      errFlash = Math.max(0, errFlash - dt * 2.5);
    },
    key(e) {
      const k = e.key;
      if (k === "Backspace") {
        typed = typed.slice(0, -1);
        retarget();
        return;
      }
      if (k === " " || k === "Enter") { typed = ""; target = null; return; }
      if (k.length !== 1) return;
      const next = typed + k;
      const live = list.filter((w) => !w.dead);
      // keep the current target while it still matches; otherwise lock onto the lowest match
      let t = target && !target.dead && prefixMatches(target.text, next, shell.pools.lenient) ? target : null;
      if (!t) { const i = fwTarget(live, next, shell.pools.lenient); t = i >= 0 ? live[i] : null; }
      if (!t) { keysBad++; flash = 1; return; }
      keysOk++;
      typed = next;
      target = t;
      if (typed.length >= t.text.length) clear(t);
    },
    draw(ctx, w, h, pal) { draw(ctx, w, h, pal); },
  };

  function retarget() {
    if (!typed) { target = null; return; }
    const live = list.filter((w) => !w.dead);
    const i = fwTarget(live, typed, shell.pools.lenient);
    target = i >= 0 ? live[i] : null;
    if (!target) typed = "";
  }

  function spawn() {
    const t = shell.time;
    const text = fwPickWord(shell.pools.common, t);
    const ctx = shell.stage.ctx;
    ctx.font = font(shell.pal, fs);
    const tw = ctx.measureText(text).width;
    let x = W / 2;
    for (let tries = 0; tries < 8; tries++) {
      x = 24 + tw / 2 + Math.random() * Math.max(1, W - 48 - tw);
      const clash = list.some((o) => !o.dead && o.y < H * 0.22 && Math.abs(o.x - x) < (o.w + tw) / 2 + 16);
      if (!clash) break;
    }
    const vy = (H - 34) / fwFallTime(t) * (0.9 + Math.random() * 0.2);
    list.push({ text, x, y: -fs * 0.4, vy, w: tw, dead: 0, born: t });
  }

  function clear(w) {
    w.dead = 0.0001;
    score++;
    chars += w.text.length + 1;
    typed = "";
    target = null;
    const pal = shell.pal;
    shell.particles.burst(w.x, w.y - fs * 0.35, { n: 16, color: pal.caret, speed: 190, size: 3.2, life: 0.5 });
    shell.particles.burst(w.x, w.y - fs * 0.35, { n: 6, color: pal.text, speed: 120, size: 2, life: 0.35 });
    rings.push({ x: w.x, y: w.y - fs * 0.35, t: 0, s: w.w });
  }

  function finish() {
    const ms = shell.time * 1000;
    const wpm = Math.round(wpmOf(chars, ms));
    const acc = keysOk + keysBad ? Math.round((keysOk / (keysOk + keysBad)) * 1000) / 10 : 100;
    shell.end(score, { wpm, acc, time: Math.round(shell.time) }, [
      ["survived", Math.round(shell.time) + "s"], ["wpm", String(wpm)], ["acc", acc + "%"], ["peak rate", peak.toFixed(1) + "/s"],
    ]);
  }

  function draw(ctx, w, h, pal) {
    backdrop(ctx, w, h, pal, { offsetY: gridY });
    const floor = h - 34;
    // floor: a crimson line that pulses red when a word lands
    const fl = errFlash;
    ctx.fillStyle = alpha(pal.main, 0.08 + 0.25 * fl);
    ctx.fillRect(0, floor, w, h - floor);
    ctx.shadowBlur = 12; ctx.shadowColor = pal.caret;
    ctx.fillStyle = fl > 0 ? mix(pal.caret, pal.error, fl) : pal.main;
    ctx.fillRect(0, floor, w, 1.5);
    ctx.shadowBlur = 0;
    if (fl > 0) { ctx.fillStyle = alpha(pal.error, fl * 0.12); ctx.fillRect(0, 0, w, h); }

    ctx.textBaseline = "alphabetic";
    ctx.font = font(pal, fs);
    for (const o of list) {
      if (o.dead) {
        // shatter: fade the word up and out
        const k = 1 - o.dead / 0.35;
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = pal.caret;
        ctx.textAlign = "center";
        ctx.fillText(o.text, o.x, o.y - (1 - k) * 10);
        ctx.globalAlpha = 1;
        continue;
      }
      const danger = clamp((o.y / floor - 0.6) / 0.4, 0, 1);
      const isT = o === target;
      // falling streak
      const g = ctx.createLinearGradient(0, o.y - fs * 3.2, 0, o.y - fs);
      g.addColorStop(0, alpha(pal.main, 0));
      g.addColorStop(1, alpha(isT ? pal.caret : pal.sub, isT ? 0.5 : 0.22));
      ctx.fillStyle = g;
      ctx.fillRect(o.x - 0.5, o.y - fs * 3.2, 1, fs * 2.2);
      if (isT) {
        const pad = 6, bw = o.w + pad * 2, bh = fs * 1.35;
        ctx.shadowBlur = 14; ctx.shadowColor = pal.caret;
        ctx.strokeStyle = pal.caret; ctx.lineWidth = 1;
        brackets(ctx, o.x - bw / 2, o.y - fs * 1.02, bw, bh, 6);
        ctx.shadowBlur = 0;
        ctx.fillStyle = alpha(pal.main, 0.12);
        ctx.fillRect(o.x - bw / 2, o.y - fs * 1.02, bw, bh);
      }
      const lo = danger > 0 ? mix(pal.text, pal.error, danger) : pal.text;
      drawTypedWord(ctx, o.text, isT ? typed.length : 0, o.x, o.y, pal.caret, isT ? lo : alpha(lo, 0.86));
    }
    for (const r of rings) {
      const k = r.t / 0.45, s = r.s * (0.6 + k * 0.9);
      ctx.strokeStyle = alpha(pal.caret, 1 - k);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - s / 2, r.y - s * 0.22, s, s * 0.44);
    }
    shell.particles.draw(ctx);
    hud(ctx, w, h, pal);
  }

  function brackets(ctx, x, y, bw, bh, a) {
    ctx.beginPath();
    ctx.moveTo(x, y + a); ctx.lineTo(x, y); ctx.lineTo(x + a, y);
    ctx.moveTo(x + bw - a, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + a);
    ctx.moveTo(x + bw, y + bh - a); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - a, y + bh);
    ctx.moveTo(x + a, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - a);
    ctx.stroke();
  }

  function hud(ctx, w, h, pal) {
    const s = clamp(w / 70, 11, 14);
    // a band at the top that words slide out from under
    const band = 14 + s * 3.2;
    const g = ctx.createLinearGradient(0, 0, 0, band + 18);
    g.addColorStop(0, pal.bg); g.addColorStop(band / (band + 18), alpha(pal.bg, 0.92)); g.addColorStop(1, alpha(pal.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, band + 18);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = font(pal, s * 0.85, 500);
    ctx.fillStyle = pal.sub;
    ctx.fillText("CLEARED", 16, 14);
    ctx.fillText("TIME", 120, 14);
    ctx.fillText("RATE", 210, 14);
    ctx.font = font(pal, s * 1.6, 700);
    ctx.fillStyle = pal.caret;
    ctx.fillText(String(score), 16, 14 + s * 1.2);
    ctx.fillStyle = pal.text;
    ctx.fillText(Math.floor(shell.time) + "s", 120, 14 + s * 1.2);
    ctx.fillText(fwSpawnRate(shell.time).toFixed(1), 210, 14 + s * 1.2);
    // lives: three squares
    for (let i = 0; i < 3; i++) {
      const x = w - 16 - (3 - i) * 20, y = 18;
      if (i < lives) { ctx.shadowBlur = 10; ctx.shadowColor = pal.caret; ctx.fillStyle = pal.main; ctx.fillRect(x, y, 12, 12); ctx.shadowBlur = 0; }
      else { ctx.strokeStyle = pal.sub; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 11, 11); }
    }
    // the input line, above the floor
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = font(pal, fs * 0.9, 500);
    const y = h - 17;
    if (typed) { ctx.fillStyle = pal.caret; ctx.fillText(typed, w / 2, y); }
    const cw = typed ? ctx.measureText(typed).width : 0;
    ctx.fillStyle = flash > 0 ? mix(pal.caret, pal.error, flash) : pal.caret;
    if (flash > 0 || Math.floor(performance.now() / 500) % 2 === 0) ctx.fillRect(w / 2 + cw / 2 + 2, y + fs * 0.35, fs * 0.55, 2);
    if (flash > 0) { ctx.fillStyle = alpha(pal.error, flash * 0.22); ctx.fillRect(0, h - 34, w, 34); }
  }

  return game;
}

export default gameView(makeGame);
