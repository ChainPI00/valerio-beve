// Tutti i suoni sono sintetizzati con Web Audio: zero file, zero licenze, precaricati per definizione.
// Ogni funzione accetta `when` (secondi sul clock audio), così i suoni partono sullo stesso istante
// su tutti i dispositivi, agganciati all'orologio del server.
import { serverNow } from './net.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let reverb = null;
let big = false; // schermo grande: più volume e versioni più lunghe
const MUTE_KEY = 'vb:muted';
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
const listeners = new Set();

export const isMuted = () => muted;
export function onMuteChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : vol(), ctx.currentTime, 0.02);
  listeners.forEach((l) => l(m));
  updateMusicGain();
}
const vol = () => (big ? 1 : 0.8);
export function setBigScreen(b) { big = b; if (master && !muted) master.gain.value = vol(); updateMusicGain(); }

// Da chiamare dentro un gesto dell'utente (tap su "Entra"): i browser mobile bloccano l'audio fino ad allora.
export function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // iOS: suona anche col silenzioso
  } catch {}
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // riverbero finto: rumore che decade
    reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(master);
    setupMusic();
    // Safari mette il contesto in "interrupted" (schermo bloccato, notifiche, chiamate): proviamo a riprenderlo
    ctx.onstatechange = () => {
      if (ctx.state !== 'running' && document.visibilityState === 'visible') setTimeout(tryResume, 300);
    };
  }
  tryResume();
}
function tryResume() {
  // 'suspended' e 'interrupted' (Safari) vanno entrambi ripresi
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
}
export const audioReady = () => !!ctx && ctx.state === 'running';
export const audioStarted = () => !!ctx;
if (typeof window !== 'undefined') {
  // l'audio riparte al primo tocco, ovunque. Safari conta come gesto touchend/click, non pointerdown.
  const kick = () => { if (!ctx || ctx.state !== 'running') unlockAudio(); };
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, kick, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tryResume(); });
  window.addEventListener('pageshow', tryResume);
  window.addEventListener('focus', tryResume);
}

// Tempo audio che corrisponde a un istante del server (ms)
export function atServer(ms) {
  if (!ctx) return 0;
  return ctx.currentTime + (ms - serverNow()) / 1000;
}
const now = () => (ctx ? ctx.currentTime : 0);
const T = (when) => Math.max(now(), when ?? now());

// ---------- mattoncini ----------
function env(gainNode, t, a, peak, d, sustain = 0.0001) {
  const g = gainNode.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + a);
  g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
}
function osc(type, freq, t, dur, { gain = 0.3, a = 0.005, out = master, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  env(g, t, a, gain, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + dur + 0.05);
  return o;
}
function noise(t, dur, { gain = 0.3, type = 'bandpass', freq = 1000, q = 1, a = 0.003, out = master } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, a, gain, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + a + dur + 0.05);
  return { src: s, filter: f, gain: g };
}
const ok = () => ctx && !muted;

// ---------- suoni ----------
export const sfx = {
  // "Pop" di ingresso in lobby, tono diverso per ognuno
  pop(seed = 0, when) {
    if (!ok()) return;
    const t = T(when);
    const f = 420 * Math.pow(2, ((seed * 5) % 12) / 12);
    const o = osc('sine', f * 2, t, 0.12, { gain: 0.5 });
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.1);
    noise(t, 0.02, { gain: 0.15, freq: 3000 });
  },
  click(when) {
    if (!ok()) return;
    const t = T(when);
    osc('triangle', 1100, t, 0.03, { gain: 0.25 });
  },
  boing(when) {
    if (!ok()) return;
    const t = T(when);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.06);
    lfo.frequency.value = 18;
    lg.gain.setValueAtTime(90, t);
    lg.gain.exponentialRampToValueAtTime(1, t + 0.4);
    lfo.connect(lg).connect(o.frequency);
    env(g, t, 0.005, 0.45, 0.4);
    o.connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + 0.5); lfo.stop(t + 0.5);
  },
  tick(hi = true, when) {
    if (!ok()) return;
    const t = T(when);
    osc('square', hi ? 1900 : 1400, t, 0.025, { gain: 0.12 });
    noise(t, 0.015, { gain: 0.12, freq: hi ? 5000 : 3500, q: 4 });
  },
  whoosh(when) {
    if (!ok()) return;
    const t = T(when);
    const n = noise(t, 0.35, { gain: 0.18, freq: 400, q: 0.8, a: 0.12 });
    n.filter.frequency.exponentialRampToValueAtTime(3500, t + 0.35);
  },
  slam(when) {
    if (!ok()) return;
    const t = T(when);
    const o = osc('sine', 150, t, 0.25, { gain: 0.8 });
    o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    noise(t, 0.08, { gain: 0.35, freq: 1800, q: 0.7 });
  },
  // Rullo di tamburi crescente
  drumroll(when, dur = 5) {
    if (!ok()) return;
    const t0 = T(when);
    let t = t0;
    const end = t0 + dur;
    while (t < end) {
      const p = (t - t0) / dur;
      noise(t, 0.05, { gain: 0.08 + 0.4 * p * p, freq: 1600 + 800 * p, q: 0.9 });
      t += 0.075 - 0.045 * p;
    }
  },
  thud(when) {
    if (!ok()) return;
    const t = T(when);
    const o = osc('sine', 110, t, 0.5, { gain: 1 });
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    noise(t, 0.4, { gain: 0.5, type: 'highpass', freq: 5000, q: 0.5, out: reverb }); // piatto
  },
  // Sirena + clacson da stadio + boato
  // Sirena della polizia (usata quando Valerio perde, prima della roulette)
  siren(when, dur = big ? 4 : 2.6, level = 0.16) {
    if (!ok()) return;
    const t = T(when);
    for (const det of [0, 7]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 850;
      o.detune.value = det;
      lfo.type = 'triangle';
      lfo.frequency.value = 1.6;
      lg.gain.value = 320;
      lfo.connect(lg).connect(o.frequency);
      f.type = 'lowpass';
      f.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.08);
      g.gain.setValueAtTime(level, t + dur - 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    }
  },
  roar(when, dur = big ? 3.5 : 2.4) {
    if (!ok()) return;
    const t = T(when);
    const n = noise(t, dur, { gain: 0.45, freq: 700, q: 0.4, a: 0.35 });
    n.filter.frequency.linearRampToValueAtTime(1100, t + 1);
  },
  // Valerio beve: clacson da stadio + sirena + boato
  drink(when) {
    if (!ok()) return;
    const t = T(when);
    sfx.siren(t, big ? 3 : 2);
    const horn = (start, len) => {
      for (const fr of [233, 294, 349, 466]) {
        const o = osc('sawtooth', fr, start, len, { gain: 0.1, a: 0.015, detune: Math.random() * 12 - 6 });
        o.frequency.setValueAtTime(fr * 0.97, start);
        o.frequency.linearRampToValueAtTime(fr, start + 0.05);
      }
    };
    horn(t, 0.22);
    horn(t + 0.32, 0.9);
    if (big) horn(t + 1.5, 1.2);
    sfx.roar(t + 0.1);
  },
  // Penitenza: "dun dun duuun" drammatico + boato
  penance(when) {
    if (!ok()) return;
    const t = T(when);
    const notes = [[196, 0, 0.18], [196, 0.26, 0.18], [155.6, 0.55, 1.5]];
    for (const [f, off, len] of notes) {
      for (const [m, g] of [[1, 0.13], [1.5, 0.06], [0.5, 0.1], [2, 0.04]]) {
        const o = osc('sawtooth', f * m, t + off, len, { gain: g, a: 0.02, detune: Math.random() * 10 - 5 });
        if (len > 1) {
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          lfo.frequency.value = 5.5;
          lg.gain.value = 4 * m;
          lfo.connect(lg).connect(o.frequency);
          lfo.start(t + off + 0.3); lfo.stop(t + off + len + 0.1);
        }
      }
    }
    noise(t + 0.55, 1.4, { gain: 0.35, type: 'highpass', freq: 3000, out: reverb });
    sfx.roar(t + 0.6, big ? 3 : 2);
  },
  // Coro angelico breve
  saved(when) {
    if (!ok()) return;
    const t = T(when);
    const len = big ? 2.8 : 1.9;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      for (const type of ['sine', 'triangle']) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = (i % 2 ? 6 : -6) + (type === 'sine' ? 0 : 4);
        lfo.frequency.value = 5 + i * 0.3;
        lg.gain.value = 6;
        lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(type === 'sine' ? 0.09 : 0.04, t + 0.35 + i * 0.05);
        g.gain.setValueAtTime(type === 'sine' ? 0.09 : 0.04, t + len - 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g);
        g.connect(master);
        g.connect(reverb);
        o.start(t); lfo.start(t);
        o.stop(t + len + 0.1); lfo.stop(t + len + 0.1);
      }
    });
  },
  chaching(when) {
    if (!ok()) return;
    const t = T(when);
    noise(t, 0.08, { gain: 0.3, type: 'highpass', freq: 4000 });
    osc('sine', 1318.5, t + 0.08, 0.5, { gain: 0.25 });
    osc('sine', 1760, t + 0.16, 0.7, { gain: 0.25 });
    osc('sine', 2637, t + 0.16, 0.4, { gain: 0.08, out: reverb });
  },
  // Trombone triste: wah wah wah wahhh
  sad(when) {
    if (!ok()) return;
    const t = T(when);
    const notes = [[196, 0, 0.32], [185, 0.38, 0.32], [174.6, 0.76, 0.32], [164.8, 1.14, 1.0]];
    for (const [f, off, len] of notes) {
      const o = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      filt.type = 'lowpass';
      filt.Q.value = 6;
      filt.frequency.setValueAtTime(300, t + off);
      filt.frequency.linearRampToValueAtTime(1300, t + off + 0.12);
      filt.frequency.linearRampToValueAtTime(500, t + off + len);
      if (len > 0.5) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 6;
        lg.gain.value = 5;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t + off); lfo.stop(t + off + len + 0.1);
      }
      env(g, t + off, 0.03, 0.22, len);
      o.connect(filt).connect(g).connect(master);
      o.start(t + off);
      o.stop(t + off + len + 0.1);
    }
  },
  // Incoronazione: arpeggio di campanelle
  crown(when) {
    if (!ok()) return;
    const t = T(when);
    [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => {
      osc('sine', f, t + i * 0.07, 0.9, { gain: 0.14 });
      osc('sine', f * 2.01, t + i * 0.07, 0.4, { gain: 0.04, out: reverb });
    });
  },
  clap(when) {
    if (!ok()) return;
    const t = T(when);
    for (let i = 0; i < 3; i++) noise(t + i * 0.008 + Math.random() * 0.006, 0.07, { gain: 0.35, freq: 1400 + i * 300, q: 0.8 });
  },
  // Battimani da stadio: "DOT-TO-RE! DOT-TO-RE!"
  chant(when, reps = big ? 4 : 3) {
    if (!ok()) return;
    const t0 = T(when);
    for (let r = 0; r < reps; r++) {
      [0, 0.28, 0.56].forEach((o) => sfx.clap(t0 + r * 1.2 + o));
    }
  },
  fanfare(when) {
    if (!ok()) return;
    const t = T(when);
    const seq = [[523, 0, 0.12], [523, 0.15, 0.12], [523, 0.3, 0.12], [659, 0.45, 0.35], [587, 0.85, 0.12], [659, 1.0, 0.12], [784, 1.15, 1.2]];
    const extra = big ? [[1046, 2.5, 1.5]] : [];
    for (const [f, off, len] of [...seq, ...extra]) {
      for (const [m, g] of [[1, 0.12], [1.5, 0.05], [0.5, 0.08]]) {
        const o = osc('sawtooth', f * m, t + off, len, { gain: g, a: 0.02 });
        o.detune.value = Math.random() * 8 - 4;
      }
    }
    noise(t + 1.15, 1.2, { gain: 0.2, type: 'highpass', freq: 6000, out: reverb });
  },
};

// =====================================================================
// Musica di sottofondo: loop pop morbido in Fa maggiore, 100 bpm, 8 battute.
// È agganciata alla griglia dell'orologio del server: tutti i telefoni suonano
// la stessa nota nello stesso istante. Si abbassa da sola durante reveal e proclamazione.
// =====================================================================
const STEP_MS = 150; // sedicesimi a 100 bpm
const MUSIC_KEY = 'vb:music';
let musicOn = (() => { try { return localStorage.getItem(MUSIC_KEY) !== '0'; } catch { return true; } })();
let musicGain = null;
let musicTimer = null;
let lastStep = -1;
const holds = new Set();
const musicListeners = new Set();

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
//            F           Am          Bb          C           F           Dm          Gm          C
const CHORDS = [[57, 60, 65], [57, 60, 64], [58, 62, 65], [55, 60, 64], [57, 60, 65], [57, 62, 65], [55, 58, 62], [55, 60, 64]];
const BASS = [41, 45, 46, 36, 41, 38, 43, 36];
const MELODY = [
  [81, 0, 79, 77, 0, 72, 0, 0], [72, 76, 0, 81, 0, 79, 0, 0], [77, 0, 74, 77, 79, 0, 77, 0], [79, 0, 0, 76, 72, 0, 0, 0],
  [81, 0, 84, 81, 79, 0, 77, 0], [74, 0, 77, 0, 81, 79, 77, 0], [79, 0, 82, 79, 77, 0, 74, 0], [76, 0, 79, 0, 72, 0, 0, 0],
];
const KEYS_HITS = { 0: 1.1, 3: 0.28, 6: 0.3, 8: 1.0, 11: 0.28, 14: 0.3 };

function setupMusic() {
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);
  const send = ctx.createGain();
  send.gain.value = 0.5;
  musicGain.connect(send).connect(reverb);
  updateMusicGain();
  clearInterval(musicTimer);
  musicTimer = setInterval(scheduleMusic, 60);
}

const musicLevel = () => (big ? 0.9 : 0.6);
function updateMusicGain() {
  if (!musicGain) return;
  const target = musicOn && !muted && holds.size === 0 ? musicLevel() : 0;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setTargetAtTime(target, ctx.currentTime, target > 0 ? 0.6 : 0.12);
}

function scheduleMusic() {
  if (!ctx || ctx.state !== 'running' || !musicOn || muted || holds.size) { lastStep = -1; return; }
  const now = serverNow();
  const from = Math.max(lastStep + 1, Math.ceil(now / STEP_MS));
  const to = Math.floor((now + 260) / STEP_MS);
  for (let n = from; n <= to; n++) playStep(n, atServer(n * STEP_MS));
  lastStep = Math.max(lastStep, to);
}

function mNote(type, freq, t, dur, gain, a = 0.008) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  env(g, t, a, gain, dur);
  o.connect(g).connect(musicGain);
  o.start(t);
  o.stop(t + a + dur + 0.05);
  return o;
}
function mNoise(t, dur, gain, type, freq, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.002, gain, dur);
  src.connect(f).connect(g).connect(musicGain);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function playStep(n, t) {
  if (t < ctx.currentTime - 0.01) return;
  const step = ((n % 16) + 16) % 16;
  const bar = Math.floor(n / 16);
  const b = ((bar % 8) + 8) % 8;
  const cycle = Math.floor(bar / 8);
  // pianoforte elettrico: accordi sincopati
  const len = KEYS_HITS[step];
  if (len) {
    for (const m of CHORDS[b]) {
      mNote('sine', hz(m), t, len, 0.045);
      mNote('triangle', hz(m + 12), t, len * 0.5, 0.012);
    }
  }
  // basso
  if (step === 0 || step === 7 || step === 10) mNote('triangle', hz(BASS[b] + (step === 7 ? 12 : 0)), t, 0.28, 0.14, 0.01);
  if (step === 0) mNote('sine', hz(BASS[b] - 12), t, 0.4, 0.12, 0.01);
  // cassa morbida
  if (step === 0 || step === 8 || (step === 10 && b % 2)) {
    const o = mNote('sine', 95, t, 0.22, 0.2, 0.004);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  }
  // schiocco e shaker
  if (step === 4 || step === 12) mNoise(t, 0.07, 0.06, 'bandpass', 1900, 0.9);
  if (step % 4 === 2) mNoise(t, 0.045, 0.028, 'highpass', 7000);
  else if (step % 2 === 1) mNoise(t, 0.03, 0.012, 'highpass', 8000);
  // melodia a campanelle (2 giri su 3)
  if (cycle % 3 !== 2 && step % 2 === 0) {
    const m = MELODY[b][step / 2];
    if (m) {
      mNote('sine', hz(m), t, 0.55, 0.05, 0.004);
      mNote('sine', hz(m) * 2.01, t, 0.25, 0.012, 0.004);
    }
  }
}

export const music = {
  isOn: () => musicOn,
  setOn(on) {
    musicOn = on;
    try { localStorage.setItem(MUSIC_KEY, on ? '1' : '0'); } catch {}
    updateMusicGain();
    musicListeners.forEach((l) => l(on));
  },
  onChange(fn) { musicListeners.add(fn); return () => musicListeners.delete(fn); },
  // reveal e proclamazione "tengono" giù la musica finché sono a schermo
  hold(id) { holds.add(id); updateMusicGain(); },
  release(id) { holds.delete(id); updateMusicGain(); },
};
