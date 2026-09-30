// Valerio, la mascotte. Se l'host ha caricato le foto usa quelle (come sticker),
// altrimenti un Valerio cartoon disegnato in SVG con la stessa espressione.
import { useEffect, useRef, useState, forwardRef } from 'react';
import { useStore } from '../lib/net.js';
import { C } from '../lib/theme.js';

const SKIN = '#F7C29B';
const INK = C.ink;

export function faceUrl(faces, expr) {
  if (!faces) return null;
  return faces[expr] || faces.neutro || null;
}

export const Face = forwardRef(function Face(
  { expr = 'neutro', size = 160, track = false, sweat = false, shades = false, className = '', style, tilt = 0 },
  ref,
) {
  const faces = useStore((s) => s.state?.library?.faces);
  const photo = faces?.[expr] || faces?.neutro;
  const photoIsExact = !!faces?.[expr];
  const needsWreath = expr === 'alloro' && !photoIsExact;

  return (
    <div
      ref={ref}
      className={`face ${className}`}
      style={{ width: size, height: size * 1.1, ...style, '--tilt': `${tilt}deg` }}
    >
      {photo ? (
        <div className="face-photo-wrap">
          <img className="face-photo" src={photo} alt="Valerio" draggable={false} />
          {needsWreath && <Wreath className="face-wreath" />}
          {sweat && <Sweat className="face-sweat-photo" />}
        </div>
      ) : (
        <CartoonFace expr={expr} track={track} sweat={sweat} />
      )}
      {shades && <Shades className="face-shades" style={{ top: photo ? '34%' : '47%' }} />}
    </div>
  );
});

function useLook(enabled, ref) {
  const [look, setLook] = useState([0, 0]);
  useEffect(() => {
    if (!enabled) return;
    const move = (e) => {
      const el = ref.current;
      if (!el) return;
      const b = el.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - (b.left + b.width / 2);
      const dy = p.clientY - (b.top + b.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 200);
      setLook([(dx / d) * 6 * k, (dy / d) * 6 * k]);
    };
    const reset = () => setTimeout(() => setLook([0, 0]), 900);
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', move, { passive: true });
    addEventListener('pointerup', reset);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', move);
      removeEventListener('pointerup', reset);
    };
  }, [enabled, ref]);
  return look;
}

function CartoonFace({ expr, track, sweat }) {
  const ref = useRef(null);
  const [lx, ly] = useLook(track, ref);
  const E = EXPR[expr] || EXPR.neutro;
  return (
    <svg ref={ref} className="face-svg" viewBox="0 0 200 220" aria-label="Valerio">
      {/* ombra piena sfalsata stile sticker */}
      <g transform="translate(7 8)">
        <ellipse cx="100" cy="126" rx="80" ry="86" fill={INK} />
      </g>
      {/* contorno crema */}
      <ellipse cx="100" cy="126" rx="80" ry="86" fill={C.cream} />
      <g transform={E.headTilt ? `rotate(${E.headTilt} 100 130)` : undefined}>
        {/* orecchie */}
        <ellipse cx="30" cy="128" rx="13" ry="18" fill={SKIN} stroke={INK} strokeWidth="5" />
        <ellipse cx="170" cy="128" rx="13" ry="18" fill={SKIN} stroke={INK} strokeWidth="5" />
        {/* testa */}
        <path d="M100 48 C152 48 170 88 168 132 C166 178 138 204 100 204 C62 204 34 178 32 132 C30 88 48 48 100 48 Z" fill={SKIN} stroke={INK} strokeWidth="6" />
        {/* capelli */}
        <path d="M34 118 C24 70 52 30 96 32 C112 18 150 22 158 44 C176 58 174 92 166 118 C160 96 150 80 136 74 C122 86 92 88 70 78 C58 88 44 98 34 118 Z" fill={INK} />
        <path d="M70 40 C78 30 90 28 98 34" stroke={C.pink} strokeWidth="4" fill="none" strokeLinecap="round" opacity=".9" />
        {/* guance */}
        <ellipse cx="58" cy="152" rx="15" ry="9" fill={C.pink} opacity={E.blush ?? 0.35} />
        <ellipse cx="142" cy="152" rx="15" ry="9" fill={C.pink} opacity={E.blush ?? 0.35} />
        {/* sopracciglia */}
        <path d={E.brows} stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
        {/* occhi */}
        {E.eyes === 'closed' ? (
          <path d="M56 124 Q72 108 88 124 M112 124 Q128 108 144 124" stroke={INK} strokeWidth="6" strokeLinecap="round" fill="none" />
        ) : (
          <g>
            {[72, 128].map((cx) => (
              <g key={cx}>
                <ellipse cx={cx} cy="122" rx={E.eyeR?.[0] ?? 16} ry={E.eyeR?.[1] ?? 18} fill="#fff" stroke={INK} strokeWidth="5" />
                <g style={{ transform: `translate(${lx + (E.look?.[0] ?? 0)}px, ${ly + (E.look?.[1] ?? 0)}px)`, transition: 'transform .15s' }}>
                  <circle cx={cx} cy="124" r={E.pupil ?? 7.5} fill={INK} />
                  <circle cx={cx + 2.5} cy="121" r="2.4" fill="#fff" />
                </g>
                {E.eyes === 'lids' && <path d={`M${cx - 18} 122 Q${cx} 100 ${cx + 18} 122 Z`} fill={SKIN} stroke={INK} strokeWidth="5" strokeLinejoin="round" />}
              </g>
            ))}
          </g>
        )}
        {/* naso */}
        <path d="M100 132 Q92 150 102 152" stroke={INK} strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* bocca */}
        {E.mouth}
        {E.tears && (
          <g className="tears">
            <path d="M64 136 Q58 160 62 186" stroke={C.cyan} strokeWidth="8" strokeLinecap="round" fill="none" />
            <path d="M136 136 Q142 160 138 186" stroke={C.cyan} strokeWidth="8" strokeLinecap="round" fill="none" />
          </g>
        )}
        {expr === 'alloro' && <WreathG />}
        {sweat && (
          <g className="sweat">
            <path d="M156 78 q8 12 0 18 q-8 -6 0 -18 z" fill={C.cyan} stroke={INK} strokeWidth="3" />
            <path d="M42 84 q6 9 0 14 q-6 -5 0 -14 z" fill={C.cyan} stroke={INK} strokeWidth="3" />
          </g>
        )}
      </g>
    </svg>
  );
}

const EXPR = {
  neutro: {
    brows: 'M56 96 Q72 90 86 95 M114 95 Q128 90 144 96',
    mouth: <path d="M80 170 Q100 182 120 170" stroke={INK} strokeWidth="6" strokeLinecap="round" fill="none" />,
  },
  felice: {
    eyes: 'closed',
    blush: 0.6,
    brows: 'M56 92 Q72 84 86 90 M114 90 Q128 84 144 92',
    mouth: (
      <g>
        <path d="M70 160 Q100 206 130 160 Z" fill={INK} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        <path d="M84 182 Q100 196 116 182 Q100 174 84 182 Z" fill={C.pink} />
        <path d="M76 162 L124 162 L120 170 L80 170 Z" fill="#fff" />
      </g>
    ),
  },
  disperato: {
    brows: 'M56 102 L86 88 M114 88 L144 102',
    look: [0, -5],
    pupil: 6,
    tears: true,
    mouth: (
      <g>
        <path d="M72 186 Q100 148 128 186 Q100 176 72 186 Z" fill={INK} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        <path d="M88 182 Q100 172 112 182 Z" fill={C.pink} />
      </g>
    ),
  },
  sorpreso: {
    brows: 'M54 86 Q70 72 88 82 M112 82 Q130 72 146 86',
    eyeR: [18, 22],
    pupil: 5.5,
    mouth: <ellipse cx="100" cy="174" rx="11" ry="15" fill={INK} />,
  },
  ubriaco: {
    eyes: 'lids',
    blush: 0.95,
    headTilt: -9,
    look: [2, 3],
    brows: 'M56 100 Q72 96 86 100 M114 98 Q128 92 144 100',
    mouth: (
      <g>
        <path d="M76 166 Q88 178 100 168 Q112 158 126 170" stroke={INK} strokeWidth="6" strokeLinecap="round" fill="none" />
        <path d="M104 168 Q108 186 116 182 Q120 176 114 166 Z" fill={C.pink} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      </g>
    ),
  },
  alloro: {
    blush: 0.5,
    brows: 'M56 94 Q72 86 86 93 M114 93 Q128 86 144 94',
    look: [0, -2],
    mouth: (
      <g>
        <path d="M78 166 Q100 190 122 166 Q100 174 78 166 Z" fill={INK} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        <path d="M84 168 L116 168 L113 173 L87 173 Z" fill="#fff" />
      </g>
    ),
  },
};

// Corona d'alloro vera: foglie verdi a punta con nervatura, bacche rosse, fiocco rosso con le code.
export const LAUREL = { leaf: '#3DB463', leafDark: '#1F8645', vein: '#14592C', stem: '#155C2E', ribbon: '#C8102E', ribbonDark: '#8E0B21' };
const LEAF = 'M0 0 Q10 -11.5 27 0 Q10 11.5 0 0 Z';

// Foglie e bacche lungo un ramo che segue un arco di ellisse (angoli in gradi)
export function laurelBranch({ cx, cy, rx, ry, from, to, n, scale = 1, key }) {
  const out = [];
  const rad = (d) => (d * Math.PI) / 180;
  const pt = (t) => [cx + rx * Math.cos(rad(t)), cy + ry * Math.sin(rad(t))];
  const stem = [];
  for (let k = 0; k <= 24; k++) stem.push(pt(from + ((to - from) * k) / 24).map((v) => v.toFixed(1)).join(' '));
  out.push(<path key={`${key}s`} d={`M${stem.join(' L')}`} fill="none" stroke={LAUREL.stem} strokeWidth={3.5 * scale} strokeLinecap="round" />);
  const dir = Math.sign(to - from);
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * (i + 0.5)) / n;
    const [x, y] = pt(t);
    // tangente nel verso di crescita del ramo
    const tan = (Math.atan2(ry * Math.cos(rad(t)) * dir, -rx * Math.sin(rad(t)) * dir) * 180) / Math.PI;
    for (const [side, spread] of [[0, -38], [1, 38]]) {
      const color = (i + side) % 2 ? LAUREL.leafDark : LAUREL.leaf;
      out.push(
        <g key={`${key}${i}${side}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(tan + spread).toFixed(1)}) scale(${scale * (0.85 + 0.15 * Math.sin(i * 1.7 + side))})`}>
          <path d={LEAF} fill={color} stroke={C.ink} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M3 0 Q13 -1 22 0" stroke={LAUREL.vein} strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".7" />
        </g>,
      );
    }
    if (i % 3 === 1) {
      const nx = Math.cos(rad(t)) * 9 * scale, ny = Math.sin(rad(t)) * 9 * scale;
      out.push(
        <g key={`${key}b${i}`}>
          <circle cx={x + nx} cy={y + ny} r={3.6 * scale} fill={LAUREL.ribbon} stroke={C.ink} strokeWidth="2" />
          <circle cx={x + nx + 5 * scale} cy={y + ny - 3 * scale} r={3.1 * scale} fill={LAUREL.ribbon} stroke={C.ink} strokeWidth="2" />
        </g>,
      );
    }
  }
  return out;
}

function Bow({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0 C-6 16 -2 34 -10 50 L-2 47 L2 54 C6 36 4 16 0 0 Z" fill={LAUREL.ribbon} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M0 0 C8 14 12 30 12 44 L6 40 L2 46 C4 30 2 14 0 0 Z" fill={LAUREL.ribbonDark} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M0 0 C-14 -14 -24 -6 -18 4 C-12 12 -4 6 0 0 Z" fill={LAUREL.ribbon} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M0 0 C12 -16 24 -8 19 3 C14 12 4 6 0 0 Z" fill={LAUREL.ribbon} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <circle r="5.5" fill={LAUREL.ribbonDark} stroke={C.ink} strokeWidth="3" />
    </g>
  );
}

// Due rami che partono dai lati e salgono sulla testa, fiocco rosso sul lato sinistro
function WreathG() {
  const arc = { cx: 100, cy: 112, rx: 80, ry: 74, n: 10 };
  return (
    <g>
      {laurelBranch({ ...arc, from: 168, to: 262, key: 'l' })}
      {laurelBranch({ ...arc, from: 12, to: -82, key: 'r' })}
      <Bow x={24} y={124} />
    </g>
  );
}

// Solo la corona, nelle stesse coordinate della faccia: serve per animarla mentre si posa sulla testa
export function CrownOverlay({ className = '', photo = false }) {
  if (photo) return <Wreath className={`face-wreath ${className}`} />;
  return (
    <svg className={`crown-overlay ${className}`} viewBox="0 0 200 220" aria-hidden>
      <WreathG />
    </svg>
  );
}

export function Wreath({ className }) {
  return (
    <svg className={className} viewBox="0 0 200 150">
      <g transform="translate(0 -24)">
        <WreathG />
      </g>
    </svg>
  );
}

export function Shades({ className, style }) {
  return (
    <svg className={className} style={style} viewBox="0 0 200 60">
      <path d="M8 10 L192 10 L192 20 L184 20 C182 44 164 54 142 52 C122 50 110 38 108 22 L92 22 C90 38 78 50 58 52 C36 54 18 44 16 20 L8 20 Z" fill={INK} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M30 20 L52 20 L36 40 Z M128 20 L150 20 L134 40 Z" fill={C.cyan} opacity=".8" />
    </svg>
  );
}

function Sweat({ className }) {
  return (
    <svg className={className} viewBox="0 0 100 40">
      <path d="M80 4 q8 12 0 18 q-8 -6 0 -18 z" fill={C.cyan} stroke={INK} strokeWidth="3" />
      <path d="M16 10 q6 9 0 14 q-6 -5 0 -14 z" fill={C.cyan} stroke={INK} strokeWidth="3" />
    </svg>
  );
}
