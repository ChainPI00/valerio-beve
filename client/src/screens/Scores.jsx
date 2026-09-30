import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { Avatar } from '../components/Avatar.jsx';
import { Face } from '../components/Face.jsx';
import { Btn, plain } from '../components/UI.jsx';
import { C, motion } from '../lib/theme.js';
import { emit } from '../lib/net.js';
import { sfx } from '../lib/audio.js';

// Mini classifica tra un round e l'altro
export function Scores({ s, tv = false }) {
  const ref = useRef(null);
  const byId = Object.fromEntries(s.players.map((p) => [p.id, p]));
  const board = s.leaderboard.filter((b) => byId[b.id]);
  const top = board.slice(0, tv ? 8 : 5);
  const myRank = s.me ? board.findIndex((b) => b.id === s.me.id) : -1;
  const res = s.round?.result;
  const last = s.round && s.round.number >= s.round.total;

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.sc-title', { scale: 0, rotate: -15, duration: 0.6, ease: 'back.out(2.5)' });
      gsap.from('.sc-row', { x: (i) => (i % 2 ? 300 : -300) * motion, rotate: (i) => (i % 2 ? 8 : -8), opacity: 0, duration: 0.6, ease: 'back.out(1.6)', stagger: 0.08, delay: 0.2 });
      gsap.from('.sc-drinks', { scale: 0, duration: 0.7, ease: 'elastic.out(1, 0.45)', delay: 0.6 });
    }, ref);
    return () => ctx.revert();
  }, []);

  const next = () => { sfx.whoosh(); emit('host:next'); };

  return (
    <div className={`screen scores ${tv ? 'is-tv' : ''}`} ref={ref}>
      <h1 className="sc-title title outline tilt-l">CHI CONOSCE<br />MEGLIO VALERIO</h1>
      <ol className="sc-list">
        {top.map((b, i) => (
          <li key={b.id} className={`sc-row ${s.me?.id === b.id ? 'is-me' : ''}`} style={{ '--c': [C.yellow, C.cyan, C.pink][i] || C.cream }}>
            <span className="sc-rank">{i + 1}</span>
            <Avatar avatar={byId[b.id].avatar} size={tv ? 56 : 40} crown={i === 0 && b.score > 0} />
            <span className="sc-name">{byId[b.id].name}</span>
            <b className="sc-score">{b.score}</b>
          </li>
        ))}
      </ol>
      {myRank >= top.length && (
        <p className="hint">Tu sei <b>{myRank + 1}°</b> con {board[myRank].score} punti</p>
      )}
      <div className="sc-drinks">
        <Face expr={s.drinks >= 5 ? 'ubriaco' : res?.lost ? 'disperato' : 'felice'} size={tv ? 120 : 76} />
        <div className="tally">
          <div><b>{s.drinks}</b><span>🍺 {s.drinks === 1 ? 'bevuta' : 'bevute'}</span></div>
          <div><b>{s.penances}</b><span>🎭 {s.penances === 1 ? 'penitenza' : 'penitenze'}</span></div>
        </div>
        {s.streak >= 3 && <span className="fire-badge">🔥 {s.streak}</span>}
      </div>
      {s.me?.isHost ? (
        <div className="btn-col">
          <Btn big color={C.yellow} onClick={next} sound="boing">{last ? 'PODIO FINALE ▶' : 'PROSSIMA ▶'}</Btn>
        </div>
      ) : (
        !tv && <p className="hint wiggle">Prossima domanda in arrivo…</p>
      )}
      {tv && s.round && <p className="hint">Round {s.round.number}/{s.round.total} · {plain(s.round.question.x)} o {plain(s.round.question.y)}</p>}
    </div>
  );
}
