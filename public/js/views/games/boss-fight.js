// Boss fight. A boss with an HP bar; you type a stream of words and every finished word hits it for damage
// scaled by your live speed. Stop for more than 1.5 s or make an error and it heals a little. At 66% and
// 33% HP it changes phase and the text gets harder: common words, then longer words, then punctuation.
// Score = seconds to defeat it (lower is better). It enrages at three minutes and the run is lost.
import { gameView, alpha, mix, clamp, pick, charMatches, wpmOf, backdrop, font, box } from "./lib/canvas.js";

// ── pure rules (tested in test/games-pack2.test.js) ─────────────────────
export const BOSS_HP = 1000;
export const BOSS_ENRAGE = 180; // seconds
export const BOSS_IDLE = 1.5; // seconds without a correct key before it heals
export const BOSS_ERR_HEAL = 10;
export const BOSS_REGEN = 30; // hp per second while you are idle

// Damage of one finished word: its characters plus the space, times live wpm / 100 (clamped 0.4-2.5).
// At a steady w wpm that is w*w/1200 hp per second: 1000 hp falls in ~53 s at 150 wpm, ~30 s at 200.
export function bossDamage(word, wpm) {
  return Math.round((String(word).length + 1) * clamp((wpm || 0) / 100, 0.4, 2.5) * 10) / 10;
}
// Live wpm from correct-key times (seconds): keys in the last `win` seconds, over at least one second.
export function bossLiveWpm(times, now, win = 4) {
  const from = now - win;
  let n = 0;
  for (let i = times.length - 1; i >= 0 && times[i] > from; i--) n++;
  const span = Math.max(1, Math.min(win, now));
  return (n / 5) / (span / 60);
}
// Heal per second after `idle` seconds without a correct key.
export function bossHealRate(idle) {
  return idle > BOSS_IDLE ? BOSS_REGEN : 0;
}
// Phase from the HP fraction: 0 above 66%, 1 above 33%, 2 below.
export function bossPhase(frac) {
  return frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
}
// Healing never climbs back over the ceiling of the phase already reached.
export function bossHeal(hp, amount, phase, max = BOSS_HP) {
  const ceil = max * [1, 0.66, 0.33][clamp(phase, 0, 2)];
  if (hp >= ceil) return hp;
  return Math.min(ceil, hp + amount);
}
// Phase 3 text: the word with punctuation, keeping its letters.
export function bossPunctuate(word, rand = Math.random) {
  const cap = word[0].toUpperCase() + word.slice(1);
  const forms = [
    () => word + ",", () => word + ".", () => word + ";", () => word + ":", () => word + "?", () => word + "!",
    () => cap + ".", () => "(" + word + ")", () => '"' + word + '"', () => word + "'s", () => word + "-",
  ];
  let out = forms[Math.floor(rand() * forms.length)]();
  if (out.endsWith("-")) out = word + "-" + pick(["based", "like", "free", "wise"], rand);
  return out;
}
// A word for the phase: common, then long (7+ letters, or rare up to 11), then punctuated common.
export function bossWord(phase, common, rare, rand = Math.random) {
  if (phase === 0) return pick(common, rand);
  if (phase === 1) {
    const long = common.filter((w) => w.length >= 7);
    const r = rare.filter((w) => w.length <= 11);
    const pool = rand() < 0.5 && r.length ? r : long.length ? long : common;
    return pick(pool, rand);
  }
  return bossPunctuate(pick(common, rand), rand);
}

const PHASE_NAMES = ["common words", "longer words", "punctuation"];

// ── game ────────────────────────────────────────────────────────────────
function makeGame() {
  let shell, W = 800, H = 480, fs = 22;
  let hp = BOSS_HP, ghost = BOSS_HP, phase = 0, stream = [], cur = 0, typed = "", times = [], lastOk = 0, wpm = 0;
  let shots = [], floats = [], errFlash = 0, hitFlash = 0, banner = 0, dying = 0, over = false, scroll = 0, rot = 0;
  let chars = 0, keysOk = 0, keysBad = 0, healed = 0, peakWpm = 0;

  const game = {
    id: "boss-fight", name: "boss fight", order: "asc", ratio: 16 / 10, minH: 380, maxH: 640,
    rules: "Type the stream to hit the boss; faster typing hits harder. Stop for 1.5 s or make an error and it heals. At 66% and 33% it changes phase: longer words, then punctuation. Beat it fast: three minutes and it enrages.",
    scoreLabel: "time to defeat", wonTitle: "boss down", lostTitle: "enraged",
    fmt: (s) => Number(s).toFixed(1) + "s",
    init(s) { shell = s; },
    resize(w, h) { W = w; H = h; fs = clamp(w / 36, 15, 26); layout(); },
    reset() {
      hp = BOSS_HP; ghost = BOSS_HP; phase = 0; stream = []; cur = 0; typed = ""; times = []; lastOk = 0; wpm = 0;
      shots = []; floats = []; errFlash = 0; hitFlash = 0; banner = 0; dying = 0; over = false; scroll = 0;
      chars = 0; keysOk = 0; keysBad = 0; healed = 0; peakWpm = 0;
      fill();
      layout();
      scroll = stream[0] ? stream[0].x : 0;
    },
    start() { game.reset(); banner = 1.6; },
    update(dt) {
      const t = shell.time;
      tick(dt);
      if (dying) {
        dying += dt;
        if (dying > 0.5 && Math.random() < dt * 30) shell.particles.burst(bossX() + (Math.random() - 0.5) * size() * 2, bossY() + (Math.random() - 0.5) * size() * 2, { n: 6, color: shell.pal.caret, speed: 160 });
        if (dying > 1.6) finish(true);
        return;
      }
      wpm = bossLiveWpm(times, t);
      if (times.length > 10) peakWpm = Math.max(peakWpm, wpm);
      const rate = bossHealRate(t - lastOk);
      if (rate > 0) heal(rate * dt, false);
      if (t >= BOSS_ENRAGE) finish(false);
    },
    idle(dt) { tick(dt); },
    key(e) {
      if (dying) return;
      const k = e.key;
      if (k.length !== 1) return;
      const w = stream[cur];
      if (k === " " && typed.length === 0) return; // a habit space between words is free
      if (typed.length < w.text.length && charMatches(w.text[typed.length], k, shell.pools.lenient)) {
        typed += w.text[typed.length];
        keysOk++;
        lastOk = shell.time;
        times.push(shell.time);
        if (times.length > 400) times.splice(0, 200);
        if (typed.length === w.text.length) hit(w);
      } else {
        keysBad++;
        errFlash = 1;
        heal(BOSS_ERR_HEAL, true);
      }
    },
    draw(ctx, w, h, pal) { draw(ctx, w, h, pal); },
  };

  function tick(dt) {
    rot += dt;
    ghost = ghost > hp ? Math.max(hp, ghost - dt * BOSS_HP * 0.35) : hp;
    errFlash = Math.max(0, errFlash - dt * 3);
    hitFlash = Math.max(0, hitFlash - dt * 5);
    banner = Math.max(0, banner - dt);
    const target = stream[cur] ? stream[cur].x : scroll;
    scroll += (target - scroll) * Math.min(1, dt * 12);
    for (const s of shots) {
      s.t += dt;
      if (s.t >= 0.16 && !s.done) { s.done = true; land(s); }
    }
    shots = shots.filter((s) => s.t < 0.3);
    for (const f of floats) f.t += dt;
    floats = floats.filter((f) => f.t < 1);
  }

  const bossX = () => W / 2;
  const bossY = () => H * 0.42;
  const size = () => Math.min(W, H) * 0.13;
  const ribbonY = () => H - fs * 1.9;

  function fill() {
    while (stream.length - cur < 14) stream.push({ text: bossWord(phase, shell.pools.common, shell.pools.rare), x: 0, w: 0 });
  }
  function layout() {
    if (!shell || !stream.length) return;
    const ctx = shell.stage.ctx;
    ctx.font = font(shell.pal, fs);
    const gap = ctx.measureText(" ").width;
    let x = stream[0].x || 0;
    for (const w of stream) { w.x = x; w.w = ctx.measureText(w.text).width; x += w.w + gap; }
  }

  function hit(w) {
    wpm = bossLiveWpm(times, shell.time); // fresh: several keys can land within one frame
    const dmg = bossDamage(w.text, wpm);
    chars += w.text.length + 1;
    cur++;
    typed = "";
    // drop words far behind, keep the ribbon light
    if (cur > 8) { stream.splice(0, cur - 8); cur = 8; }
    fill();
    layout();
    const sx = W * 0.22 + (w.x - scroll) + w.w / 2;
    shots.push({ x0: sx, y0: ribbonY() - fs, t: 0, dmg, done: false });
  }

  function land(s) {
    if (dying) return;
    hp = Math.max(0, hp - s.dmg);
    hitFlash = 1;
    shell.shake = Math.max(shell.shake, clamp(s.dmg / 3, 2, 8));
    const pal = shell.pal;
    shell.particles.burst(bossX(), bossY() + size() * 0.2, { n: 10, color: pal.caret, speed: 180, size: 3, dir: Math.PI / 2, spread: Math.PI * 1.2 });
    floats.push({ x: bossX() + (Math.random() - 0.5) * size() * 2.4, y: bossY() - size() * (0.8 + (floats.length % 4) * 0.3), t: 0, text: "-" + Math.round(s.dmg), heal: false });
    const p = bossPhase(hp / BOSS_HP);
    if (hp <= 0) {
      dying = 0.0001;
      shell.shake = 14;
      shell.particles.burst(bossX(), bossY(), { n: 60, color: pal.caret, speed: 320, size: 4, life: 0.9 });
      shell.particles.burst(bossX(), bossY(), { n: 24, color: pal.text, speed: 220, size: 2, life: 0.7 });
    } else if (p > phase) {
      phase = p;
      banner = 1.8;
      shell.shake = 12;
      shell.particles.burst(bossX(), bossY(), { n: 40, color: pal.error, speed: 280, size: 3.5, life: 0.8 });
      // the queue after the current word switches to the new phase's text
      stream.length = cur + 1;
      fill();
      layout();
    }
  }

  function heal(amount, fromError) {
    const before = hp;
    hp = bossHeal(hp, amount, phase);
    const d = hp - before;
    if (d <= 0) return;
    healed += d;
    if (fromError || Math.random() < 0.08) floats.push({ x: bossX() + size() * 1.3, y: bossY() - size() * 0.4, t: 0, text: "+" + Math.max(1, Math.round(fromError ? d : BOSS_REGEN)), heal: true });
  }

  function finish(won) {
    if (over) return;
    over = true;
    const secs = Math.round(shell.time * 10) / 10;
    const avg = Math.round(wpmOf(chars, shell.time * 1000));
    const acc = keysOk + keysBad ? Math.round((keysOk / (keysOk + keysBad)) * 1000) / 10 : 100;
    const lines = [["wpm", String(avg)], ["peak", Math.round(peakWpm) + " wpm"], ["acc", acc + "%"], ["healed", Math.round(healed) + " hp"]];
    if (won) shell.end(secs, { wpm: avg, acc, won: true, order: "asc" }, lines);
    else shell.end(null, { wpm: avg, acc, won: false }, [["boss hp", Math.round(hp) + " / " + BOSS_HP]].concat(lines));
  }

  // ── drawing ───────────────────────────────────────────────────────────
  function draw(ctx, w, h, pal) {
    backdrop(ctx, w, h, pal, { grid: 40 });
    const bx = bossX(), by = bossY(), S = size();
    const rage = shell.state === "play" ? clamp((shell.time - BOSS_ENRAGE * 0.7) / (BOSS_ENRAGE * 0.3), 0, 1) : 0;
    const col = [pal.main, mix(pal.main, pal.error, 0.4), pal.error][phase];
    // aura
    const g = ctx.createRadialGradient(bx, by, S * 0.3, bx, by, S * 3.2);
    g.addColorStop(0, alpha(col, 0.22 + hitFlash * 0.2 + rage * 0.2)); g.addColorStop(1, alpha(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(bx - S * 3.2, by - S * 3.2, S * 6.4, S * 6.4);
    const gone = dying ? clamp(dying / 1.2, 0, 1) : 0;
    if (gone < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - gone;
      const bob = Math.sin(rot * 1.6) * S * 0.06;
      ctx.translate(bx + (dying ? (Math.random() - 0.5) * 8 : 0), by + bob);
      // orbiting squares, more per phase
      const n = 4 + phase * 2;
      for (let i = 0; i < n; i++) {
        const a = rot * (0.7 + phase * 0.35) + (i / n) * Math.PI * 2;
        const r = S * (1.75 + 0.12 * Math.sin(rot * 2 + i));
        ctx.save();
        ctx.translate(Math.cos(a) * r, Math.sin(a) * r * 0.55);
        ctx.rotate(a);
        box(ctx, -5, -5, 10, 10, { fill: alpha(col, 0.5), stroke: pal.caret, glow: 8, glowColor: pal.caret });
        ctx.restore();
      }
      // two counter-rotating frames
      ctx.lineWidth = 1;
      for (const [k, sp, a] of [[1.45, 0.4, 0.5], [1.2, -0.6, 0.8]]) {
        ctx.save();
        ctx.rotate(rot * sp * (1 + phase * 0.5));
        ctx.strokeStyle = alpha(pal.caret, a);
        ctx.shadowBlur = 12; ctx.shadowColor = pal.caret;
        ctx.strokeRect(-S * k, -S * k, S * k * 2, S * k * 2);
        ctx.restore();
      }
      // core
      ctx.rotate(Math.PI / 4);
      ctx.shadowBlur = 30 + hitFlash * 30; ctx.shadowColor = pal.caret;
      ctx.fillStyle = hitFlash > 0 ? mix(col, pal.text, hitFlash * 0.6) : col;
      ctx.fillRect(-S * 0.8, -S * 0.8, S * 1.6, S * 1.6);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.caret;
      ctx.strokeRect(-S * 0.8 + 0.5, -S * 0.8 + 0.5, S * 1.6 - 1, S * 1.6 - 1);
      ctx.fillStyle = alpha(pal.bg, 0.55);
      ctx.fillRect(-S * 0.45, -S * 0.45, S * 0.9, S * 0.9);
      ctx.rotate(-Math.PI / 4);
      // eye: a slit that narrows when idle healing kicks in
      const healing = shell.state === "play" && bossHealRate(shell.time - lastOk) > 0;
      const eh = healing ? S * 0.07 : S * 0.16 + hitFlash * S * 0.1;
      ctx.fillStyle = healing ? pal.error : pal.text;
      ctx.shadowBlur = 16; ctx.shadowColor = healing ? pal.error : pal.caret;
      ctx.fillRect(-S * 0.3, -eh / 2, S * 0.6, eh);
      ctx.shadowBlur = 0;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(-S * 0.1, -eh / 2, S * 0.12, eh);
      ctx.restore();
    }
    // shots from the ribbon to the core
    for (const s of shots) {
      const k = clamp(s.t / 0.16, 0, 1);
      const x = s.x0 + (bx - s.x0) * k, y = s.y0 + (by - s.y0) * k;
      ctx.strokeStyle = alpha(pal.caret, 1 - clamp((s.t - 0.16) / 0.14, 0, 1));
      ctx.lineWidth = 2;
      ctx.shadowBlur = 14; ctx.shadowColor = pal.caret;
      ctx.beginPath(); ctx.moveTo(s.x0 + (bx - s.x0) * Math.max(0, k - 0.35), s.y0 + (by - s.y0) * Math.max(0, k - 0.35)); ctx.lineTo(x, y); ctx.stroke();
      ctx.shadowBlur = 0;
      if (!s.done) { ctx.fillStyle = pal.text; ctx.fillRect(x - 3, y - 3, 6, 6); }
    }
    shell.particles.draw(ctx);
    // floating numbers
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const f of floats) {
      const k = f.t;
      ctx.globalAlpha = 1 - k;
      ctx.font = font(pal, fs * (f.heal ? 0.7 : 0.9), 700);
      ctx.fillStyle = f.heal ? pal.error : pal.text;
      ctx.fillText(f.text, f.x, f.y - k * 40);
    }
    ctx.globalAlpha = 1;
    if (rage > 0) { ctx.fillStyle = alpha(pal.error, rage * 0.08 * (0.6 + 0.4 * Math.sin(rot * 6))); ctx.fillRect(0, 0, w, h); }
    if (errFlash > 0) { ctx.fillStyle = alpha(pal.error, errFlash * 0.08); ctx.fillRect(0, 0, w, h); }
    hpBar(ctx, w, h, pal);
    ribbon(ctx, w, h, pal);
    if (banner > 0 && shell.state === "play" && !dying) phaseBanner(ctx, w, h, pal);
  }

  function hpBar(ctx, w, h, pal) {
    const bw = Math.min(w * 0.64, 640), x = (w - bw) / 2, y = 34, bh = 12;
    const s = clamp(w / 70, 11, 14);
    ctx.textBaseline = "bottom";
    ctx.font = font(pal, s * 0.85, 500);
    ctx.textAlign = "left"; ctx.fillStyle = pal.sub;
    ctx.fillText("THE COMPILER · PHASE " + (phase + 1) + " · " + PHASE_NAMES[phase].toUpperCase(), x, y - 6);
    ctx.textAlign = "right"; ctx.fillStyle = pal.text;
    ctx.fillText(Math.ceil(hp) + " / " + BOSS_HP, x + bw, y - 6);
    ctx.fillStyle = pal.subAlt; ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = alpha(pal.text, 0.35); ctx.fillRect(x, y, bw * (ghost / BOSS_HP), bh);
    ctx.shadowBlur = 12; ctx.shadowColor = pal.caret;
    ctx.fillStyle = bossHealRate(shell.time - lastOk) > 0 && shell.state === "play" ? mix(pal.main, pal.error, 0.5 + 0.5 * Math.sin(rot * 10)) : pal.main;
    ctx.fillRect(x, y, bw * (hp / BOSS_HP), bh);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = pal.text;
    for (const f of [0.66, 0.33]) ctx.fillRect(Math.round(x + bw * f), y - 3, 1, bh + 6);
    // left: live wpm (it is your damage), right: the clock toward enrage
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = font(pal, s * 0.85, 500); ctx.fillStyle = pal.sub;
    ctx.fillText("WPM", 16, y + bh + 14); ctx.textAlign = "right"; ctx.fillText("TIME", w - 16, y + bh + 14);
    ctx.font = font(pal, s * 1.6, 700);
    ctx.textAlign = "left"; ctx.fillStyle = pal.caret; ctx.fillText(String(Math.round(wpm)), 16, y + bh + 14 + s * 1.2);
    ctx.textAlign = "right"; ctx.fillStyle = shell.time > BOSS_ENRAGE * 0.7 ? pal.error : pal.text;
    ctx.fillText(shell.time.toFixed(1), w - 16, y + bh + 14 + s * 1.2);
    ctx.font = font(pal, s * 0.75, 500); ctx.fillStyle = pal.sub;
    ctx.textAlign = "left"; ctx.fillText("× " + clamp(Math.max(wpm, 20) / 100, 0.4, 2.5).toFixed(2) + " dmg", 16, y + bh + 14 + s * 3.2);
    ctx.textAlign = "right"; ctx.fillText("enrage " + BOSS_ENRAGE + "s", w - 16, y + bh + 14 + s * 3.2);
  }

  function ribbon(ctx, w, h, pal) {
    const y = ribbonY(), x0 = w * 0.22;
    ctx.fillStyle = alpha(pal.subAlt, 0.85);
    ctx.fillRect(0, y - fs * 1.35, w, fs * 2.1);
    ctx.fillStyle = pal.edge;
    ctx.fillRect(0, y - fs * 1.35, w, 1); ctx.fillRect(0, y + fs * 0.75, w, 1);
    ctx.font = font(pal, fs);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    for (let i = 0; i < stream.length; i++) {
      const wd = stream[i], x = x0 + wd.x - scroll;
      if (x > w || x + wd.w < 0) continue;
      if (i < cur) { ctx.fillStyle = alpha(pal.sub, 0.5); ctx.fillText(wd.text, x, y); continue; }
      if (i > cur) { ctx.fillStyle = pal.sub; ctx.fillText(wd.text, x, y); continue; }
      const head = typed, tail = wd.text.slice(typed.length);
      ctx.fillStyle = pal.caret; ctx.shadowBlur = 10; ctx.shadowColor = pal.caret;
      ctx.fillText(head, x, y);
      ctx.shadowBlur = 0;
      const hw = ctx.measureText(head).width;
      ctx.fillStyle = errFlash > 0 ? mix(pal.text, pal.error, errFlash) : pal.text;
      ctx.fillText(tail, x + hw, y);
      // caret
      const cw = ctx.measureText(tail[0] || " ").width;
      ctx.fillStyle = errFlash > 0 ? pal.error : pal.caret;
      if (errFlash > 0 || Math.floor(performance.now() / 500) % 2 === 0) ctx.fillRect(x + hw, y + fs * 0.22, cw, 2);
    }
    // fade the edges
    for (const [a, b] of [[0, w * 0.12], [w, w * 0.88]]) {
      const g = ctx.createLinearGradient(a, 0, b, 0);
      g.addColorStop(0, alpha(pal.subAlt, 1)); g.addColorStop(1, alpha(pal.subAlt, 0));
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(a, b), y - fs * 1.33, Math.abs(b - a), fs * 2.06);
    }
  }

  function phaseBanner(ctx, w, h, pal) {
    const a = clamp(banner * 2, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const big = clamp(w / 14, 28, 60), y = h * 0.42;
    ctx.fillStyle = alpha(pal.bg, 0.55);
    ctx.fillRect(0, y - big * 0.9, w, big * 2);
    ctx.fillStyle = pal.main;
    ctx.fillRect(0, y - big * 0.9, w, 1); ctx.fillRect(0, y + big * 1.1, w, 1);
    ctx.font = font(pal, big, 700);
    ctx.shadowBlur = 24; ctx.shadowColor = pal.caret;
    ctx.fillStyle = pal.text;
    ctx.fillText(phase === 0 ? "FIGHT" : "PHASE " + (phase + 1), w / 2, y);
    ctx.shadowBlur = 0;
    ctx.font = font(pal, clamp(w / 60, 11, 14), 500);
    ctx.fillStyle = pal.sub;
    ctx.fillText(PHASE_NAMES[phase].toUpperCase(), w / 2, y + big * 0.75);
    ctx.restore();
  }

  return game;
}

export default gameView(makeGame);
