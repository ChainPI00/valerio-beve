import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Face } from '../components/Face.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Btn, useStagger } from '../components/UI.jsx';
import { HostPanel } from '../components/HostPanel.jsx';
import { C, joke, vibrate, motion } from '../lib/theme.js';
import { emit, leave } from '../lib/net.js';
import { sfx } from '../lib/audio.js';
import { loadImage } from '../lib/fx.js';

const IS_IPHONE = typeof navigator !== 'undefined' && /iP(hone|od)/.test(navigator.userAgent);

// Sticker dei giocatori che cadono e rimbalzano quando entrano
export function PlayerStickers({ players, valerioId, hostId, onTap, size = 58, seen }) {
  const ref = useRef(null);
  const own = useRef(new Set());
  const first = useRef(true);
  const known = seen || own;
  useLayoutEffect(() => {
    const fresh = [];
    for (const p of players) {
      if (!known.current.has(p.id)) {
        known.current.add(p.id);
        const el = ref.current?.querySelector(`[data-id="${p.id}"]`);
        if (el) fresh.push(el);
      }
    }
    if (fresh.length) {
      gsap.from(fresh, { y: -260 * motion, rotate: () => gsap.utils.random(-50, 50), duration: 0.9, ease: 'bounce.out', stagger: 0.06 });
      if (!first.current) fresh.forEach((_, i) => sfx.pop(players.length + i));
    }
    first.current = false;
  }, [players, known]);
  return (
    <div className="stickers" ref={ref}>
      {players.map((p, i) => (
        <button
          key={p.id}
          data-id={p.id}
          className={`sticker ${p.id === valerioId ? 'is-valerio' : ''} ${!p.connected ? 'is-away' : ''}`}
          style={{ '--r': `${((i * 37) % 13) - 6}deg` }}
          onClick={onTap ? () => onTap(p) : undefined}
          disabled={!onTap}
        >
          <Avatar avatar={p.avatar} size={size} crown={p.id === valerioId} name={p.name + (p.id === hostId ? ' 🎬' : '')} />
        </button>
      ))}
    </div>
  );
}

export function Lobby({ s }) {
  const me = s.me;
  const [panel, setPanel] = useState(false);
  const [err, setErr] = useState('');
  const valerio = s.players.find((p) => p.id === s.valerioId);
  const ref = useStagger([me.isValerio]);
  const meta = s.library?.meta || {};

  // Precarica in lobby foto e meme (font e suoni sono già pronti)
  useEffect(() => {
    Object.values(s.library?.faces || {}).forEach((u) => u && loadImage(u));
    (s.library?.memes || []).forEach((m) => loadImage(m.url));
  }, [s.library]);

  const lastCrown = useRef(0);
  const crown = async (p) => {
    if (!p.plays) return;
    if (Date.now() - lastCrown.current < 900) return; // un doppio tocco non deve togliere la corona appena data
    lastCrown.current = Date.now();
    sfx.boing();
    vibrate(20);
    const r = await emit('host:valerio', { playerId: p.id });
    if (!r.ok) setErr(joke(r.error));
  };
  const start = async () => {
    const r = await emit('host:start');
    if (!r.ok) { setErr(joke(r.error)); sfx.sad(); }
  };

  const others = s.players.filter((p) => p.id !== me.id);
  const meP = s.players.find((p) => p.id === me.id);

  return (
    <div className="screen lobby" ref={ref}>
      <header className="st lobby-head">
        <button className="room-chip" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/${s.code}`); sfx.click(); }}>
          <span>STANZA</span><b>{s.code}</b>
        </button>
      </header>

      {me.isValerio ? (
        <div className="st lobby-hero">
          <Face expr="alloro" size={170} className="breathe" track />
          <h1 className="title outline hero-title tilt-l">SEI IL<br />FESTEGGIATO</h1>
          <p className="hint">Stasera il gioco sei tu. Auguri, dottore{meta.course ? ` in ${meta.course}` : ''}{meta.university ? ` · ${meta.university}` : ''}. 🍺</p>
        </div>
      ) : (
        <div className="st lobby-hero">
          {valerio ? (
            <>
              <Face expr="alloro" size={150} className="breathe" track />
              <p className="hint">Il festeggiato è <b>{valerio.name}</b>{meta.university ? ` · ${meta.university}` : ''}</p>
            </>
          ) : (
            <>
              <Face expr="sorpreso" size={130} className="breathe" track />
              <p className="hint">{me.isHost ? 'Tocca il nome di Valerio per dargli l’alloro 🌿' : 'In attesa che l’host scelga chi è Valerio…'}</p>
            </>
          )}
        </div>
      )}

      <div className="st me-card">
        {meP && <Avatar avatar={meP.avatar} size={48} crown={me.isValerio} />}
        <div>
          <b>{meP?.name}</b>
          <span>{me.isHost ? 'Sei l’host' : 'Sei dentro!'}{s.players.length > 1 ? ` · ${s.players.length} in stanza` : ''}</span>
        </div>
      </div>

      <PlayerStickers
        players={me.isHost ? s.players : others}
        valerioId={s.valerioId}
        hostId={s.hostId}
        onTap={me.isHost ? crown : null}
      />

      {err && <p className="hint is-error">{err}</p>}
      {IS_IPHONE && <p className="hint small silent-tip">🔕 iPhone: togli il silenzioso (tasto laterale) per sentire sirene e musica</p>}

      {me.isHost ? (
        <div className="st host-dock">
          <div className="host-row">
            <Btn color={C.cyan} onClick={() => setPanel(true)} className="btn-small">Domande & foto</Btn>
            <Settings s={s} />
          </div>
          <Btn big color={s.valerioId ? C.yellow : C.cream} onClick={start} disabled={!s.valerioId} sound="boing">
            {s.valerioId ? 'START ▶' : 'Scegli Valerio'}
          </Btn>
          <p className="hint small">{s.questionCount} domande · {s.players.length} in stanza · TV: <b>{location.host}/tv/{s.code}</b></p>
        </div>
      ) : (
        <div className="st waiting-line">
          <span className="wiggle">Aspetta che l’host dia il via…</span>
          <button className="link" onClick={leave}>esci</button>
        </div>
      )}
      {panel && <HostPanel s={s} onClose={() => setPanel(false)} />}
    </div>
  );
}

function Settings({ s }) {
  const set = (patch) => emit('host:settings', patch);
  return (
    <div className="settings">
      <label className="stepper">
        <button onClick={() => set({ voteSeconds: s.settings.voteSeconds - 5 })}>−</button>
        <span>{s.settings.voteSeconds}s</span>
        <button onClick={() => set({ voteSeconds: s.settings.voteSeconds + 5 })}>+</button>
      </label>
      <span className="hint small">secondi per votare</span>
    </div>
  );
}
