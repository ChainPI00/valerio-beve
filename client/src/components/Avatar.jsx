import { C } from '../lib/theme.js';
import { laurelBranch } from './Face.jsx';

export const SHAPES = ['blob', 'star', 'flower', 'squircle', 'triangle', 'ghost'];
export const AV_COLORS = ['pink', 'yellow', 'cyan', 'orange', 'cream'];

const PATHS = {
  blob: 'M50 8 C74 6 94 24 92 50 C90 76 72 94 48 92 C22 90 6 72 8 48 C10 26 28 10 50 8 Z',
  star: 'M50 5 L61 34 L93 36 L68 56 L77 88 L50 70 L23 88 L32 56 L7 36 L39 34 Z',
  flower:
    'M50 12 C58 -2 78 6 74 22 C90 18 100 38 86 46 C100 56 90 76 74 72 C78 90 58 98 50 84 C42 98 22 90 26 72 C10 76 0 56 14 46 C0 38 10 18 26 22 C22 6 42 -2 50 12 Z',
  squircle: 'M50 8 C84 8 92 16 92 50 C92 84 84 92 50 92 C16 92 8 84 8 50 C8 16 16 8 50 8 Z',
  triangle: 'M50 8 C56 8 60 12 64 20 L92 76 C96 86 90 92 80 92 L20 92 C10 92 4 86 8 76 L36 20 C40 12 44 8 50 8 Z',
  ghost: 'M50 6 C76 6 90 26 90 50 L90 90 L78 80 L66 92 L50 80 L34 92 L22 80 L10 90 L10 50 C10 26 24 6 50 6 Z',
};

export function Avatar({ avatar, size = 56, name, dim = false, mood = 'ok', crown = false, className = '', style }) {
  const color = C[avatar?.color] || C.pink;
  const d = PATHS[avatar?.shape] || PATHS.blob;
  const eyeY = avatar?.shape === 'triangle' ? 60 : 46;
  const sad = mood === 'sad';
  return (
    <div className={`avatar ${dim ? 'is-dim' : ''} ${sad ? 'is-sad' : ''} ${className}`} style={{ width: size, ...style }}>
      <svg viewBox="-4 -4 112 112" width={size} height={size} style={{ overflow: 'visible' }}>
        <path d={d} fill={C.ink} transform="translate(6 7)" />
        <path d={d} fill={color} stroke={C.ink} strokeWidth="6" strokeLinejoin="round" />
        {sad ? (
          <g stroke={C.ink} strokeWidth="5" strokeLinecap="round" fill="none">
            <path d={`M34 ${eyeY - 2} L44 ${eyeY + 3} M66 ${eyeY - 2} L56 ${eyeY + 3}`} />
            <path d={`M40 ${eyeY + 20} Q50 ${eyeY + 12} 60 ${eyeY + 20}`} />
          </g>
        ) : (
          <g>
            <ellipse cx="39" cy={eyeY} rx="5.5" ry="7.5" fill={C.ink} />
            <ellipse cx="61" cy={eyeY} rx="5.5" ry="7.5" fill={C.ink} />
            <circle cx="41" cy={eyeY - 3} r="2" fill="#fff" />
            <circle cx="63" cy={eyeY - 3} r="2" fill="#fff" />
            <path d={`M42 ${eyeY + 13} Q50 ${eyeY + 20} 58 ${eyeY + 13}`} stroke={C.ink} strokeWidth="4.5" strokeLinecap="round" fill="none" />
          </g>
        )}
        {crown && (
          <g>
            {laurelBranch({ cx: 50, cy: 50, rx: 50, ry: 50, from: 200, to: 262, n: 4, scale: 0.72, key: 'al' })}
            {laurelBranch({ cx: 50, cy: 50, rx: 50, ry: 50, from: -20, to: -82, n: 4, scale: 0.72, key: 'ar' })}
          </g>
        )}
      </svg>
      {name != null && <span className="avatar-name">{name}</span>}
    </div>
  );
}
