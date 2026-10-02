import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Face } from '../components/Face.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Countdown, FitText, Rich, plain, useStagger } from '../components/UI.jsx';
import { C, pairColors, vibrate, motion } from '../lib/theme.js';
import { emitReliable } from '../lib/net.js';
import { sfx, unlockAudio } from '../lib/audio.js';
import { keepAwake } from '../lib/fx.js';

export function TopBar({ s }) {
  const r = s.round;
  return (
    <header className="topbar">
      <div className="round-chip"><b>{r.number}</b><span>/{r.total}</span></div>
      <Countdown
        endsAt={s.phaseEndsAt}
        total={s.settings.voteSeconds * 1000}
        paused={s.paused}
        pausedRemaining={s.pausedRemaining}
        size={62}
      />
      <div className="topbar-spacer" />
    </header>
  );
}

export function Question({ s }) {
  const me = s.me;
  const r = s.round;
  // La scelta locale vale solo finché finisce l'animazione d'uscita; poi conta quella del server
  const [picked, setPicked] = useState(null);
  const [betPicked, setBetPicked] = useState(null);
  const [animVote, setAnimVote] = useState(false);
  const [animBet, setAnimBet] = useState(false);
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0); // nuovo tentativo = bottoni nuovi
  // se il server non ha registrato la scelta (rete persa per troppo tempo) si torna ai bottoni
  const meRef = useRef(me);
  meRef.current = me;
  useEffect(() => { if (failed && (me.vote || me.bet)) setFailed(''); }, [failed, me.vote, me.bet]);
  const onVoteFail = () => {
    if (meRef.current.vote) return; // il voto c'è (es. arrivato da un altro telefono): tutto ok
    setPicked(null); setAnimVote(false); setAttempt((a) => a + 1); setFailed('Il tuo voto non è arrivato: rifallo!');
  };
  const onBetFail = () => {
    if (meRef.current.bet) return;
    setBetPicked(null); setAnimBet(false); setAttempt((a) => a + 1); setFailed('La scommessa non è arrivata: rifalla!');
  };
  const vote = animVote ? null : me.vote || picked;
  const bet = animBet ? null : me.bet || betPicked;
  useLayoutEffect(() => { keepAwake(); }, []);

  let view;
  if (!me.eligible) view = me.isHost ? <Regia s={s} /> : <Spectator s={s} />;
  else if (!vote) view = <Vote key={`v${attempt}`} s={s} onStart={() => { setFailed(''); setAnimVote(true); }} onPick={(c) => { setPicked(c); setAnimVote(false); }} onFail={onVoteFail} />;
  else if (!me.isValerio && !bet) view = <Bet key={`b${attempt}`} s={s} vote={vote} onStart={() => { setFailed(''); setAnimBet(true); }} onPick={(b) => { setBetPicked(b); setAnimBet(false); }} onFail={onBetFail} />;
  else view = <Wait s={s} vote={vote} bet={bet} />;

  return (
    <div className="screen question" style={{ '--x': pairColors(r.pair)[0], '--y': pairColors(r.pair)[1] }}>
      <TopBar s={s} />
      {failed && <p className="hint is-error vote-failed">{failed}</p>}
      {view}
    </div>
  );
}

function Vote({ s, onPick, onStart, onFail }) {
  const r = s.round;
  const [cx, cy] = pairColors(r.pair);
  const ref = useRef(null);
  const busy = useRef(false);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from('.pref', { scale: 0, rotate: -20, duration: 0.5, ease: 'back.out(3)' })
        .from('.opt-x', { x: -300 * motion, rotate: -15, duration: 0.6, ease: 'back.out(1.6)' }, 0.08)
        .from('.opt-y', { x: 300 * motion, rotate: 15, duration: 0.6, ease: 'back.out(1.6)' }, 0.16)
        .from('.or', { scale: 0, rotate: 180, duration: 0.5, ease: 'back.out(3)' }, 0.35)
        .from('.peek', { y: 120, duration: 0.6, ease: 'back.out(2)' }, 0.5);
    }, ref);
    return () => ctx.revert();
  }, []);

  const pick = (choice) => {
    if (busy.current) return;
    busy.current = true;
    onStart();
    unlockAudio();
    vibrate(35);
    sfx.boing();
    emitReliable('vote', { round: r.index, choice }).then((res) => { if (!res.ok || !res.accepted) onFail(); });
    const chosen = ref.current.querySelector(choice === 'x' ? '.opt-x' : '.opt-y');
    const other = ref.current.querySelector(choice === 'x' ? '.opt-y' : '.opt-x');
    gsap.timeline({ onComplete: () => onPick(choice) })
      .to(chosen, { scale: 0.92, duration: 0.08 })
      .to(chosen, { scale: 1.06, duration: 0.35, ease: 'elastic.out(1.2, 0.4)' })
      .to(other, { x: choice === 'x' ? 400 : -400, rotate: choice === 'x' ? 25 : -25, opacity: 0, duration: 0.35, ease: 'power2.in' }, 0.08)
      .to('.or, .pref, .peek', { scale: 0, opacity: 0, duration: 0.25 }, 0.1)
      .to(chosen, { y: -40, scale: 0.4, opacity: 0, duration: 0.3, ease: 'back.in(2)' }, 0.5);
  };

  return (
    <div className="vote" ref={ref}>
      <h2 className="pref outline">PREFERIRESTI</h2>
      <div className="options">
        <button className="option opt-x" style={{ '--c': cx }} onClick={() => pick('x')}>
          <FitText max={54} min={15}><Rich text={r.question.x} /></FitText>
        </button>
        <div className="or">O</div>
        <button className="option opt-y" style={{ '--c': cy }} onClick={() => pick('y')}>
          <FitText max={54} min={15}><Rich text={r.question.y} /></FitText>
        </button>
      </div>
      <Face expr={s.me.isValerio ? 'sorpreso' : 'neutro'} size={86} track className="peek" />
    </div>
  );
}

function Chip({ choice, r }) {
  const [cx, cy] = pairColors(r.pair);
  return (
    <div className="pick-chip" style={{ '--c': choice === 'x' ? cx : cy }}>
      <span>Hai scelto</span>
      <b>{plain(choice === 'x' ? r.question.x : r.question.y)}</b>
    </div>
  );
}

function Bet({ s, vote, onPick, onStart, onFail }) {
  const r = s.round;
  const ref = useStagger([]);
  const busy = useRef(false);
  const pick = (bet) => {
    if (busy.current) return;
    busy.current = true;
    onStart();
    vibrate(30);
    sfx.boing();
    emitReliable('bet', { round: r.index, bet }).then((res) => { if (!res.ok || !res.accepted) onFail(); });
    const el = ref.current.querySelector(bet === 'lose' ? '.bet-lose' : '.bet-safe');
    gsap.timeline({ onComplete: () => onPick(bet) })
      .to(el, { scale: 0.9, duration: 0.08 })
      .to(el, { scale: 1.1, duration: 0.3, ease: 'elastic.out(1.2,0.4)' })
      .to(ref.current.children, { y: 30, opacity: 0, stagger: 0.03, duration: 0.2 });
  };
  return (
    <div className="bet" ref={ref}>
      <div className="st"><Chip choice={vote} r={r} /></div>
      <div className="st bet-face"><Face expr="sorpreso" size={120} track /></div>
      <h2 className="st title outline bet-title">E VALERIO…<br /><span className="kw-y">PERDE?</span></h2>
      <p className="st hint">Scommetti: se indovini, +1 punto. Se perde, a turno beve o fa penitenza.</p>
      <div className="st bet-buttons">
        <button className="bet-btn bet-lose" style={{ '--c': C.orange }} onClick={() => pick('lose')}>
          <span className="emoji">🍺🎭</span><span>PERDE</span>
        </button>
        <button className="bet-btn bet-safe" style={{ '--c': C.cyan }} onClick={() => pick('safe')}>
          <span className="emoji">😇</span><span>SI SALVA</span>
        </button>
      </div>
    </div>
  );
}

export function VoteMeter({ s, size = 44 }) {
  const r = s.round;
  const voted = new Set(r.voted);
  const eligible = s.players.filter((p) => r.eligible.includes(p.id));
  return (
    <div className="meter">
      {eligible.map((p) => (
        <div key={p.id} className={`meter-av ${voted.has(p.id) ? 'is-on' : ''}`}>
          <Avatar avatar={p.avatar} size={size} dim={!voted.has(p.id)} crown={p.id === s.valerioId} />
        </div>
      ))}
    </div>
  );
}

function Counter({ s }) {
  const r = s.round;
  const n = r.voted.length;
  const numRef = useRef(null);
  const prev = useRef(n);
  useLayoutEffect(() => {
    if (n !== prev.current && numRef.current) {
      gsap.fromTo(numRef.current, { scale: 1.35, rotate: -8 }, { scale: 1, rotate: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.4)' });
      sfx.pop(n);
    }
    prev.current = n;
  }, [n]);
  return (
    <div className="counter">
      <b ref={numRef}>{n}<span>/{r.eligible.length}</span></b>
      <span>hanno votato</span>
    </div>
  );
}

function Wait({ s, vote, bet }) {
  const r = s.round;
  const ref = useStagger([]);
  if (s.me.isValerio) {
    return (
      <div className="wait" ref={ref}>
        <div className="st"><Chip choice={vote} r={r} /></div>
        <div className="st fate-face"><Face expr="neutro" size={170} sweat track className="nervous" /></div>
        <h2 className="st title outline fate-title">ASPETTA IL<br />TUO DESTINO</h2>
        <div className="st"><Counter s={s} /></div>
      </div>
    );
  }
  return (
    <div className="wait" ref={ref}>
      <div className="st chips">
        <Chip choice={vote} r={r} />
        {bet && (
          <div className="pick-chip" style={{ '--c': bet === 'lose' ? C.orange : C.cyan }}>
            <span>Scommessa</span><b>{bet === 'lose' ? 'Perde 🍺🎭' : 'Si salva 😇'}</b>
          </div>
        )}
      </div>
      <div className="st"><Counter s={s} /></div>
      <div className="st"><VoteMeter s={s} size={40} /></div>
      {s.hasScreen && <p className="st hint look-tv">👀 Guarda lo schermo grande!</p>}
    </div>
  );
}

// L'host che fa solo regia (non gioca): vede l'andamento dei voti e può saltare la domanda
function Regia({ s }) {
  const ref = useStagger([]);
  return (
    <div className="wait" ref={ref}>
      <h2 className="st title outline">REGIA</h2>
      <p className="st hint">Stai facendo da regia: i voti arrivano qui sotto. Il round si chiude da solo quando votano tutti.</p>
      <div className="st"><Counter s={s} /></div>
      <div className="st"><VoteMeter s={s} size={40} /></div>
    </div>
  );
}

function Spectator({ s }) {
  const ref = useStagger([]);
  return (
    <div className="wait" ref={ref}>
      <div className="st"><Face expr="felice" size={140} track /></div>
      <h2 className="st title outline">SEI ARRIVATO<br />IN RITARDO</h2>
      <p className="st hint">Come Valerio a lezione. Giochi dal prossimo round.</p>
      <div className="st"><Counter s={s} /></div>
    </div>
  );
}
