// Schermo grande (TV / proiettore): lo spettacolo in versione lunga.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import QRCode from 'qrcode';
import { Face } from '../components/Face.jsx';
import { Countdown, FitText, Rich, Btn } from '../components/UI.jsx';
import { PlayerStickers } from './Lobby.jsx';
import { VoteMeter } from './Question.jsx';
import { Logo } from './Home.jsx';
import { C, pairColors, joke, motion } from '../lib/theme.js';
import { joinScreen, useStore } from '../lib/net.js';
import { unlockAudio, setBigScreen } from '../lib/audio.js';
import { keepAwake } from '../lib/fx.js';

export function TvJoin({ initialCode }) {
  const [code, setCode] = useState(initialCode || '');
  const [err, setErr] = useState('');
  const lost = useStore((s) => s.lostReason);
  const go = async (c = code) => {
    unlockAudio();
    setBigScreen(true);
    keepAwake();
    const res = await joinScreen(c.toUpperCase());
    if (!res.ok) setErr(joke(res.error));
  };
  // Se la TV ricarica la pagina (/tv/CODICE) rientra da sola; l'audio lo riattiva un clic quando serve
  const tried = useRef(false);
  const connected = useStore((s) => s.connected);
  useEffect(() => {
    if (!initialCode || tried.current || !connected) return;
    tried.current = true;
    setBigScreen(true);
    joinScreen(initialCode).then((res) => { if (!res.ok) setErr(joke(res.error)); });
  }, [initialCode, connected]);
  return (
    <div className="screen tv-join">
      <Logo size={1.6} />
      <div className="tv-join-box">
        <input
          className="big-input mono"
          placeholder="CODICE"
          value={code}
          maxLength={4}
          autoFocus
          onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setErr(''); }}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <Btn big color={C.yellow} onClick={() => go()}>{initialCode ? 'ACCENDI LO SHOW 🔊' : 'COLLEGA SCHERMO'}</Btn>
        <p className={`hint ${err || lost ? 'is-error' : ''}`}>{err || (lost && joke(lost)) || 'Il clic serve anche ad attivare l’audio della TV.'}</p>
      </div>
    </div>
  );
}

export function TvLobby({ s }) {
  const [qr, setQr] = useState('');
  const url = `${location.host}/${s.code}`;
  const ref = useRef(null);
  const valerio = s.players.find((p) => p.id === s.valerioId);
  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/${s.code}`, { margin: 1, width: 360, color: { dark: C.ink, light: C.cream } }).then(setQr);
  }, [s.code]);
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.tv-code-tile', { y: -300 * motion, rotate: () => gsap.utils.random(-40, 40), duration: 0.9, ease: 'bounce.out', stagger: 0.1 });
      gsap.from('.tv-qr', { scale: 0, rotate: 20, duration: 0.8, ease: 'back.out(2)', delay: 0.5 });
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <div className="screen tv tv-lobby" ref={ref}>
      <div className="tv-lobby-left">
        <h2 className="outline tv-kicker">ENTRA DAL TELEFONO</h2>
        <div className="tv-code">
          {[...s.code].map((ch, i) => (
            <span key={i} className="tv-code-tile" style={{ '--c': [C.pink, C.yellow, C.cyan, C.orange][i] }}>{ch}</span>
          ))}
        </div>
        <p className="tv-url">{url}</p>
        {qr && <img className="tv-qr" src={qr} alt="QR per entrare" />}
      </div>
      <div className="tv-lobby-right">
        <Face expr="alloro" size={260} className="breathe" />
        <h1 className="title outline tv-title">{valerio ? `${(s.valerioName || valerio.name).toUpperCase()} BEVE?` : 'VALERIO BEVE'}</h1>
        <p className="hint">{s.players.length} {s.players.length === 1 ? 'giocatore' : 'giocatori'} · {s.questionCount} domande</p>
        <PlayerStickers players={s.players} valerioId={s.valerioId} hostId={s.hostId} size={78} />
      </div>
    </div>
  );
}

export function TvQuestion({ s }) {
  const r = s.round;
  const [cx, cy] = pairColors(r.pair);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from('.pref', { scale: 0, rotate: -20, duration: 0.6, ease: 'back.out(3)' })
        .from('.opt-x', { x: -600 * motion, rotate: -15, duration: 0.7, ease: 'back.out(1.5)' }, 0.1)
        .from('.opt-y', { x: 600 * motion, rotate: 15, duration: 0.7, ease: 'back.out(1.5)' }, 0.2)
        .from('.or', { scale: 0, rotate: 180, duration: 0.5, ease: 'back.out(3)' }, 0.5);
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <div className="screen tv tv-question" ref={ref} style={{ "--x": cx, "--y": cy }}>
      <header className="tv-top">
        <div className="round-chip big"><b>{r.number}</b><span>/{r.total}</span></div>
        <h2 className="pref outline">PREFERIRESTI</h2>
        <Countdown endsAt={s.phaseEndsAt} total={s.settings.voteSeconds * 1000} paused={s.paused} pausedRemaining={s.pausedRemaining} size={130} />
      </header>
      <div className="options tv-options">
        <div className="option opt-x" style={{ '--c': cx }}><FitText max={110} min={30}><Rich text={r.question.x} /></FitText></div>
        <div className="or">O</div>
        <div className="option opt-y" style={{ '--c': cy }}><FitText max={110} min={30}><Rich text={r.question.y} /></FitText></div>
      </div>
      <footer className="tv-foot">
        <Face expr="neutro" size={110} sweat className="nervous" />
        <VoteMeter s={s} size={62} />
        <div className="counter small"><b>{r.voted.length}<span>/{r.eligible.length}</span></b><span>hanno votato</span></div>
      </footer>
    </div>
  );
}
