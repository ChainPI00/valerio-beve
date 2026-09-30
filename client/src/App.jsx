import { useEffect, useState } from 'react';
import { useStore, resumeSaved, session } from './lib/net.js';
import { Background, Stage, MuteToggle } from './components/UI.jsx';
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
import { audioReady, unlockAudio } from './lib/audio.js';

// /ABCD → entra con codice · /tv → schermo grande · /tv/ABCD → schermo grande collegato
const path = location.pathname.replace(/\/+$/, '');
const TV = isTv();
const urlCode = (TV ? path.slice(3) : path).replace(/^\//, '').toUpperCase().match(/^[A-Z]{4}$/)?.[0] || '';

export function App() {
  const state = useStore((s) => s.state);
  const connected = useStore((s) => s.connected);
  const resuming = useStore((s) => s.resuming);
  const [booting, setBooting] = useState(() => !TV && !!session.get());

  useEffect(() => {
    if (TV) return;
    const saved = session.get();
    // Se il link punta a un'altra stanza, la sessione salvata non vale
    if (saved && urlCode && saved.code !== urlCode) session.clear();
    resumeSaved().finally(() => setTimeout(() => setBooting(false), 600));
  }, []);

  useEffect(() => {
    // Il codice nell'URL serve solo per entrare: poi lo togliamo per non rientrare per sbaglio
    if (state && !TV && location.pathname !== '/') history.replaceState(null, '', '/');
  }, [state]);

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
      {state?.me?.isHost && <HostControls s={state} />}
      {state?.paused && <PausedBanner s={state} />}
      {!connected && !booting && <div className="offline">{joke('offline')}</div>}
      {state && !state.me && <TvAudioGate />}
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
      <span>{s.pauseReason === 'host' ? `${host?.name || 'L’host'} è sparito. Aspettiamo che torni…` : 'L’host ha messo in pausa. Ne approfitti per un sorso?'}</span>
    </div>
  );
}

// Se la TV si è ricollegata da sola (reload) l'audio è bloccato finché qualcuno non clicca
function TvAudioGate() {
  const [ready, setReady] = useState(audioReady());
  useEffect(() => {
    const id = setInterval(() => setReady(audioReady()), 1000);
    return () => clearInterval(id);
  }, []);
  if (ready) return null;
  return (
    <button className="audio-gate" onClick={() => { unlockAudio(); setTimeout(() => setReady(audioReady()), 100); }}>
      🔊 Clicca per attivare l’audio
    </button>
  );
}
