// Il reveal: scorre tutto di fila (gruppo → pendolo di Valerio → verdetto → scommessa), parte nello
// stesso istante su tutti i dispositivi (phaseStartsAt) e poi resta fermo sull'esito, così si legge.
// L'host preme AVANTI per la classifica. Chi si collega a metà salta al punto giusto.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Face } from '../components/Face.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Rich, plain } from '../components/UI.jsx';
import { C, pairColors, vibrate, motion } from '../lib/theme.js';
import { serverNow, emitReliable } from '../lib/net.js';
import { sfx, atServer, music, createBus, withBus, closeBus } from '../lib/audio.js';
import { burst, shake, loadImage, clearConfetti } from '../lib/fx.js';
import { faceUrl } from '../components/Face.jsx';

const T = { bars: 0.5, face: 3.0, stop: 5.0, verdict: 5.5 };

export function Reveal({ s, tv = false }) {
  const r = s.round;
  const res = r.result;
  const me = s.me;
  const root = useRef(null);
  const shakeBox = useRef(null);
  const [cx, cy] = pairColors(r.pair);
  const byId = useMemo(() => Object.fromEntries(s.players.map((p) => [p.id, p])), [s.players]);
  const votersX = res.voters.filter((v) => v.choice === 'x');
  const votersY = res.voters.filter((v) => v.choice === 'y');
  const myBet = me && res.bets[me.id];
  const meme = r.question.memeId && s.library?.memes?.find((m) => m.id === r.question.memeId);
  const faces = s.library?.faces;

  const lost = res.lost;
  const fate = res.punishment?.type; // 'drink' | 'penance' | undefined
  const betT = lost ? 8.8 : 8.2;
  const END = betT + 0.8;
  const tlRef = useRef(null);
  const [done, setDone] = useState(false);
  const banner = lost
    ? res.reason === 'novote' ? 'NON HA SCELTO = PERDE'
      : res.reason === 'tie' ? (res.n ? 'PAREGGIO = PERDE' : 'NESSUNO HA VOTATO')
      : res.unanimous ? 'UNICO CONTRO TUTTI'
      : `IN MINORANZA · ${res.sameAsValerio + 1} CONTRO ${res.n - res.sameAsValerio}`
    : `CON IL GRUPPO · ${res.valerioVote === 'x' ? res.pctX : res.pctY}%`;

  useLayoutEffect(() => {
    const el = root.current;
    const q = gsap.utils.selector(el);
    const stageW = () => q('.rv-stage')[0]?.clientWidth || 300;
    const side = (v) => (v === 'x' ? -1 : v === 'y' ? 1 : 0) * stageW() * 0.25;
    const images = [loadImage(faceUrl(faces, 'disperato'))].filter(Boolean);

    music.hold('reveal');
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true });

      // 0.0 buio
      tl.fromTo('.rv-dark', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0)
        .from('.rv-q', { y: -60, scale: 0.7, opacity: 0, duration: 0.5, ease: 'back.out(2)' }, 0.1)
        .from('.rv-label', { y: 40, opacity: 0, duration: 0.4, stagger: 0.1, ease: 'back.out(2)' }, 0.25);

      // 0.5 il gruppo: barre che si riempiono dal basso, avatar che volano nella colonna
      tl.fromTo('.rv-bar', { scaleY: 0 }, { scaleY: 1, duration: 1.6, ease: 'elastic.out(1, 0.55)', stagger: 0.12 }, T.bars);
      ['x', 'y'].forEach((k) => {
        const target = k === 'x' ? res.pctX : res.pctY;
        const o = { v: 0 };
        tl.to(o, {
          v: target, duration: 1.3, ease: 'power2.out',
          onUpdate: () => { const n = q(`.rv-pct-${k} b`)[0]; if (n) n.textContent = Math.round(o.v); },
        }, T.bars + 0.1);
      });
      tl.from('.rv-av', { y: -320 * motion, x: () => gsap.utils.random(-80, 80), scale: 0, rotate: () => gsap.utils.random(-90, 90), duration: 0.7, ease: 'back.out(1.8)', stagger: { each: 0.035, from: 'random' } }, T.bars + 0.3);

      // 3.0 suspense: Valerio oscilla come un pendolo, sempre più veloce
      tl.fromTo('.rv-pendulum', { y: -200, scale: 0 }, { y: 0, scale: 1, duration: 0.45, ease: 'back.out(2)' }, T.face);
      const swings = [0.42, 0.34, 0.27, 0.21, 0.16, 0.12, 0.09];
      let t = T.face + 0.2;
      swings.forEach((d, i) => {
        tl.to('.rv-pendulum', { x: () => stageW() * 0.25 * (i % 2 ? 1 : -1), rotate: i % 2 ? 14 : -14, duration: d, ease: 'sine.inOut' }, t);
        t += d;
      });
      // 5.0 stop secco sulla sua scelta
      tl.to('.rv-pendulum', { x: () => side(res.valerioVote), rotate: 0, duration: 0.14, ease: 'power4.out' }, T.stop)
        .to('.rv-pendulum', { scale: 1.25, duration: 0.08, yoyo: true, repeat: 1 }, T.stop)
        .call(() => { shake(shakeBox.current, { intensity: 10, duration: 0.35 }); vibrate(60); }, null, T.stop)
        .to(res.valerioVote ? `.rv-col-${res.valerioVote === 'x' ? 'y' : 'x'}` : '.rv-col', { opacity: res.valerioVote ? 0.35 : 1, duration: 0.3 }, T.stop + 0.1);

      // 5.5 verdetto
      tl.set('.rv-verdict', { display: 'flex' }, T.verdict);
      if (lost) {
        const chaos = () => {
          shake(shakeBox.current?.parentElement, { intensity: 22 * (res.unanimous ? 1.4 : 1), duration: res.unanimous ? 2.2 : 1.5 });
          vibrate([300, 100, 300, 100, 700]);
          const colors = fate === 'drink' ? [C.siren, C.yellow, C.cream, C.pink] : [C.pink, C.cyan, C.yellow, C.cream];
          for (let i = 0; i < (res.unanimous ? 2 : 1); i++) {
            setTimeout(() => {
              burst({ x: 0.1, y: 1, angle: -Math.PI / 3, spread: 1, count: 55, power: 1.5, colors, images, imageShare: 0.18 });
              burst({ x: 0.9, y: 1, angle: (-2 * Math.PI) / 3, spread: 1, count: 55, power: 1.5, colors, images, imageShare: 0.18 });
            }, i * 700);
          }
        };
        // 5.5 ha perso: sirena, lettere che sbattono (BEVE o PENITENZA, alternati), caos
        tl.set('.rv-siren', { display: 'block' }, T.verdict)
          .fromTo('.rv-siren', { backgroundColor: C.siren }, { backgroundColor: C.night, duration: 0.35 / Math.max(0.5, motion), ease: 'steps(1)', repeat: 9, yoyo: true }, T.verdict)
          .fromTo('.rv-title .l', { scale: 4, opacity: 0, rotate: () => gsap.utils.random(-30, 30) }, {
            scale: 1, opacity: 1, rotate: () => gsap.utils.random(-6, 6), duration: 0.16, ease: 'power4.in', stagger: 0.085,
          }, T.verdict)
          .call(chaos, null, T.verdict + 0.95)
          .fromTo('.rv-bigface', { scale: 0, rotate: -200 }, { scale: 1, rotate: 0, duration: 0.8, ease: 'back.out(1.6)' }, T.verdict + 0.95)
          .to('.rv-bigface', { scale: 1.1, rotate: 8, duration: 0.22, yoyo: true, repeat: 7, ease: 'sine.inOut' }, T.verdict + 1.75)
          .fromTo('.rv-penance', { scale: 0, rotate: 12 }, { scale: 1, rotate: -2, duration: 0.6, ease: 'back.out(2)' }, T.verdict + 1.3);
      } else {
        tl.set('.rv-saved', { display: 'block' }, T.verdict)
          .fromTo('.rv-saved', { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(80% at 50% 50%)', duration: 0.7, ease: 'power2.out' }, T.verdict)
          .fromTo('.rv-bigface', { y: -500, rotate: 0, scale: 1 }, { y: 0, duration: 0.9, ease: 'bounce.out' }, T.verdict + 0.1)
          .fromTo('.rv-bigface .face-shades', { y: -400, rotate: -30, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.7, ease: 'bounce.out' }, T.verdict + 1.0)
          .fromTo('.rv-title .l', { y: 80, opacity: 0, scale: 0.5 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)', stagger: 0.07 }, T.verdict + 0.3)
          .call(() => burst({ x: 0.5, y: 0.45, count: 50, power: 0.9, colors: [C.cream, C.yellow, C.night] }), null, T.verdict + 0.4);
      }
      const after = T.verdict;
      tl.fromTo('.rv-banner', { scale: 0, rotate: -10 }, { scale: 1, rotate: -3, duration: 0.5, ease: 'back.out(3)' }, after + (lost ? 1.4 : 1.2))
        .fromTo('.rv-fire', { scale: 0 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' }, after + 1.8)
        .fromTo('.rv-meme', { scale: 0, rotate: 30 }, { scale: 1, rotate: 6, duration: 0.6, ease: 'back.out(2)' }, after + 2);

      // esito scommessa / riepilogo, poi la timeline si ferma sull'esito
      tl.fromTo('.rv-bet', { yPercent: 160, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(1.8)' }, betT);
      if (!tv && myBet?.correct) tl.call(() => burst({ x: 0.5, y: 0.9, count: 30, power: 0.8, colors: [C.cyan, C.cream, C.yellow] }), null, betT + 0.2);
      if (!tv && myBet && !myBet.correct) tl.to('.rv-bet .avatar', { scaleY: 0.6, y: 12, duration: 0.5, ease: 'power2.in' }, betT + 0.5);

      tl.to({}, { duration: END - tl.duration() > 0 ? END - tl.duration() : 0.01 });
      tl.eventCallback('onComplete', () => setDone(true));
      tlRef.current = tl;
    }, el);
    return () => { tlRef.current = null; ctx.revert(); clearConfetti(); music.release('reveal'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.index]);

  // Suoni schedulati sull'orologio audio + timeline posizionata sul tempo del server
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    const st = s.phaseStartsAt;
    const at = (t) => atServer(st + t * 1000);
    const future = (t) => serverNow() < st + t * 1000 - 40;

    // tutti i suoni del reveal passano da un bus che si chiude quando il reveal esce di scena
    const bus = createBus();
    withBus(bus, () => {
      if (future(T.face)) sfx.drumroll(at(T.face), T.stop - T.face);
      if (future(T.stop)) sfx.thud(at(T.stop));
      if (lost) {
        if (future(T.verdict + 0.95)) fate === 'drink' ? sfx.drink(at(T.verdict + 0.95)) : sfx.penance(at(T.verdict + 0.95));
        const letters = fate === 'drink' ? 11 : 10;
        for (let i = 0; i < letters; i++) if (future(T.verdict + i * 0.085)) sfx.slam(at(T.verdict + i * 0.085));
      } else if (future(T.verdict)) sfx.saved(at(T.verdict));
      if (!tv && myBet && future(betT)) (myBet.correct ? sfx.chaching : sfx.sad)(at(betT));
    });

    const go = () => {
      const elapsed = Math.max(0, (serverNow() - st) / 1000);
      if (elapsed >= END) { tl.progress(1, true); setDone(true); return; }
      tl.seek(elapsed, true).play();
    };
    const wait = st - serverNow();
    let id = null;
    if (wait > 0) id = setTimeout(go, wait);
    else go();
    return () => { clearTimeout(id); closeBus(bus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phaseStartsAt, r.index]);

  const title = !lost ? ['SALVO'] : fate === 'drink' ? ['VALERIO', 'BEVE'] : ['PENITENZA!'];
  let li = 0;

  return (
    <div className={`screen reveal ${tv ? 'is-tv' : ''} ${me?.isHost ? 'has-next' : ''}`} ref={root} style={{ '--x': cx, '--y': cy }}>
      <div className="rv-dark" />
      <div className="rv-shake" ref={shakeBox}>
        <div className="rv-q">
          <span style={{ color: cx }}>{plain(r.question.x)}</span>
          <i>o</i>
          <span style={{ color: cy }}>{plain(r.question.y)}</span>
        </div>
        <div className="rv-stage">
          {[['x', votersX, res.pctX, cx, r.question.x], ['y', votersY, res.pctY, cy, r.question.y]].map(([k, voters, pct, color, text]) => (
            <div key={k} className={`rv-col rv-col-${k}`}>
              <div className={`rv-pct rv-pct-${k}`}><b>0</b>%</div>
              <div className="rv-track">
                <div className="rv-bar" style={{ '--c': color, height: `${Math.max(6, pct)}%` }} />
                <div className="rv-avs">
                  {voters.map((v) => byId[v.id] && (
                    <Avatar key={v.id} className="rv-av" avatar={byId[v.id].avatar} size={tv ? 46 : 30} />
                  ))}
                </div>
              </div>
              <div className="rv-label" style={{ '--c': color }}><Rich text={text} /></div>
            </div>
          ))}
          <div className="rv-pendulum">
            <Face expr="sorpreso" size={tv ? 150 : 96} />
          </div>
        </div>
      </div>

      {lost ? <div className="rv-siren" /> : <div className="rv-saved" />}

      <div className={`rv-verdict ${!lost ? 'is-safe' : fate === 'drink' ? 'is-drink' : 'is-drink is-penance'}`}>
        <div className="rv-bigface">
          <Face
            expr={lost ? 'disperato' : 'felice'}
            size={(tv ? Math.min(340, innerHeight * 0.28) : Math.min(210, innerHeight * 0.27)) * (fate === 'penance' ? 0.75 : 1)}
            shades={!lost}
          />
        </div>
        <div className="rv-titlebox">
          <h1 className="rv-title">
            {title.map((w) => (
              <span key={w} className="rv-word">
                {[...w].map((ch) => <span key={li} className="l" style={{ '--i': li++ }}>{ch}</span>)}
              </span>
            ))}
          </h1>
        </div>
        {fate === 'penance' && (
          <div className={`rv-penance ${res.punishment.text.length > 90 ? 'is-long' : res.punishment.text.length > 55 ? 'is-mid' : ''}`}>
            {res.punishment.text}
          </div>
        )}
        <div className="rv-banner">{banner}</div>
        {res.onFire && <div className="rv-fire">🔥 IN FIAMME · {res.streak} DI FILA</div>}
        {meme && <img className="rv-meme" src={meme.url} alt={meme.name} />}
      </div>

      <BetResult s={s} res={res} tv={tv} myBet={myBet} />
      {me?.isHost && done && <NextButton />}
    </div>
  );
}

// Compare solo a fine animazione: si legge l'esito, poi l'host porta tutti alla classifica
function NextButton() {
  const busy = useRef(false);
  return (
    <button
      className="rv-next"
      onClick={() => {
        if (busy.current) return;
        busy.current = true;
        sfx.click();
        // se dopo i tentativi non è passato (rete assente), il bottone si riattiva
        emitReliable('host:next', { expect: 'reveal' }).then((r) => { if (!r.ok && r.error !== 'stale') busy.current = false; });
      }}
    >
      CLASSIFICA ▶
    </button>
  );
}

function Tally({ res }) {
  return <span className="rv-drinks">🍺 × {res.drinksTotal} · 🎭 × {res.penancesTotal}</span>;
}

function BetResult({ s, res, tv, myBet }) {
  const me = s.me;
  if (tv || !me) {
    return (
      <div className="rv-bet is-summary">
        <b>{res.betStats.correct}</b> hanno indovinato · <b>{res.betStats.wrong}</b> no
        <Tally res={res} />
      </div>
    );
  }
  if (me.isValerio) {
    const fate = res.punishment?.type;
    return (
      <div className="rv-bet is-summary" style={{ '--c': !res.lost ? C.cyan : fate === 'drink' ? C.yellow : C.pink }}>
        <span>{!res.lost ? 'Per stavolta ti è andata bene.' : fate === 'drink' ? 'Alla salute, dottore.' : 'Penitenza! Tocca a te, dottore.'}</span>
        <Tally res={res} />
      </div>
    );
  }
  if (!myBet) {
    return (
      <div className="rv-bet" style={{ '--c': C.cream }}>
        <span>Non hai scommesso.</span><b>Zero punti.</b>
      </div>
    );
  }
  const meP = s.players.find((p) => p.id === me.id);
  return (
    <div className={`rv-bet ${myBet.correct ? 'is-win' : 'is-lose'}`} style={{ '--c': myBet.correct ? C.cyan : C.cream }}>
      {meP && <Avatar avatar={meP.avatar} size={52} mood={myBet.correct ? 'ok' : 'sad'} />}
      <b>{myBet.correct ? 'HAI VINTO +1' : 'HAI SBAGLIATO · 0'}</b>
    </div>
  );
}
