// Coriandoli su canvas (non DOM), max ~150 particelle, con facce di Valerio come forme custom.
import { C, motion, reducedMotion } from './theme.js';

const MAX = reducedMotion ? 60 : 150;
let canvas, g, dpr, particles = [], raf = 0, lastT = 0;
const imgCache = new Map();

function ensure() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.appendChild(canvas);
  g = canvas.getContext('2d');
  const size = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  size();
  addEventListener('resize', size);
}

export function loadImage(src) {
  if (!src) return null;
  if (imgCache.has(src)) return imgCache.get(src);
  const im = new Image();
  im.decoding = 'async';
  im.src = src;
  imgCache.set(src, im);
  return im;
}

const DEFAULT_COLORS = [C.pink, C.yellow, C.cyan, C.orange, C.cream];

// origin in frazioni dello schermo; images = array di Image (facce)
export function burst({ x = 0.5, y = 0.5, count = 80, power = 1, spread = Math.PI * 2, angle = -Math.PI / 2, colors = DEFAULT_COLORS, images = [], imageShare = 0.15, gravity = 1 } = {}) {
  ensure();
  count = Math.round(count * (reducedMotion ? 0.4 : 1));
  const W = innerWidth, H = innerHeight;
  const room = Math.max(0, MAX - particles.length);
  if (room < count) particles.splice(0, count - room);
  const usable = images.filter((im) => im && im.complete && im.naturalWidth);
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = (6 + Math.random() * 12) * power * Math.min(1.6, Math.max(W, H) / 700);
    const isImg = usable.length && Math.random() < imageShare;
    particles.push({
      x: x * W, y: y * H,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: isImg ? 44 + Math.random() * 26 : 8 + Math.random() * 10,
      h: isImg ? 0 : 5 + Math.random() * 8,
      tilt: Math.random() * 10, vt: 0.05 + Math.random() * 0.1,
      color: colors[(Math.random() * colors.length) | 0],
      shape: isImg ? 'img' : Math.random() < 0.25 ? 'circle' : 'rect',
      img: isImg ? usable[(Math.random() * usable.length) | 0] : null,
      life: 0, max: 160 + Math.random() * 80, gravity,
    });
  }
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
}

// Fisica a tempo reale (non a frame): stessa velocità su schermi a 60 e a 120 Hz
function tick(now) {
  const k = Math.min(3, Math.max(0.25, (now - lastT) / 16.67));
  lastT = now;
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  particles = particles.filter((p) => p.life < p.max && p.y < innerHeight + 120);
  for (const p of particles) {
    p.life += k;
    p.vy += 0.32 * p.gravity * k;
    const drag = Math.pow(0.975, k);
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.r += p.vr * k;
    p.tilt += p.vt * k;
    const fade = Math.min(1, (p.max - p.life) / 30);
    g.globalAlpha = fade;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.r);
    if (p.shape === 'img') {
      const s = p.w;
      const ratio = p.img.naturalHeight / p.img.naturalWidth || 1;
      g.drawImage(p.img, -s / 2, (-s * ratio) / 2, s, s * ratio);
    } else {
      g.fillStyle = p.color;
      g.strokeStyle = C.ink;
      g.lineWidth = 2;
      const sy = Math.abs(Math.cos(p.tilt));
      if (p.shape === 'circle') {
        g.beginPath();
        g.ellipse(0, 0, p.w / 2, (p.w / 2) * sy + 0.5, 0, 0, Math.PI * 2);
        g.fill(); g.stroke();
      } else {
        g.fillRect(-p.w / 2, (-p.h / 2) * sy, p.w, p.h * sy);
        g.strokeRect(-p.w / 2, (-p.h / 2) * sy, p.w, p.h * sy);
      }
    }
    g.restore();
  }
  g.globalAlpha = 1;
  if (particles.length) raf = requestAnimationFrame(tick);
  else { raf = 0; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); }
}

export function clearConfetti() { particles = []; }

// Screen shake a intensità decrescente, solo transform
export function shake(el, { intensity = 14, duration = 1.5 } = {}) {
  if (!el) return;
  const amp = intensity * motion;
  const start = performance.now();
  const step = (t) => {
    const p = (t - start) / (duration * 1000);
    if (p >= 1) { el.style.transform = ''; return; }
    const k = amp * (1 - p) * (1 - p);
    el.style.transform = `translate3d(${(Math.random() - 0.5) * 2 * k}px, ${(Math.random() - 0.5) * 2 * k}px, 0) rotate(${(Math.random() - 0.5) * k * 0.12}deg)`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Schermo sempre acceso durante la partita
let lock = null;
let asking = false;
export async function keepAwake() {
  if (lock || asking || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  asking = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch {} finally { asking = false; }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  // Safari concede il wake lock solo dentro un gesto: ci riproviamo a ogni tocco
  for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => keepAwake(), { passive: true, capture: true });
}

// Immagini scalate e (se senza trasparenza) ritagliate a sticker prima dell'upload
export async function prepareImage(file, { max = 640, sticker = false } = {}) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.drawImage(bmp, 0, 0, w, h);
  if (sticker && !hasTransparency(cx, w, h)) {
    // Foto con sfondo: la ritagliamo a blob, così resta uno sticker e non un rettangolo
    const s = Math.min(w, h);
    const out = document.createElement('canvas');
    out.width = s; out.height = s;
    const o = out.getContext('2d');
    o.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = s * 0.47 * (1 + 0.035 * Math.sin(i * 2.3));
      const px = s / 2 + Math.cos(a) * rr, py = s / 2 + Math.sin(a) * rr;
      if (i === 0) o.moveTo(px, py);
      else {
        const pa = ((i - 0.5) / n) * Math.PI * 2;
        o.quadraticCurveTo(s / 2 + Math.cos(pa) * rr * 1.06, s / 2 + Math.sin(pa) * rr * 1.06, px, py);
      }
    }
    o.closePath();
    o.clip();
    o.drawImage(cv, (w - s) / 2, (h - s) / 2, s, s, 0, 0, s, s);
    return new Promise((r) => out.toBlob(r, 'image/png'));
  }
  return new Promise((r) => cv.toBlob(r, sticker ? 'image/png' : 'image/webp', 0.85));
}
function hasTransparency(cx, w, h) {
  const pts = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2], [w / 2, 1]];
  return pts.some(([x, y]) => cx.getImageData(x | 0, y | 0, 1, 1).data[3] < 200);
}
