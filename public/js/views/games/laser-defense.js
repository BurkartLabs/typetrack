// Laser defense. Enemy drones carrying words close in on your turret from the top. Typing a word locks the
// turret on (brackets and a sight line); finishing it fires a beam. Elites carry long words and fly faster.
// Waves with a short break and a banner; three hits on the base and it is over.
// Score = drones destroyed + wave bonuses.
import { gameView, alpha, mix, clamp, pick, prefixMatches, wpmOf, backdrop, font, drawTypedWord, box } from "./lib/canvas.js";

// ── pure rules (tested in test/games-pack2.test.js) ─────────────────────
// Wave n (1-based): how many drones, how many are elites, seconds a drone takes to reach the base
// (elites faster), and the gap between spawns. Everything tightens to a floor.
export function ldWave(n) {
  n = Math.max(1, Math.floor(n));
  const count = 6 + 2 * n;
  const elites = Math.min(Math.floor(count / 2), Math.floor((n - 1) * 0.9));
  const travel = Math.max(3.8, 8.5 - 0.5 * (n - 1));
  const eliteTravel = travel * 0.78;
  const gap = Math.max(0.4, 1.1 - 0.07 * (n - 1));
  return { count, elites, travel, eliteTravel, gap };
}
// Bonus for clearing wave n: 5 per wave number, doubled when the base took no hit during it.
export function ldWaveBonus(n, hitsThisWave) {
  return 5 * n * (hitsThisWave ? 1 : 2);
}
// The spawn order of wave n: elite flags, elites spread through the back two thirds of the wave.
export function ldQueue(n, rand = Math.random) {
  const { count, elites } = ldWave(n);
  const q = new Array(count).fill(false);
  const start = Math.floor(count / 3);
  let placed = 0, guard = 0;
  while (placed < elites && guard++ < 1000) {
    const i = start + Math.floor(rand() * (count - start));
    if (!q[i]) { q[i] = true; placed++; }
  }
  return q;
}
// Typing speed wave n asks for, with average word lengths `common` and `elite` (a word plus its space
// per spawn gap). A curve check for tests, not a claim about players.
export function ldDemandWpm(n, common = 5, elite = 11) {
  const { count, elites, gap } = ldWave(n);
  const chars = (count - elites) * (common + 1) + elites * (elite + 1);
  return (chars / 5) / ((count * gap) / 60);
}
// Index of the live drone nearest the base (largest y) whose word starts with `typed`; -1 if none.
export function ldTarget(list, typed, lenient) {
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (d.dead || !prefixMatches(d.text, typed, lenient)) continue;
    if (best < 0 || d.y > list[best].y) best = i;
  }
  return best;
}

const BREAK = 2.4; // seconds between waves

// ── game ────────────────────────────────────────────────────────────────
function makeGame() {
  let shell, W = 800, H = 500, fs = 17;
  let drones = [], typed = "", target = null, hits = 0, score = 0, kills = 0, bonusTotal = 0;
  let wave = 0, phase = "break", phaseT = 0, queue = [], spawnT = 0, hitsWave = 0, lastBonus = 0;
  let beams = [], rings = [], aim = -Math.PI / 2, chars = 0, keysOk = 0, keysBad = 0, flash = 0, hitFlash = 0, scan = 0;

  const game = {
    id: "laser-defense", name: "laser defense", order: "desc", ratio: 16 / 10, minH: 380, maxH: 660,
    rules: "Drones carry words toward your base. Type a word to lock on, finish it to fire. Elites carry long words and fly faster. Waves get denser. Three hits and the base falls.",
    scoreLabel: "score",
    init(s) { shell = s; },
    resize(w, h) { W = w; H = h; fs = clamp(w / 48, 13, 20); },
    reset() {
      drones = []; typed = ""; target = null; hits = 0; score = 0; kills = 0; bonusTotal = 0;
      wave = 0; phase = "break"; phaseT = 0; queue = []; spawnT = 0; hitsWave = 0; lastBonus = 0;
      beams = []; rings = []; aim = -Math.PI / 2; chars = 0; keysOk = 0; keysBad = 0; flash = 0; hitFlash = 0;
    },
    start() { game.reset(); nextWave(); phaseT = BREAK * 0.6; },
    update(dt) {
      scan += dt;
      if (phase === "break") {
        phaseT -= dt;
        if (phaseT <= 0) { phase = "fight"; spawnT = 0; }
      } else {
        const cfg = ldWave(wave);
        spawnT -= dt;
        if (queue.length && spawnT <= 0) { spawn(queue.shift(), cfg); spawnT = cfg.gap * (0.8 + Math.random() * 0.4); }
      }
      const by = baseY();
      for (const d of drones) {
        if (d.dead) { d.dead += dt; continue; }
        d.t += dt;
        d.y += d.vy * dt;
        d.x = d.x0 + (d.tx - d.x0) * clamp(d.y / by, 0, 1) + Math.sin(d.t * d.wf + d.ph) * d.wa;
        if (d.y >= by - 8) {
          d.dead = 0.0001;
          hits++; hitsWave++;
          hitFlash = 1; shell.shake = 11;
          shell.particles.burst(d.x, by - 8, { n: 26, color: shell.pal.error, speed: 260, dir: -Math.PI / 2, spread: Math.PI, gravity: 420 });
          if (d === target) { target = null; typed = ""; }
          if (hits >= 3) return finish();
        }
      }
      drones = drones.filter((d) => !d.dead || d.dead < 0.4);
      if (target && target.dead) { target = null; typed = ""; }
      if (phase === "fight" && !queue.length && !drones.some((d) => !d.dead)) waveCleared();
      tick(dt);
    },
    idle(dt) { scan += dt; tick(dt); },
    key(e) {
      const k = e.key;
      if (k === "Backspace") { typed = typed.slice(0, -1); retarget(); return; }
      if (k === " " || k === "Enter") { typed = ""; target = null; return; }
      if (k.length !== 1) return;
      const next = typed + k;
      const live = drones.filter((d) => !d.dead);
      let t = target && !target.dead && prefixMatches(target.text, next, shell.pools.lenient) ? target : null;
      if (!t) { const i = ldTarget(live, next, shell.pools.lenient); t = i >= 0 ? live[i] : null; }
      if (!t) { keysBad++; flash = 1; return; }
      keysOk++;
      typed = next;
      target = t;
      if (typed.length >= t.text.length) fire(t);
    },
    draw(ctx, w, h, pal) { draw(ctx, w, h, pal); },
  };

  function tick(dt) {
    for (const b of beams) b.t += dt;
    beams = beams.filter((b) => b.t < 0.28);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 0.5);
    flash = Math.max(0, flash - dt * 4);
    hitFlash = Math.max(0, hitFlash - dt * 2.2);
    const want = target ? Math.atan2(target.y - turret().y, target.x - turret().x) : -Math.PI / 2;
    aim += (want - aim) * Math.min(1, dt * 18);
  }

  const baseY = () => H - 44;
  const turret = () => ({ x: W / 2, y: baseY() + 6 });

  function nextWave() {
    wave++;
    queue = ldQueue(wave);
    hitsWave = 0;
    phase = "break";
    phaseT = BREAK;
  }

  function waveCleared() {
    lastBonus = ldWaveBonus(wave, hitsWave);
    score += lastBonus;
    bonusTotal += lastBonus;
    nextWave();
  }

  function spawn(elite, cfg) {
    const pool = elite ? shell.pools.rare.filter((w) => w.length <= 12) : shell.pools.common;
    const live = drones.filter((d) => !d.dead);
    let text = pick(pool.length ? pool : shell.pools.common);
    // avoid two live drones starting with the same letter when we can: locking stays unambiguous
    for (let i = 0; i < 6 && live.some((d) => d.text[0] === text[0]); i++) text = pick(pool.length ? pool : shell.pools.common);
    const ctx = shell.stage.ctx;
    ctx.font = font(shell.pal, fs, elite ? 600 : 500);
    const tw = ctx.measureText(text).width;
    let x0 = W / 2;
    for (let tries = 0; tries < 8; tries++) {
      x0 = 30 + tw / 2 + Math.random() * Math.max(1, W - 60 - tw);
      if (!live.some((o) => o.y < H * 0.2 && Math.abs(o.x - x0) < (o.w + tw) / 2 + 20)) break;
    }
    // drift toward a point on the base, pulled a little toward the turret
    const tx = W / 2 + (x0 - W / 2) * 0.45;
    const travel = elite ? cfg.eliteTravel : cfg.travel;
    drones.push({ text, x: x0, x0, tx, y: -fs, vy: (baseY() + fs) / travel, w: tw, elite, dead: 0, t: 0,
      wf: 1.2 + Math.random() * 1.4, ph: Math.random() * 6.28, wa: elite ? 10 : 5 });
  }

  function fire(d) {
    d.dead = 0.0001;
    kills++;
    score++;
    chars += d.text.length + 1;
    typed = ""; target = null;
    const pal = shell.pal, tp = turret();
    aim = Math.atan2(d.y - tp.y, d.x - tp.x); // snap: a word can lock and finish within one frame
    beams.push({ x0: tp.x + Math.cos(aim) * 22, y0: tp.y + Math.sin(aim) * 22, x1: d.x, y1: d.y, t: 0, elite: d.elite });
    shell.particles.burst(d.x, d.y, { n: d.elite ? 30 : 18, color: pal.caret, speed: d.elite ? 260 : 200, size: 3.2, life: 0.55 });
    shell.particles.burst(d.x, d.y, { n: 8, color: pal.text, speed: 130, size: 2, life: 0.35 });
    rings.push({ x: d.x, y: d.y, t: 0, s: d.elite ? 60 : 38 });
    if (d.elite) shell.shake = Math.max(shell.shake, 4);
  }

  function retarget() {
    if (!typed) { target = null; return; }
    const live = drones.filter((d) => !d.dead);
    const i = ldTarget(live, typed, shell.pools.lenient);
    target = i >= 0 ? live[i] : null;
    if (!target) typed = "";
  }

  function finish() {
    const wpm = Math.round(wpmOf(chars, shell.time * 1000));
    const acc = keysOk + keysBad ? Math.round((keysOk / (keysOk + keysBad)) * 1000) / 10 : 100;
    shell.end(score, { wpm, acc, wave, kills, time: Math.round(shell.time) }, [
      ["wave", String(wave)], ["destroyed", String(kills)], ["wave bonus", String(bonusTotal)], ["wpm", String(wpm)], ["acc", acc + "%"],
    ]);
  }

  // ── drawing ───────────────────────────────────────────────────────────
  function draw(ctx, w, h, pal) {
    backdrop(ctx, w, h, pal, { grid: 44 });
    const tp = turret(), by = baseY();
    // radar arcs around the turret
    ctx.strokeStyle = alpha(pal.main, 0.12);
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(tp.x, tp.y, (h * 0.24) * r, Math.PI, 2 * Math.PI); ctx.stroke(); }
    const sw = (scan * 0.9) % 2 - 0.5; // sweep angle 0..1 across the upper half
    if (sw >= 0 && sw <= 1) {
      const a = Math.PI + Math.PI * sw;
      const g = ctx.createLinearGradient(tp.x, tp.y, tp.x + Math.cos(a) * h, tp.y + Math.sin(a) * h);
      g.addColorStop(0, alpha(pal.main, 0.25)); g.addColorStop(1, alpha(pal.main, 0));
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(tp.x + Math.cos(a) * h * 1.2, tp.y + Math.sin(a) * h * 1.2); ctx.stroke();
    }

    // sight line to the locked drone
    if (target && !target.dead) {
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -scan * 40;
      ctx.strokeStyle = alpha(pal.caret, 0.55);
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(target.x, target.y); ctx.stroke();
      ctx.restore();
    }

    // drones
    ctx.textBaseline = "alphabetic";
    for (const d of drones) drone(ctx, pal, d);

    // beams
    for (const b of beams) {
      const k = 1 - b.t / 0.28;
      ctx.save();
      ctx.lineCap = "square";
      ctx.shadowBlur = 22; ctx.shadowColor = pal.caret;
      ctx.strokeStyle = alpha(pal.caret, k);
      ctx.lineWidth = (b.elite ? 7 : 5) * k + 1;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = alpha(pal.text, k);
      ctx.lineWidth = 1.5 * k + 0.5;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.restore();
    }
    for (const r of rings) {
      const k = r.t / 0.5, s = r.s * (0.5 + k * 1.2);
      ctx.strokeStyle = alpha(pal.caret, 1 - k);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - s / 2, r.y - s / 2, s, s);
    }
    shell.particles.draw(ctx);

    // base: a shield strip, bunkers and the turret
    const fl = hitFlash;
    ctx.fillStyle = alpha(pal.main, 0.07 + 0.25 * fl);
    ctx.fillRect(0, by, w, h - by);
    ctx.shadowBlur = 14; ctx.shadowColor = pal.caret;
    ctx.fillStyle = fl > 0 ? mix(pal.main, pal.error, fl) : pal.main;
    ctx.fillRect(0, by, w, 1.5);
    ctx.shadowBlur = 0;
    for (let i = 0; i < 3; i++) {
      const up = i >= hits;
      for (const side of [-1, 1]) {
        const x = tp.x + side * (70 + i * 46) - 14;
        box(ctx, x, by + 8, 28, 14, { stroke: up ? pal.main : alpha(pal.sub, 0.6), fill: up ? alpha(pal.main, 0.25) : null, glow: up ? 8 : 0, glowColor: pal.caret });
      }
    }
    ctx.save();
    ctx.translate(tp.x, tp.y);
    ctx.rotate(aim);
    ctx.shadowBlur = 12; ctx.shadowColor = pal.caret;
    ctx.fillStyle = pal.caret;
    ctx.fillRect(4, -2.5, 24, 5);
    ctx.restore();
    box(ctx, tp.x - 15, tp.y - 11, 30, 22, { fill: pal.subAlt, stroke: pal.caret, glow: 14, glowColor: pal.caret });
    ctx.fillStyle = pal.caret;
    ctx.fillRect(tp.x - 3, tp.y - 3, 6, 6);
    if (fl > 0) { ctx.fillStyle = alpha(pal.error, fl * 0.12); ctx.fillRect(0, 0, w, h); }

    hud(ctx, w, h, pal);
    if (phase === "break" && shell.state === "play") banner(ctx, w, h, pal);
  }

  function drone(ctx, pal, d) {
    const isT = d === target;
    const s = d.elite ? 20 : 13;
    if (d.dead) {
      const k = Math.max(0, 1 - d.dead / 0.4);
      ctx.globalAlpha = k;
      ctx.font = font(pal, fs, d.elite ? 600 : 500);
      ctx.fillStyle = pal.caret; ctx.textAlign = "center";
      ctx.fillText(d.text, d.x, d.y - s - 8 - (1 - k) * 12);
      ctx.globalAlpha = 1;
      return;
    }
    const danger = clamp((d.y / baseY() - 0.55) / 0.45, 0, 1);
    // engine trail
    const g = ctx.createLinearGradient(0, d.y - s * 3.5, 0, d.y - s / 2);
    g.addColorStop(0, alpha(pal.main, 0)); g.addColorStop(1, alpha(d.elite ? pal.caret : pal.sub, 0.4));
    ctx.fillStyle = g;
    ctx.fillRect(d.x - (d.elite ? 3 : 1.5), d.y - s * 3.5, d.elite ? 6 : 3, s * 3);
    // hull: a rotated square, elites get a second frame
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(Math.PI / 4 + (d.elite ? d.t * 1.4 : 0));
    const hull = d.elite ? pal.main : pal.subAlt;
    ctx.shadowBlur = d.elite || isT ? 16 : 0; ctx.shadowColor = pal.caret;
    ctx.fillStyle = hull;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isT ? pal.caret : d.elite ? pal.caret : mix(pal.sub, pal.error, danger);
    ctx.lineWidth = 1;
    ctx.strokeRect(-s / 2 + 0.5, -s / 2 + 0.5, s - 1, s - 1);
    if (d.elite) ctx.strokeRect(-s / 2 - 4.5, -s / 2 - 4.5, s + 9, s + 9);
    ctx.restore();
    ctx.fillStyle = d.elite ? pal.text : pal.caret;
    ctx.fillRect(d.x - 1.5, d.y - 1.5, 3, 3);
    // word plate
    ctx.font = font(pal, fs, d.elite ? 600 : 500);
    const ty = d.y - s - 8;
    if (isT) {
      const pad = 6, bw = d.w + pad * 2, bh = fs * 1.35;
      ctx.fillStyle = alpha(pal.main, 0.14);
      ctx.fillRect(d.x - bw / 2, ty - fs * 1.02, bw, bh);
      ctx.shadowBlur = 14; ctx.shadowColor = pal.caret;
      ctx.strokeStyle = pal.caret; ctx.lineWidth = 1;
      brackets(ctx, d.x - bw / 2, ty - fs * 1.02, bw, bh, 6);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = alpha(pal.bg, 0.7);
      ctx.fillRect(d.x - d.w / 2 - 4, ty - fs * 0.95, d.w + 8, fs * 1.25);
    }
    const lo = danger > 0 ? mix(d.elite ? pal.caret : pal.text, pal.error, danger) : d.elite ? mix(pal.text, pal.caret, 0.45) : pal.text;
    drawTypedWord(ctx, d.text, isT ? typed.length : 0, d.x, ty, pal.caret, isT ? lo : alpha(lo, 0.88));
  }

  function brackets(ctx, x, y, bw, bh, a) {
    ctx.beginPath();
    ctx.moveTo(x, y + a); ctx.lineTo(x, y); ctx.lineTo(x + a, y);
    ctx.moveTo(x + bw - a, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + a);
    ctx.moveTo(x + bw, y + bh - a); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - a, y + bh);
    ctx.moveTo(x + a, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - a);
    ctx.stroke();
  }

  function banner(ctx, w, h, pal) {
    const k = phaseT / BREAK; // 1 -> 0
    const a = clamp(Math.min(1 - k, k) * 5, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const big = clamp(w / 12, 34, 72);
    ctx.fillStyle = alpha(pal.bg, 0.6);
    ctx.fillRect(0, h * 0.4 - big * 0.9, w, big * 2.1);
    ctx.fillStyle = pal.main;
    ctx.fillRect(0, h * 0.4 - big * 0.9, w, 1); ctx.fillRect(0, h * 0.4 + big * 1.2, w, 1);
    ctx.font = font(pal, big, 700);
    ctx.shadowBlur = 24; ctx.shadowColor = pal.caret;
    ctx.fillStyle = pal.text;
    ctx.fillText("WAVE " + wave, w / 2, h * 0.4);
    ctx.shadowBlur = 0;
    ctx.font = font(pal, clamp(w / 60, 11, 14), 500);
    ctx.fillStyle = pal.sub;
    const cfg = ldWave(wave);
    const sub = (wave > 1 ? `+${lastBonus} wave bonus${lastBonus === ldWaveBonus(wave - 1, 0) ? " (clean)" : ""}  ·  ` : "") +
      `${cfg.count} drones${cfg.elites ? ` · ${cfg.elites} elite` : ""}`;
    ctx.fillText(sub.toUpperCase(), w / 2, h * 0.4 + big * 0.8);
    ctx.restore();
  }

  function hud(ctx, w, h, pal) {
    const s = clamp(w / 70, 11, 14);
    const band = 14 + s * 3.2; // drones slide out from under the HUD band
    const g = ctx.createLinearGradient(0, 0, 0, band + 18);
    g.addColorStop(0, pal.bg); g.addColorStop(band / (band + 18), alpha(pal.bg, 0.9)); g.addColorStop(1, alpha(pal.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, band + 18);
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = font(pal, s * 0.85, 500);
    ctx.fillStyle = pal.sub;
    ctx.fillText("SCORE", 16, 14); ctx.fillText("WAVE", 110, 14); ctx.fillText("LEFT", 190, 14);
    ctx.font = font(pal, s * 1.6, 700);
    ctx.fillStyle = pal.caret; ctx.fillText(String(score), 16, 14 + s * 1.2);
    ctx.fillStyle = pal.text;
    ctx.fillText(String(Math.max(1, wave)), 110, 14 + s * 1.2);
    ctx.fillText(String(queue.length + drones.filter((d) => !d.dead).length), 190, 14 + s * 1.2);
    // base integrity: three squares
    ctx.font = font(pal, s * 0.85, 500); ctx.fillStyle = pal.sub; ctx.textAlign = "right";
    ctx.fillText("BASE", w - 16, 14);
    for (let i = 0; i < 3; i++) {
      const x = w - 16 - (3 - i) * 20 + 8, y = 16 + s * 1.2;
      if (i < 3 - hits) { ctx.shadowBlur = 10; ctx.shadowColor = pal.caret; ctx.fillStyle = pal.main; ctx.fillRect(x, y, 12, 12); ctx.shadowBlur = 0; }
      else { ctx.strokeStyle = pal.sub; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 11, 11); }
    }
    // input readout under the base line
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = font(pal, fs * 0.85, 500);
    const y = h - 11;
    if (typed) { ctx.fillStyle = pal.caret; ctx.fillText(typed, w / 2, y); }
    const cw = typed ? ctx.measureText(typed).width : 0;
    ctx.fillStyle = flash > 0 ? mix(pal.caret, pal.error, flash) : pal.caret;
    if (flash > 0 || Math.floor(performance.now() / 500) % 2 === 0) ctx.fillRect(w / 2 + cw / 2 + 2, y + fs * 0.3, fs * 0.5, 2);
    if (flash > 0) { ctx.fillStyle = alpha(pal.error, flash * 0.2); ctx.fillRect(0, baseY(), w, h - baseY()); }
  }

  return game;
}

export default gameView(makeGame);
