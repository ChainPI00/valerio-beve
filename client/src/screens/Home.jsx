import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Face } from '../components/Face.jsx';
import { Avatar, SHAPES, AV_COLORS } from '../components/Avatar.jsx';
import { Btn, Letters, useStagger } from '../components/UI.jsx';
import { C, joke, vibrate, motion } from '../lib/theme.js';
import { emit, createRoom, joinRoom, useStore, clearLost } from '../lib/net.js';
import { sfx, unlockAudio } from '../lib/audio.js';
import { shake } from '../lib/fx.js';

export function Logo({ size = 1 }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.logo .l', { y: -120 * motion, rotate: () => gsap.utils.random(-40, 40), opacity: 0, duration: 0.7, ease: 'bounce.out', stagger: 0.05 });
      gsap.from('.logo-face', { scale: 0, rotate: -40, duration: 0.9, delay: 0.5, ease: 'elastic.out(1, 0.45)' });
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <div className="logo" ref={ref} style={{ '--s': size }}>
      <Letters text="VALERIO" className="logo-top" />
      <div className="logo-row">
        <div className="logo-face"><Face expr="alloro" size={110 * size} className="breathe" track /></div>
        <Letters text="BEVE" className="logo-bottom" />
      </div>
    </div>
  );
}

export function Home({ initialCode }) {
  const [step, setStep] = useState(initialCode ? 'name' : 'menu');
  const [code, setCode] = useState(initialCode || '');
  const lost = useStore((s) => s.lostReason);
  const kicked = useStore((s) => s.kicked);
  const notice = kicked ? joke('kicked') : lost ? joke(lost) : null;

  return (
    <div className="screen home">
      {notice && step === 'menu' && (
        <div className="toast st" onClick={clearLost}>{notice}</div>
      )}
      {step === 'menu' && <Menu onJoin={() => setStep('code')} onCreate={() => setStep('create')} />}
      {step === 'code' && <CodeStep onBack={() => setStep('menu')} onOk={(c) => { setCode(c); setStep('name'); }} />}
      {step === 'name' && <NameStep code={code} onBack={() => setStep(initialCode ? 'code' : 'code')} />}
      {step === 'create' && <NameStep create onBack={() => setStep('menu')} />}
    </div>
  );
}

function Menu({ onJoin, onCreate }) {
  const ref = useStagger([]);
  return (
    <div className="stack center grow" ref={ref}>
      <div className="st grow center-v"><Logo /></div>
      <p className="st tagline">Il gioco ufficiale della laurea.<br />Se sbaglia, beve.</p>
      <div className="st btn-col">
        <Btn big color={C.yellow} onClick={() => { unlockAudio(); onJoin(); }}>ENTRA</Btn>
        <Btn color={C.pink} onClick={() => { unlockAudio(); onCreate(); }}>Crea partita</Btn>
      </div>
      <a className="st tv-link" href="/tv">📺 Hai una TV? Apri <b>/tv</b> dal suo browser</a>
    </div>
  );
}

function CodeStep({ onBack, onOk }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const boxes = useRef(null);
  const ref = useStagger([]);
  useEffect(() => { input.current?.focus(); }, []);

  const change = async (raw) => {
    if (/\d/.test(raw)) {
      setErr('Il codice stanza è di 4 lettere. Il PIN numerico serve solo per “Crea partita”.');
      vibrate([40, 30, 40]);
    }
    let v = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (v.length > val.length) { sfx.pop(v.length * 3); vibrate(8); }
    setVal(v);
    if (!/\d/.test(raw)) setErr('');
    if (v.length === 4) {
      setBusy(true);
      const res = await emit('room:check', { code: v });
      setBusy(false);
      if (res.ok) onOk(v);
      else {
        setErr(joke(res.error));
        shake(boxes.current, { intensity: 12, duration: 0.5 });
        vibrate([60, 40, 60]);
        sfx.sad();
      }
    }
  };

  return (
    <div className="stack center grow" ref={ref} onClick={() => input.current?.focus()}>
      <BackBtn onClick={onBack} />
      <h1 className="st title outline tilt-l">CODICE<br />STANZA</h1>
      <div className="st code-boxes" ref={boxes}>
        {[0, 1, 2, 3].map((i) => (
          <div key={`${i}${val[i] || ''}`} className={`code-box ${val[i] ? 'is-filled' : ''} ${i === val.length ? 'is-active' : ''}`} style={{ '--c': [C.pink, C.yellow, C.cyan, C.orange][i] }}>
            {val[i] || ''}
          </div>
        ))}
        <input
          ref={input}
          className="code-input"
          value={val}
          onChange={(e) => change(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={4}
          disabled={busy}
          aria-label="Codice stanza"
        />
      </div>
      <p className={`st hint ${err ? 'is-error' : ''}`}>{err || 'Quattro lettere. Le trovi sul telefono di chi ha creato la partita.'}</p>
    </div>
  );
}

function NameStep({ code, create, onBack }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('vb:name') || ''; } catch { return ''; } });
  const [avatar, setAvatar] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem('vb:avatar')); if (a?.shape) return a; } catch {}
    return { shape: SHAPES[Math.floor(Math.random() * SHAPES.length)], color: AV_COLORS[Math.floor(Math.random() * 4)] };
  });
  const [plays, setPlays] = useState(true);
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  useEffect(() => {
    if (create) emit('config').then((c) => c?.pinRequired && setNeedPin(true));
  }, [create]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useRef(null);
  const ref = useStagger([]);

  const pick = (patch) => {
    setAvatar((a) => ({ ...a, ...patch }));
    sfx.boing();
    vibrate(10);
    gsap.fromTo(preview.current.firstChild, { scale: 0.7, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'elastic.out(1.1, 0.4)' });
  };

  const go = async () => {
    unlockAudio();
    if (!name.trim()) { setErr(joke('noname')); sfx.sad(); return; }
    setBusy(true);
    try { localStorage.setItem('vb:name', name.trim()); localStorage.setItem('vb:avatar', JSON.stringify(avatar)); } catch {}
    const res = create ? await createRoom({ name, avatar, plays, pin }) : await joinRoom({ code, name, avatar });
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'pin') setNeedPin(true);
      setErr(joke(res.error));
      sfx.sad();
    }
  };

  return (
    <div className="stack center grow name-step" ref={ref}>
      <BackBtn onClick={onBack} />
      <h1 className="st title outline tilt-r">{create ? 'CREA LA\nPARTITA' : 'CHI SEI?'}</h1>
      <div className="st avatar-preview" ref={preview}>
        <Avatar avatar={avatar} size={112} />
      </div>
      <input
        className="st big-input"
        placeholder="Il tuo nome"
        value={name}
        maxLength={16}
        onChange={(e) => { setName(e.target.value); setErr(''); }}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        autoComplete="off"
        enterKeyHint="go"
      />
      <div className="st picker">
        {SHAPES.map((s) => (
          <button key={s} className={`pick ${avatar.shape === s ? 'is-on' : ''}`} onClick={() => pick({ shape: s })} aria-label={s}>
            <Avatar avatar={{ shape: s, color: avatar.color }} size={40} />
          </button>
        ))}
      </div>
      <div className="st picker colors">
        {AV_COLORS.map((c) => (
          <button key={c} className={`dot ${avatar.color === c ? 'is-on' : ''}`} style={{ background: C[c] }} onClick={() => pick({ color: c })} aria-label={c} />
        ))}
      </div>
      {create && (
        <label className="st toggle">
          <input type="checkbox" checked={plays} onChange={(e) => setPlays(e.target.checked)} />
          <span className="toggle-ui" />
          <span>Gioco anch’io (non solo regia)</span>
        </label>
      )}
      {create && needPin && (
        <input
          className="st big-input small"
          placeholder="PIN host"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={8}
        />
      )}
      {err && <p className="st hint is-error">{err}</p>}
      <div className="st btn-col">
        <Btn big color={create ? C.pink : C.cyan} onClick={go} disabled={busy} sound="boing">
          {create ? 'CREA' : 'DENTRO!'}
        </Btn>
      </div>
      {!create && <p className="st hint">Stanza <b className="mono">{code}</b></p>}
    </div>
  );
}

export function BackBtn({ onClick }) {
  return (
    <button className="back" onClick={() => { sfx.click(); onClick(); }} aria-label="Indietro">
      <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  );
}
