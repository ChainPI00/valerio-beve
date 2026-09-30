// Regia dell'host durante la partita: avanti, pausa, salta, espelli, termina.
import { useState } from 'react';
import { Avatar } from './Avatar.jsx';
import { HostPanel } from './HostPanel.jsx';
import { C, joke } from '../lib/theme.js';
import { emit } from '../lib/net.js';
import { sfx } from '../lib/audio.js';

export function HostControls({ s }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [err, setErr] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (s.phase === 'lobby') return null;

  const act = async (ev, payload) => {
    sfx.click();
    const r = await emit(ev, payload);
    if (!r.ok) setErr(joke(r.error));
    else { setErr(''); if (ev !== 'host:pause' && ev !== 'host:resume') setOpen(false); }
  };

  return (
    <>
      <button className={`regia-fab ${open ? 'is-open' : ''}`} onClick={() => { sfx.click(); setOpen(!open); }}>
        {open ? '✕' : '🎬'}
      </button>
      {open && (
        <div className="sheet" onClick={() => setOpen(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <h3 className="outline">REGIA</h3>
            <div className="regia-grid">
              {s.phase === 'question' && (
                s.paused
                  ? <button style={{ '--c': C.cyan }} onClick={() => act('host:resume')}>▶ Riprendi</button>
                  : <button style={{ '--c': C.cyan }} onClick={() => act('host:pause')}>❚❚ Pausa</button>
              )}
              {s.phase === 'question' && <button style={{ '--c': C.orange }} onClick={() => act('host:skip')}>⏭ Salta domanda</button>}
              {(s.phase === 'reveal' || s.phase === 'scores') && <button style={{ '--c': C.yellow }} onClick={() => act('host:next')}>▶ Prossima</button>}
              <button style={{ '--c': C.pink }} onClick={() => { setPanel(true); setOpen(false); }}>📝 Domande & foto</button>
              {s.phase !== 'end' && (
                confirmEnd
                  ? <button style={{ '--c': C.orange }} onClick={() => act('host:end')}>Sicuro? Termina</button>
                  : <button style={{ '--c': C.cream }} onClick={() => setConfirmEnd(true)}>🏁 Termina partita</button>
              )}
              {s.phase === 'end' && <button style={{ '--c': C.yellow }} onClick={() => act('host:restart')}>↺ Torna in lobby</button>}
            </div>
            {err && <p className="hint is-error">{err}</p>}
            <h4>Giocatori · tocca ✕ per espellere</h4>
            <div className="kick-list">
              {s.players.filter((p) => p.id !== s.hostId).map((p) => (
                <div key={p.id} className={`kick-row ${p.connected ? '' : 'is-away'}`}>
                  <Avatar avatar={p.avatar} size={32} crown={p.id === s.valerioId} />
                  <span>{p.name}{!p.connected && ' · offline'}</span>
                  {p.id !== s.valerioId && <button onClick={() => act('host:kick', { playerId: p.id })} aria-label={`Espelli ${p.name}`}>✕</button>}
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
