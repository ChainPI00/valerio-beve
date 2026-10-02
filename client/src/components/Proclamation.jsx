// La proclamazione: a fine partita, prima del podio, Valerio diventa ufficialmente dottore.
// Agganciata all'orologio del server come il reveal: parte insieme su telefoni e TV.
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { Face, CrownOverlay, LAUREL } from './Face.jsx';
import { C, vibrate } from '../lib/theme.js';
import { serverNow } from '../lib/net.js';
import { sfx, atServer, music, createBus, withBus, closeBus } from '../lib/audio.js';
import { burst } from '../lib/fx.js';

export const PROCLAIM_S = 8.8;

// Tocco da laureato come immagine per i coriandoli
let capImg = null;
function cap() {
  if (capImg) return capImg;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.font = '80px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('🎓', 48, 54);
  capImg = new Image();
  capImg.src = c.toDataURL();
  return capImg;
}

export function Proclamation({ s, startsAt, tv = false, onDone }) {
  const ref = useRef(null);
  const valerio = s.players.find((p) => p.id === s.valerioId);
  const name = (s.valerioName || valerio?.name || 'Valerio').toUpperCase();
  const meta = s.library?.meta || {};
  const fin = s.final || {};
  const drinks = fin.drinks ?? s.drinks ?? 0;
  const penances = fin.penances ?? s.penances ?? 0;
  const faces = s.library?.faces || {};
  // Se c'è una foto "con l'alloro" la usiamo così com'è; altrimenti la corona si posa sulla testa
  const crownPhoto = !faces.alloro;
  const faceExpr = faces.alloro ? 'alloro' : 'felice';
  const hasPhoto = !!(faces.felice || faces.neutro);
  const faceSize = tv ? Math.min(300, innerHeight * 0.3) : Math.min(190, innerHeight * 0.21);

  useLayoutEffect(() => {
    const at = (t) => atServer(startsAt + t * 1000);
    const future = (t) => serverNow() < startsAt + t * 1000 - 40;
    const caps = [cap()];

    const bus = createBus(); // se la proclamazione viene saltata, i suoni si fermano con lei
    withBus(bus, () => {
      if (future(0)) sfx.drumroll(at(0), 1.3);
      if (future(1.3) && !crownPhoto) sfx.thud(at(1.3));
      if (crownPhoto) {
        if (future(1.1)) sfx.whoosh(at(1.1));
        if (future(1.75)) { sfx.thud(at(1.75)); sfx.crown(at(1.75)); }
      }
      for (let i = 0; i < name.length + 6; i++) if (future(2.2 + i * 0.07)) sfx.slam(at(2.2 + i * 0.07));
      if (future(3.4)) { sfx.fanfare(at(3.4)); sfx.roar(at(3.5), 3); }
      if (future(4.8)) sfx.chant(at(4.8));
    });

    music.hold('proclaim');
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, onComplete: () => onDone?.() });
      tl.fromTo('.pc-bg', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0)
        .fromTo('.pc-kicker', { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(2)' }, 0.2)
        .fromTo('.pc-seal', { scale: 0, rotate: -180 }, { scale: 1, rotate: 0, duration: 0.9, ease: 'back.out(1.4)' }, 0.3)
        .fromTo('.pc-face', { y: -700, rotate: -25 }, { y: 0, rotate: 0, duration: 0.7, ease: 'bounce.out' }, 0.5)
        // l'incoronazione: la corona cala roteando e si posa sulla testa
        .fromTo('.pc-crown', { y: -420, scale: 2.6, rotate: -40, opacity: 0 }, { y: 0, scale: 1, rotate: 0, opacity: 1, duration: 0.65, ease: 'power3.in' }, 1.1)
        .to('.pc-crown', { scaleX: 1.12, scaleY: 0.86, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: '50% 30%' }, 1.75)
        .to('.pc-face', { y: 10, duration: 0.08, yoyo: true, repeat: 1 }, 1.75)
        .call(() => {
          vibrate(90);
          const r = ref.current?.querySelector('.pc-face')?.getBoundingClientRect();
          if (r) burst({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height * 0.18) / innerHeight, count: 40, power: 0.7, colors: [LAUREL.leaf, LAUREL.leafDark, C.yellow, LAUREL.ribbon], gravity: 0.6 });
        }, null, 1.75)
        .fromTo('.pc-title .l', { scale: 3.5, opacity: 0, rotate: () => gsap.utils.random(-25, 25) }, {
          scale: 1, opacity: 1, rotate: () => gsap.utils.random(-5, 5), duration: 0.16, ease: 'power4.in', stagger: 0.07,
        }, 2.2)
        .fromTo('.pc-ribbon', { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'back.out(1.8)' }, 3.0)
        .call(() => {
          const colors = [C.yellow, C.cream, C.pink, C.cyan];
          burst({ x: 0.15, y: 1, angle: -Math.PI / 2.6, spread: 0.9, count: 60, power: 1.6, colors, images: caps, imageShare: 0.3 });
          burst({ x: 0.85, y: 1, angle: -Math.PI + Math.PI / 2.6, spread: 0.9, count: 60, power: 1.6, colors, images: caps, imageShare: 0.3 });
          vibrate([120, 60, 120, 60, 300]);
        }, null, 3.4)
        .fromTo('.pc-chant', { scale: 0, rotate: 10 }, { scale: 1, rotate: -3, duration: 0.5, ease: 'back.out(3)' }, 4.6)
        .to('.pc-chant', { scale: 1.08, duration: 0.3, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 5.1)
        .fromTo('.pc-scroll', { y: 80, opacity: 0, rotate: 4 }, { y: 0, opacity: 1, rotate: -1.5, duration: 0.6, ease: 'back.out(2)' }, 5.3)
        .to('.pc-hero-inner', { scale: 1.06, duration: 0.5, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 3.6)
        .to(ref.current, { yPercent: -110, duration: 0.6, ease: 'power3.in' }, PROCLAIM_S - 0.6);

      const elapsed = (serverNow() - startsAt) / 1000;
      if (elapsed >= PROCLAIM_S) { onDone?.(); return; }
      if (elapsed <= 0) {
        const id = setTimeout(() => tl.play(), -elapsed * 1000);
        return () => clearTimeout(id);
      }
      tl.seek(elapsed, true).play();
    }, ref);
    return () => { ctx.revert(); closeBus(bus); music.release('proclaim'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt]);

  let li = 0;
  return (
    <div className={`proclaim ${tv ? 'is-tv' : ''}`} ref={ref} onClick={() => onDone?.()}>
      <div className="pc-bg" />
      <p className="pc-kicker">SI PROCLAMA</p>
      <div className="pc-hero">
        <div className="pc-seal" aria-hidden>
          <svg viewBox="-100 -100 200 200">
            {Array.from({ length: 24 }, (_, i) => (
              <path key={i} d="M0 -96 L9 -60 L-9 -60 Z" fill={i % 2 ? C.pink : C.yellow} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" transform={`rotate(${i * 15})`} />
            ))}
            <circle r="64" fill={C.yellow} stroke={C.ink} strokeWidth="5" />
            <circle r="54" fill="none" stroke={C.ink} strokeWidth="2.5" strokeDasharray="5 6" />
          </svg>
        </div>
        <div className="pc-hero-inner">
          <div className="pc-face" style={{ width: faceSize, height: faceSize * 1.1 }}>
            <Face expr={faceExpr} size={faceSize} />
            {crownPhoto && (
              <div className="pc-crown">
                <CrownOverlay photo={hasPhoto} />
              </div>
            )}
          </div>
        </div>
      </div>
      <h1 className="pc-title">
        {['DOTTOR', name].map((w) => (
          <span key={w} className="pc-word">
            {[...w].map((ch) => <span key={li++} className="l">{ch === ' ' ? ' ' : ch}</span>)}
          </span>
        ))}
      </h1>
      <div className="pc-ribbon">
        <span>{meta.course || 'Laurea'}</span>
        {meta.university && <small>{meta.university}</small>}
      </div>
      <div className="pc-chant">👏 DOTTORE! DOTTORE!</div>
      <p className="pc-scroll">
        con <b>{drinks}</b> {drinks === 1 ? 'bevuta' : 'bevute'} e <b>{penances}</b> {penances === 1 ? 'penitenza' : 'penitenze'} a verbale
      </p>
    </div>
  );
}
