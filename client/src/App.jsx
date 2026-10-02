import { useEffect, useState } from 'react';
import { useStore, resumeSaved, session } from './lib/net.js';
import { Background, Stage, MuteToggle, MusicToggle } from './components/UI.jsx';
import { HostControls } from './components/HostControls.jsx';
import { Face } from './components/Face.jsx';
import { Home } from './screens/Home.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Question } from './screens/Question.jsx';
import { Reveal } from './screens/Reveal.jsx';
import { Scores } from './screens/Scores.jsx';
import { End } from './screens/End.jsx';
import { TvJoin, TvLobby, TvQuestion } from './screens/Tv.jsx';
import { C, pairColors, joke, isTv } from './lib/theme.js';
import { audioReady, unlockAudio, isMuted, music, setBigScreen } from './lib/audio.js';

// /ABCD → entra con codice · /tv → schermo grande · /tv/ABCD → schermo grande collegato
const path = location.pathname.replace(/\/+$/, '');
const TV = isTv();
const urlCode = (TV ? path.slice(3) : path).replace(/^\//, '').toUpperCase().match(/^[A-Z]{4}$/)?.[0] || '';

export function App() {
  const state = useStore((s) => s.state);
  const connected = useStore((s) => s.connected);
  const resuming = useStore((s) => s.resuming);
  const lostReason = useStore((s) => s.lostReason);
  const [booting, setBooting] = useState(() => {
    if (TV) return false;
    const saved = session.get();
    // Se il link punta a un'altra stanza, la sessione salvata non vale
    if (saved && urlCode && saved.code !== urlCode) { session.clear(); return false; }
    return !!saved;
  });

  // Con una sessione salvata si resta su "Ti riportiamo in partita" finché si rientra davvero
  // (o la stanza non c'è più, o dopo 10 s): niente home che lampeggia durante il rientro
  useEffect(() => {
    if (TV) return;
    resumeSaved().then((had) => { if (!had) setBooting(false); });
    const t = setTimeout(() => setBooting(false), 10000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (booting && (state || lostReason || !session.get())) setBooting(false);
  }, [booting, state, lostReason, resuming]);

  useEffect(() => {
    // Il codice nell'URL serve solo per entrare: poi lo togliamo per non rientrare per sbaglio
    if (state && !TV && location.pathname !== '/') history.replaceState(null, '', '/');
  }, [state]);

  // Con la TV collegata la musica la fa la TV: i telefoni non la suonano (meno caos e meno batteria)
  const hasScreen = !!state?.hasScreen;
  useEffect(() => {
    if (TV) setBigScreen(true);
    else music.setScale(hasScreen ? 0 : 1);
  }, [hasScreen]);

  const round = state?.round;
  const [ax, ay] = round ? pairColors(round.pair) : [C.pink, C.cyan];

  let key = 'home';
  let view = null;
  if (!state) {
    if (booting || resuming) { key = 'boot'; view = <Boot />; }
    else if (TV) { key = 'tvjoin'; view = <TvJoin initialCode={urlCode} />; }
    else { key = 'home'; view = <Home initialCode={urlCode} />; }
  } else {
    const tv = !state.me;
    key = `${state.phase}:${round?.index ?? ''}`;
    if (state.phase === 'lobby') view = tv ? <TvLobby s={state} /> : <Lobby s={state} />;
    else if (state.phase === 'question') view = tv ? <TvQuestion s={state} /> : <Question s={state} />;
    else if (state.phase === 'reveal') view = <Reveal s={state} tv={tv} />;
    else if (state.phase === 'scores') view = <Scores s={state} tv={tv} />;
    else if (state.phase === 'end') view = <End s={state} tv={tv} />;
  }

  return (
    <div className={`app ${TV ? 'is-tv' : ''}`}>
      <Background accent={ax} accent2={ay} />
      <main className="stage-root">
        <Stage viewKey={key} color={state?.phase === 'reveal' ? C.night : ax}>{view}</Stage>
      </main>
      <MuteToggle />
      <MusicToggle />
      {state?.me?.isHost && <HostControls s={state} />}
      {state?.paused && <PausedBanner s={state} />}
      {!connected && !booting && <div className="offline">{joke('offline')}</div>}
      {state && <AudioGate tv={!state.me} />}
      {!TV && <div className="rotate-hint"><span>📱</span>Gira il telefono in verticale</div>}
    </div>
  );
}

function Boot() {
  return (
    <div className="screen center boot">
      <Face expr="sorpreso" size={120} className="breathe" />
      <p className="hint wiggle">Ti stiamo riportando in partita…</p>
    </div>
  );
}

function PausedBanner({ s }) {
  const host = s.players.find((p) => p.id === s.hostId);
  return (
    <div className="paused">
      <b>PAUSA</b>
      <span>
        {s.pauseReason === 'host'
          ? `${host?.name || 'L’host'} è sparito. Aspettiamo che torni… Se ha perso il telefono: Entra con il codice ${s.code}, stesso nome e PIN.`
          : 'L’host ha messo in pausa. Ne approfitti per un sorso?'}
      </span>
    </div>
  );
}

// Se il browser ha spento l'audio (Safari dopo blocco schermo, notifica, reload) chiediamo un tocco
function AudioGate({ tv }) {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let misses = 0;
    const id = setInterval(() => {
      // aspettiamo ~2 s prima di mostrarla, così non lampeggia mentre Safari si riprende da solo
      misses = audioReady() || isMuted() ? 0 : misses + 1;
      setOk(misses < 3);
    }, 700);
    return () => clearInterval(id);
  }, []);
  if (ok) return null;
  return (
    <button className={`audio-gate ${tv ? '' : 'is-phone'}`} onClick={() => { unlockAudio(); setOk(true); }}>
      🔊 {tv ? 'Clicca' : 'Tocca'} per riattivare l’audio
    </button>
  );
}
