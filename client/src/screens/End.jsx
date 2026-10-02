import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Avatar } from '../components/Avatar.jsx';
import { Face } from '../components/Face.jsx';
import { Btn, Rich } from '../components/UI.jsx';
import { C, motion } from '../lib/theme.js';
import { emit, leave, serverNow } from '../lib/net.js';
import { Proclamation, PROCLAIM_S } from '../components/Proclamation.jsx';
import { sfx } from '../lib/audio.js';
import { ExitLink } from '../components/ExitLink.jsx';
import { burst } from '../lib/fx.js';

// Conferma in due tempi: il secondo tocco vale solo dopo mezzo secondo (un doppio tocco non conferma)
function ConfirmBtn({ label, confirm, onConfirm }) {
  const [armedAt, setArmedAt] = useState(0);
  const armed = armedAt > 0;
  return (
    <Btn
      big
      color={armed ? C.orange : C.yellow}
      sound="boing"
      onClick={() => {
        if (!armed) { setArmedAt(Date.now()); setTimeout(() => setArmedAt(0), 4000); return; }
        if (Date.now() - armedAt < 500) return;
        onConfirm();
      }}
    >
      {armed ? confirm : label}
    </Btn>
  );
}

export function End({ s, tv = false }) {
  const ref = useRef(null);
  const byId = Object.fromEntries(s.players.map((p) => [p.id, p]));
  const board = s.leaderboard.filter((b) => byId[b.id]);
  const podium = [board[1], board[0], board[2]]; // 2° 1° 3°
  const fin = s.final || { drinks: s.drinks, penances: s.penances, highlights: [], rounds: 0 };
  const myRank = s.me ? board.findIndex((b) => b.id === s.me.id) : -1;
  const valerio = s.players.find((p) => p.id === s.valerioId);
  // Prima la proclamazione (sincronizzata col server), poi il podio
  const [proc, setProc] = useState(() => (serverNow() < s.phaseStartsAt + PROCLAIM_S * 1000 ? s.phaseStartsAt : null));
  const ready = proc === null;

  useLayoutEffect(() => {
    if (!ready) return;
    sfx.pop(6);
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from('.end-hero', { y: -200 * motion, scale: 0.4, rotate: -20, opacity: 0, duration: 0.8, ease: 'back.out(1.8)' })
        .from('.pod-col', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.8, ease: 'elastic.out(1, 0.5)', stagger: { each: 0.35, from: 'end' } }, 0.3)
        .from('.pod-av', { y: -300, opacity: 0, duration: 0.7, ease: 'bounce.out', stagger: { each: 0.35, from: 'end' } }, 0.6)
        .call(() => burst({ x: 0.5, y: 0.35, count: 90, power: 1.3 }), null, 1.6)
        .from('.end-drinks', { scale: 0, rotate: 20, duration: 0.8, ease: 'elastic.out(1, 0.45)' }, 1.8)
        .from('.hl', { x: (i) => (i % 2 ? 300 : -300), opacity: 0, duration: 0.6, ease: 'back.out(1.6)', stagger: 0.15 }, 2.2);
      const n = { v: 0 };
      tl.to(n, { v: 1, duration: 1.4, ease: 'power2.out', onUpdate: () => {
        const [a, b] = ref.current?.querySelectorAll('.end-drinks b') || [];
        if (a) a.textContent = Math.round(n.v * fin.drinks);
        if (b) b.textContent = Math.round(n.v * (fin.penances || 0));
      } }, 1.9);
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className={`screen end ${tv ? 'is-tv' : ''}`} ref={ref}>
      <button className="end-hero" onClick={() => { sfx.click(); setProc(serverNow() + 300); }} aria-label="Rivedi la proclamazione">
        <Face expr="alloro" size={tv ? 150 : 96} className="breathe" />
        <span className="end-hero-text">
          <small>FINE PARTITA · 🎓</small>
          <b>DOTT. {(s.valerioName || valerio?.name || 'Valerio').toUpperCase()}</b>
          <i>tocca per rivedere la proclamazione</i>
        </span>
      </button>
      <div className="end-cols">
        <div className="end-col">
          <div className="podium">
            {podium.map((b, i) => (
              <div key={i} className={`pod pod-${i}`}>
                {b && (
                  <div className="pod-av">
                    <Avatar avatar={byId[b.id].avatar} size={tv ? 90 : i === 1 ? 66 : 52} crown={i === 1 ? 'king' : false} name={byId[b.id].name} />
                  </div>
                )}
                <div className="pod-col" style={{ '--c': [C.cyan, C.yellow, C.pink][i] }}>
                  <b>{[2, 1, 3][i]}</b>
                  {b && <span>{b.score} pt</span>}
                </div>
              </div>
            ))}
          </div>
          {board[0] && <p className="hint">🏆 <b>{byId[board[0].id].name}</b> conosce Valerio meglio di sua madre.</p>}
          {myRank > 2 && <p className="hint">Tu: {myRank + 1}° con {board[myRank].score} punti</p>}
        </div>

        <div className="end-col">
          <div className="end-drinks">
            <Face expr="ubriaco" size={tv ? 200 : 120} />
            <div className="tally">
              <div><b>0</b><span>🍺 volte ha bevuto</span></div>
              <div><b>0</b><span>🎭 penitenze</span></div>
              <span className="tally-note">su {fin.rounds} domande</span>
            </div>
          </div>
          {fin.highlights.length > 0 && (
            <div className="highlights">
              <h3 className="outline">I MOMENTI PIÙ SOLITARI</h3>
              {fin.highlights.map((h) => (
                <div key={h.number} className="hl">
                  <b className="hl-tag">{h.sameAsValerio === 0 ? `UNICO CONTRO ${h.n}` : `${h.sameAsValerio + 1} CONTRO ${h.n - h.sameAsValerio}`}</b>
                  <span><Rich text={h.valerioVote === 'x' ? h.question.x : h.question.y} /> <i>invece di</i> <Rich text={h.valerioVote === 'x' ? h.question.y : h.question.x} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!ready && <Proclamation s={s} startsAt={proc} tv={tv} onDone={() => setProc(null)} />}

      {s.me?.isHost ? (
        <div className="btn-col">
          <ConfirmBtn label="RIGIOCA" confirm="Sicuro? Si azzera tutto" onConfirm={() => emit('host:restart')} />
          <ExitLink />
        </div>
      ) : (
        !tv && <button className="link" onClick={leave}>esci dalla stanza</button>
      )}
    </div>
  );
}
