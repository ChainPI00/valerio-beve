// Pannello asset dell'host: domande, facce di Valerio, meme, info, backup.
import { useRef, useState } from 'react';
import { Face } from './Face.jsx';
import { Rich } from './UI.jsx';
import { C, EXPRESSIONS, joke } from '../lib/theme.js';
import { emit, upload, downloadPack, importPackFile } from '../lib/net.js';
import { prepareImage } from '../lib/fx.js';
import { sfx } from '../lib/audio.js';

const TABS = [['q', 'Domande'], ['pen', 'Penitenze'], ['faces', 'Facce'], ['memes', 'Meme'], ['info', 'Info']];

export function HostPanel({ s, onClose }) {
  const [tab, setTab] = useState('q');
  const [err, setErr] = useState('');
  const op = async (o) => {
    const r = await emit('library:op', o);
    if (!r.ok) setErr(joke(r.error));
    return r.ok;
  };
  return (
    <div className="panel">
      <header className="panel-head">
        <h2 className="outline">PANNELLO HOST</h2>
        <button className="panel-close" onClick={() => { sfx.click(); onClose(); }}>Fatto</button>
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'is-on' : ''} onClick={() => { sfx.click(); setTab(k); }}>{label}</button>
        ))}
      </nav>
      {err && <p className="hint is-error" onClick={() => setErr('')}>{err}</p>}
      <div className="panel-body">
        {tab === 'q' && <Questions s={s} op={op} />}
        {tab === 'pen' && <Penances s={s} op={op} />}
        {tab === 'faces' && <Faces s={s} op={op} setErr={setErr} />}
        {tab === 'memes' && <Memes s={s} op={op} setErr={setErr} />}
        {tab === 'info' && <Info s={s} op={op} setErr={setErr} />}
      </div>
    </div>
  );
}

function Questions({ s, op }) {
  const qs = s.questions || [];
  const [bulk, setBulk] = useState('');
  const memes = s.library?.memes || [];
  const save = (list) => op({ type: 'setQuestions', questions: list });
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const l = [...qs];
    [l[i], l[j]] = [l[j], l[i]];
    save(l);
  };
  const add = () => {
    const lines = bulk.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2 && p[0].trim() && p[1].trim());
    if (!lines.length) return;
    save([...qs, ...lines.map(([x, ...y]) => ({ x: x.trim(), y: y.join('|').trim() }))]);
    setBulk('');
    sfx.pop(3);
  };
  const shuffle = () => {
    const l = [...qs];
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
    save(l);
    sfx.boing();
  };
  return (
    <div className="q-editor">
      {s.phase !== 'lobby' && <p className="hint">Le modifiche valgono dalla prossima partita.</p>}
      <label className="field">
        <span>Aggiungi domande, una per riga: <b>X | Y</b>. Metti *asterischi* sulle parole chiave.</span>
        <textarea rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Rifare la *tesi* | Rifare *Analisi 1*\nBirra calda | Spritz annacquato'} />
      </label>
      <div className="row">
        <button className="chip-btn" style={{ '--c': C.yellow }} onClick={add}>+ Aggiungi</button>
        <button className="chip-btn" style={{ '--c': C.cyan }} onClick={shuffle}>Mescola</button>
        <button className="chip-btn" style={{ '--c': C.cream }} onClick={() => confirm('Rimettere le 32 domande di default? Le tue verranno cancellate.') && op({ type: 'resetQuestions' })}>Default</button>
      </div>
      <p className="hint small">{qs.length} domande · consiglio: almeno metà scritte da voi, su Valerio.</p>
      <ol className="q-list">
        {qs.map((q, i) => (
          <li key={q.id} className="q-row">
            <span className="q-n">{i + 1}</span>
            <div className="q-text">
              <span><Rich text={q.x} /></span>
              <i>o</i>
              <span><Rich text={q.y} /></span>
              {memes.length > 0 && (
                <select value={q.memeId || ''} onChange={(e) => save(qs.map((x) => (x.id === q.id ? { ...x, memeId: e.target.value || null } : x)))}>
                  <option value="">nessun meme</option>
                  {memes.map((m) => <option key={m.id} value={m.id}>🖼 {m.name}</option>)}
                </select>
              )}
            </div>
            <div className="q-actions">
              <button onClick={() => move(i, -1)} aria-label="Su">↑</button>
              <button onClick={() => move(i, 1)} aria-label="Giù">↓</button>
              <button onClick={() => save(qs.filter((x) => x.id !== q.id))} aria-label="Elimina">✕</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Penances({ s, op }) {
  const list = s.penanceList || [];
  const [text, setText] = useState(() => list.join('\n'));
  const [saved, setSaved] = useState(true);
  const count = text.split('\n').filter((l) => l.trim()).length;
  const save = async () => {
    if (await op({ type: 'setPenances', penances: text.split('\n') })) { setSaved(true); sfx.pop(4); }
  };
  const reset = async () => {
    if (!confirm('Rimettere le penitenze di default? Le tue verranno cancellate.')) return;
    if (await op({ type: 'resetPenances' })) setSaved(true);
  };
  return (
    <div>
      <p className="hint">Quando Valerio perde si alterna: la 1ª volta penitenza, la 2ª beve, la 3ª penitenza e così via. Le penitenze escono nell’ordine di questa lista (dall’alto), poi ricominciano. Se la lista è vuota, beve sempre.</p>
      <label className="field">
        <span>Una penitenza per riga · {count} in lista</span>
        <textarea rows={14} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
      </label>
      <div className="row">
        <button className="chip-btn" style={{ '--c': saved ? C.cream : C.yellow }} onClick={save}>{saved ? 'Salvate ✓' : 'Salva penitenze'}</button>
        <button className="chip-btn" style={{ '--c': C.cream }} onClick={reset}>Default</button>
      </div>
    </div>
  );
}

function useUploader(setErr) {
  const [busy, setBusy] = useState(null);
  const run = async (key, file, opts, then) => {
    if (!file) return;
    setBusy(key);
    try {
      const blob = await prepareImage(file, opts);
      const url = await upload(blob);
      await then(url);
      sfx.pop(4);
    } catch {
      setErr(joke('upload'));
    }
    setBusy(null);
  };
  return [busy, run];
}

function Faces({ s, op, setErr }) {
  const faces = s.library?.faces || {};
  const [busy, run] = useUploader(setErr);
  return (
    <div>
      <p className="hint">Carica una foto per espressione. Meglio PNG scontornati (sfondo trasparente); se la foto ha lo sfondo la ritagliamo noi a sticker. Se manca un’espressione usiamo quella neutra, e se non c’è nessuna foto il Valerio disegnato.</p>
      <div className="faces-grid">
        {EXPRESSIONS.map(([k, label]) => (
          <div key={k} className="face-slot">
            <Face expr={k} size={92} />
            <b>{label}</b>
            <label className="chip-btn" style={{ '--c': faces[k] ? C.cream : C.yellow }}>
              {busy === k ? '…' : faces[k] ? 'Cambia' : 'Carica'}
              <input type="file" accept="image/*" hidden onChange={(e) => run(k, e.target.files[0], { max: 640, sticker: true }, (url) => op({ type: 'setFace', expr: k, url }))} />
            </label>
            {faces[k] && <button className="link" onClick={() => op({ type: 'setFace', expr: k, url: null })}>rimuovi</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Memes({ s, op, setErr }) {
  const memes = s.library?.memes || [];
  const [name, setName] = useState('');
  const [busy, run] = useUploader(setErr);
  return (
    <div>
      <p className="hint">I meme interni compaiono come sticker nel reveal della domanda a cui li associ (dalla tab Domande).</p>
      <div className="row">
        <input className="small-input" placeholder="Nome del meme" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="chip-btn" style={{ '--c': C.yellow }}>
          {busy ? '…' : '+ Carica'}
          <input type="file" accept="image/*" hidden onChange={(e) => run('m', e.target.files[0], { max: 720 }, async (url) => { await op({ type: 'addMeme', url, name: name || e.target.files[0]?.name?.replace(/\.\w+$/, '') }); setName(''); })} />
        </label>
      </div>
      <div className="memes-grid">
        {memes.map((m) => (
          <div key={m.id} className="meme-card">
            <img src={m.url} alt={m.name} />
            <span>{m.name}</span>
            <button onClick={() => op({ type: 'removeMeme', id: m.id })} aria-label="Elimina">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Info({ s, op, setErr }) {
  const meta = s.library?.meta || {};
  const [course, setCourse] = useState(meta.course || '');
  const [uni, setUni] = useState(meta.university || '');
  const file = useRef(null);
  return (
    <div className="info-tab">
      <label className="field"><span>Corso di laurea (per le battute)</span>
        <input className="small-input" value={course} onChange={(e) => setCourse(e.target.value)} onBlur={() => op({ type: 'setMeta', meta: { course, university: uni } })} placeholder="es. Ingegneria Gestionale" />
      </label>
      <label className="field"><span>Università</span>
        <input className="small-input" value={uni} onChange={(e) => setUni(e.target.value)} onBlur={() => op({ type: 'setMeta', meta: { course, university: uni } })} placeholder="es. Politecnico di Milano" />
      </label>
      <h4>Backup</h4>
      <p className="hint">Scarica un pack con domande, foto e meme. Se il server si riavvia o cambi hosting, lo reimporti in un secondo.</p>
      <div className="row">
        <button className="chip-btn" style={{ '--c': C.cyan }} onClick={() => downloadPack().catch(() => setErr(joke('server')))}>⬇ Scarica pack</button>
        <label className="chip-btn" style={{ '--c': C.cream }}>
          ⬆ Importa pack
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files[0] && importPackFile(e.target.files[0]).then(() => sfx.pop(5)).catch(() => setErr(joke('upload')))} />
        </label>
      </div>
    </div>
  );
}
