// Regia dell'host durante la partita: avanti, pausa, salta, espelli, sposta la corona, termina.
import { useState } from 'react';
import { Avatar } from './Avatar.jsx';
import { HostPanel } from './HostPanel.jsx';
import { C, joke } from '../lib/theme.js';
import { emitReliable } from '../lib/net.js';
import { sfx } from '../lib/audio.js';

export function HostControls({ s }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [err, setErr] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(0); // istante in cui è comparso "Sicuro?"
  const [confirmKick, setConfirmKick] = useState(null); // { id, at }
  const armed = (at) => Date.now() - at > 500; // un doppio tocco non conferma
  if (s.phase === 'lobby') return null;

  const valerio = s.players.find((p) => p.id === s.valerioId);
  const canCrown = s.phase === 'scores' || s.phase === 'end';

  const act = async (ev, payload, { close = true } = {}) => {
    sfx.click();
    const r = await emitReliable(ev, payload);
    if (!r.ok) {
      if (r.error !== 'stale') setErr(joke(r.error));
      return;
    }
    setErr('');
    setConfirmKick(null);
    if (close) setOpen(false);
  };

  return (
    <>
      <button className={`regia-fab ${open ? 'is-open' : ''} ${valerio && !valerio.connected ? 'has-alert' : ''}`} onClick={() => { sfx.click(); setOpen(!open); setConfirmEnd(0); setConfirmKick(null); }}>
        {open ? '✕' : '🎬'}
      </button>
      {open && (
        <div className="sheet" onClick={() => setOpen(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <h3 className="outline">REGIA</h3>
            <div className="regia-grid">
              {s.paused
                ? <button style={{ '--c': C.cyan }} onClick={() => act('host:resume', {}, { close: false })}>▶ Riprendi</button>
                : s.phase === 'question' && <button style={{ '--c': C.cyan }} onClick={() => act('host:pause', {}, { close: false })}>❚❚ Pausa</button>}
              {s.phase === 'question' && <button style={{ '--c': C.orange }} onClick={() => act('host:skip', { round: s.round?.index })}>⏭ Salta domanda</button>}
              {(s.phase === 'reveal' || s.phase === 'scores') && <button style={{ '--c': C.yellow }} onClick={() => act('host:next', { expect: s.phase })}>▶ Avanti</button>}
              <button style={{ '--c': C.pink }} onClick={() => { setPanel(true); setOpen(false); }}>📝 Domande & foto</button>
              {s.phase !== 'end' && (
                confirmEnd
                  ? <button className="arming" style={{ '--c': C.orange }} onClick={() => armed(confirmEnd) && act('host:end')}>Sicuro? Termina</button>
                  : <button style={{ '--c': C.cream }} onClick={() => setConfirmEnd(Date.now())}>🏁 Termina partita</button>
              )}
              {s.phase === 'end' && <button style={{ '--c': C.yellow }} onClick={() => act('host:restart')}>↺ Torna in lobby</button>}
            </div>
            {err && <p className="hint is-error">{err}</p>}

            {valerio && !valerio.connected && (
              <p className="regia-alert">
                ⚠️ <b>{valerio.name}</b> è offline. Se il suo telefono è morto, fallo rientrare da un altro telefono
                (con un nome qualsiasi) e {canCrown ? 'tocca 👑 accanto al suo nome qui sotto.' : 'in classifica spostagli la corona con 👑.'}
              </p>
            )}

            <h4>Giocatori · {canCrown ? '👑 sposta la corona · ' : ''}✕ espelli</h4>
            <div className="kick-list">
              {s.players.filter((p) => p.id !== s.hostId || p.plays).map((p) => (
                <div key={p.id} className={`kick-row ${p.connected ? '' : 'is-away'}`}>
                  <Avatar avatar={p.avatar} size={32} crown={p.id === s.valerioId} />
                  <span>{p.name}{p.id === s.hostId && ' (tu)'}{!p.connected && ' · offline'}</span>
                  {canCrown && p.plays && p.id !== s.valerioId && (
                    <button className="crown-btn" onClick={() => act('host:valerio', { playerId: p.id }, { close: false })} aria-label={`Fai diventare Valerio ${p.name}`}>👑</button>
                  )}
                  {p.id !== s.valerioId && p.id !== s.hostId && (
                    confirmKick?.id === p.id
                      ? <button className="kick-confirm arming" onClick={() => armed(confirmKick.at) && act('host:kick', { playerId: p.id }, { close: false })}>Espelli</button>
                      : <button onClick={() => setConfirmKick({ id: p.id, at: Date.now() })} aria-label={`Espelli ${p.name}`}>✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {panel && <HostPanel s={s} onClose={() => setPanel(false)} />}
    </>
  );
}
