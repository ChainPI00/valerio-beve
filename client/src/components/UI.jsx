import { useEffect, useLayoutEffect, useRef, useState, Fragment } from 'react';
import gsap from 'gsap';
import { C, vibrate, motion } from '../lib/theme.js';
import { serverNow } from '../lib/net.js';
import { sfx, isMuted, setMuted, onMuteChange, unlockAudio } from '../lib/audio.js';

// ---------- Sfondo mai fermo ----------
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'><g fill='none' stroke='#3D1A78' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'><path d='M20 40 q15 -20 30 0 t30 0'/><path d='M150 30 l8 18 20 2 -15 13 5 20 -18 -11 -18 11 5 -20 -15 -13 20 -2z'/><circle cx='60' cy='150' r='16'/><path d='M140 150 q15 -20 30 0 t30 0'/><path d='M95 95 l14 14 m0 -14 l-14 14'/></g><g fill='#3D1A78'><circle cx='200' cy='110' r='6'/><circle cx='110' cy='200' r='6'/><circle cx='20' cy='100' r='5'/></g></svg>`)}")`;
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`)}")`;

export function Background({ accent = C.pink, accent2 = C.cyan }) {
  return (
    <div className="bg" aria-hidden>
      <div className="bg-pattern" style={{ backgroundImage: PATTERN }} />
      <div className="bg-blob bg-blob-a" style={{ background: accent }} />
      <div className="bg-blob bg-blob-b" style={{ background: accent2 }} />
      <div className="bg-blob bg-blob-c" />
      <div className="bg-grain" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}
export const grainStyle = { backgroundImage: GRAIN };

// ---------- Transizione a blob tra le fasi (mai un fade) ----------
const WIPE_PATH = 'M50 2 C78 0 100 22 98 50 C96 80 76 100 48 98 C18 96 0 76 2 48 C4 20 24 4 50 2 Z';

export function Stage({ viewKey, color = C.pink, children }) {
  const [shownKey, setShownKey] = useState(viewKey);
  const last = useRef(children);
  const blob = useRef(null);
  const busy = useRef(false);
  const [bumped, bump] = useState(0);
  if (shownKey === viewKey) last.current = children;

  useEffect(() => {
    if (viewKey === shownKey || busy.current) return;
    busy.current = true;
    const el = blob.current;
    const fromLeft = Math.random() < 0.5;
    sfx.whoosh();
    const tl = gsap.timeline({ onComplete: () => { busy.current = false; bump((n) => n + 1); } });
    gsap.set(el, { display: 'block', fill: color, xPercent: -50, yPercent: -50, left: fromLeft ? '0%' : '100%', top: '100%', scale: 0, rotate: fromLeft ? -30 : 30 });
    tl.to(el, { scale: 1, rotate: 0, left: '50%', top: '50%', duration: 0.36 * Math.max(0.6, motion), ease: 'power3.in' })
      .add(() => setShownKey(viewKey))
      .to(el, { scale: 0, left: fromLeft ? '100%' : '0%', top: '0%', rotate: fromLeft ? 30 : -30, duration: 0.42 * Math.max(0.6, motion), ease: 'power3.out', delay: 0.04 })
      .set(el, { display: 'none' });
  }, [viewKey, shownKey, color, bumped]);

  return (
    <>
      <Fragment key={shownKey}>{shownKey === viewKey ? children : last.current}</Fragment>
      <svg className="wipe" ref={blob} viewBox="0 0 100 100" aria-hidden>
        <path d={WIPE_PATH} stroke={C.ink} strokeWidth="1.2" />
      </svg>
    </>
  );
}

// ---------- Testo che riempie lo spazio ----------
export function FitText({ children, max = 64, min = 20, className = '', style }) {
  const box = useRef(null);
  const inner = useRef(null);
  useLayoutEffect(() => {
    const b = box.current, t = inner.current;
    if (!b || !t) return;
    const fit = () => {
      let lo = min, hi = max;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        t.style.fontSize = `${mid}px`;
        if (t.scrollHeight <= b.clientHeight && t.scrollWidth <= b.clientWidth) lo = mid;
        else hi = mid;
      }
      t.style.fontSize = `${Math.floor(lo)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [children, max, min]);
  return (
    <div ref={box} className={`fit ${className}`} style={style}>
      <div ref={inner} className="fit-inner">{children}</div>
    </div>
  );
}

// "*parola*" → parola chiave colorata
export function Rich({ text, kw = 'kw' }) {
  const parts = String(text || '').split(/(\*[^*]+\*)/g);
  return parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <em key={i} className={kw}>{p.slice(1, -1)}</em> : <Fragment key={i}>{p}</Fragment>));
}
export const plain = (t) => String(t || '').replace(/\*/g, '');

// ---------- Bottoni ----------
export function Btn({ children, color = C.yellow, className = '', onClick, disabled, sound = 'click', big, ...rest }) {
  return (
    <button
      className={`btn ${big ? 'btn-big' : ''} ${className}`}
      style={{ '--c': color }}
      disabled={disabled}
      onPointerDown={() => { unlockAudio(); vibrate(12); }}
      onClick={(e) => { if (sound) sfx[sound]?.(); onClick?.(e); }}
      {...rest}
    >
      <span>{children}</span>
    </button>
  );
}

export function MuteToggle() {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMuteChange(setM), []);
  return (
    <button className="mute" onClick={() => { unlockAudio(); setMuted(!m); }} aria-label={m ? 'Attiva audio' : 'Silenzia'}>
      {m ? (
        <svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 9l5 6M21 9l-5 6" /></svg>
      ) : (
        <svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 8.5c1.5 1.8 1.5 5.2 0 7M18.5 6c3 3.3 3 8.7 0 12" /></svg>
      )}
    </button>
  );
}

// ---------- Countdown circolare deciso dal server ----------
export function Countdown({ endsAt, total = 25000, paused, pausedRemaining, size = 84, sound = true }) {
  const ring = useRef(null);
  const label = useRef(null);
  const wrap = useRef(null);
  useEffect(() => {
    let raf;
    let nextTick = 0;
    let hi = true;
    const loop = () => {
      const left = paused ? pausedRemaining ?? 0 : Math.max(0, (endsAt ?? 0) - serverNow());
      const frac = left / Math.max(1, total);
      const secs = paused ? '❚❚' : String(Math.ceil(left / 1000));
      if (ring.current) ring.current.style.strokeDashoffset = String(283 * (1 - Math.max(0, Math.min(1, frac))));
      if (label.current && label.current.textContent !== secs) label.current.textContent = secs;
      const urgent = left <= 5000 && left > 0 && !paused;
      wrap.current?.classList.toggle('is-urgent', urgent);
      if (urgent && sound) {
        // tic-tac che accelera
        const now = performance.now();
        if (now >= nextTick) {
          sfx.tick(hi);
          hi = !hi;
          nextTick = now + Math.max(180, (left / 5000) * 700);
        }
      }
      if (!paused) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [endsAt, total, paused, pausedRemaining, sound]);
  return (
    <div className="countdown" ref={wrap} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" className="cd-bg" />
        <circle cx="50" cy="50" r="45" className="cd-ring" ref={ring} strokeDasharray="283" transform="rotate(-90 50 50)" />
      </svg>
      <span ref={label} className="cd-num" />
    </div>
  );
}

// Lettere che entrano una alla volta (per i titoli-sticker)
export function Letters({ text, className = '' }) {
  return (
    <span className={`letters ${className}`} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="l" aria-hidden style={{ '--i': i }}>{ch === ' ' ? ' ' : ch}</span>
      ))}
    </span>
  );
}

// Entrata coreografata: figli diretti sfalsati 70ms, con overshoot
export function useStagger(deps = [], selector = ':scope > .st') {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll(selector);
    const ctx = gsap.context(() => {
      gsap.from(items, { y: 40 * motion, scale: 0.85, opacity: 0, duration: 0.55, ease: 'back.out(2.2)', stagger: 0.07 });
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
