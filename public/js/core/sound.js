// Synthesized key sounds (WebAudio, no audio files). Listens for bus 'key' events ({ok, key}) emitted
// by the typing surface; also exposes play() for games. Lazily creates the AudioContext on the first
// real keystroke, which is a user gesture, so autoplay policies never block it.
import { on } from "./bus.js";
import settings from "./settings.js";

export const KINDS = ["off", "soft", "typewriter", "thock"];

let ctx = null;
function audioCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

let noiseBuf = null;
function noiseBuffer(c) {
  if (noiseBuf && noiseBuf.ctx === c) return noiseBuf.buf;
  const buf = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = { ctx: c, buf };
  return buf;
}

function gainEnv(c, t0, peak, decay, delay = 0) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + delay + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + decay);
  return g;
}

function noiseBurst(c, t0, { peak, decay, delay = 0, freq = 3000, q = 1, type = "bandpass" }) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = gainEnv(c, t0, peak, decay, delay);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t0 + delay);
  src.stop(t0 + delay + decay + 0.05);
}

function tone(c, t0, { freq, peak, decay, delay = 0, type = "sine", freqEnd }) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0 + delay);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + delay + decay);
  const g = gainEnv(c, t0, peak, decay, delay);
  osc.connect(g).connect(c.destination);
  osc.start(t0 + delay);
  osc.stop(t0 + delay + decay + 0.05);
}

function clickSound(c, style, vol) {
  const t0 = c.currentTime;
  if (style === "soft") {
    noiseBurst(c, t0, { peak: 0.18 * vol, decay: 0.03, freq: 4200, q: 0.8 });
  } else if (style === "typewriter") {
    noiseBurst(c, t0, { peak: 0.22 * vol, decay: 0.02, freq: 5200, q: 2 });
    tone(c, t0, { freq: 180, peak: 0.16 * vol, decay: 0.05, delay: 0.008, type: "square" });
  } else if (style === "thock") {
    tone(c, t0, { freq: 130, freqEnd: 90, peak: 0.28 * vol, decay: 0.09, type: "triangle" });
    noiseBurst(c, t0, { peak: 0.08 * vol, decay: 0.015, freq: 1800, q: 1 });
  }
}

function errorSound(c, vol) {
  const t0 = c.currentTime;
  tone(c, t0, { freq: 220, freqEnd: 110, peak: 0.22 * vol, decay: 0.14, type: "sawtooth" });
}

// kind: 'key' (uses the chosen click style) or 'error' (uses the separate error toggle).
export function play(kind) {
  const style = settings.get("sound") || "off";
  const vol = settings.get("volume");
  const v = vol == null ? 0.5 : Math.max(0, Math.min(1, Number(vol)));
  if (kind === "error") {
    const enabled = settings.get("errorSound");
    if (enabled === false) return;
    const c = audioCtx();
    if (c) errorSound(c, v);
    return;
  }
  if (style === "off") return;
  const c = audioCtx();
  if (c) clickSound(c, style, v);
}

on("key", (d) => play(d && d.ok === false ? "error" : "key"));

export const sound = { KINDS, play };
export default sound;
