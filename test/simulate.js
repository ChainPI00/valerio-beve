// Simula una serata: 20 client finti (host + Valerio + 18 amici) contro un server vero.
// Verifica voti, scommesse, maggioranza/pareggio, reveal, riconnessione, host che esce e rientra,
// e infine 30 round di fila senza errori.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-test-'));

async function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT, DATA_DIR: dataDir, HOST_GRACE_MS: '200', HOST_PIN: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  await new Promise((res) => child.stdout.on('data', (d) => { out += d; if (out.includes('Valerio Beve')) res(); }));
  child.stdout.on('data', () => {});
  return child;
}
let server = await startServer();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

class Bot {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.connect();
  }
  connect() {
    this.socket = io(URL, { transports: ['websocket'], forceNew: true, reconnectionDelay: 300, reconnectionDelayMax: 1000 });
    this.socket.on('state', (s) => { this.state = s; });
    // come il vero client: dopo una riconnessione rientra da solo col token
    this.socket.on('connect', () => { if (this.autoResume && this.token) this.emit('room:resume', { code: this.code, token: this.token }); });
    return new Promise((r) => this.socket.once('connect', r));
  }
  emit(ev, payload = {}) {
    return new Promise((r) => this.socket.emit(ev, payload, r));
  }
  get me() { return this.state?.me; }
}

async function until(pred, label, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`Timeout: ${label}`);
    await sleep(15);
  }
}

// L'host sfoglia le pagine del reveal e la classifica fino alla domanda successiva (o alla fine)
async function advance(host) {
  for (let i = 0; i < 8; i++) {
    const ph = host.state.phase;
    if (ph !== 'reveal' && ph !== 'scores') return;
    const before = `${ph}:${host.state.revealStep}`;
    await host.emit('host:next');
    await until(() => `${host.state.phase}:${host.state.revealStep}` !== before, 'pagina successiva');
  }
}

try {
  console.log('\n🍺 Simulazione Valerio Beve\n');

  // --- lobby ---
  const host = new Bot('Host');
  await sleep(100);
  const created = await host.emit('room:create', { name: 'Host', avatar: { shape: 'star', color: 'pink' } });
  assert.ok(created.ok, 'room:create');
  const code = created.code;
  host.token = created.token;
  ok(`stanza creata: ${code}`);

  const bad = await host.emit('room:check', { code: 'ZZZZ' });
  assert.equal(bad.error, 'noroom');
  ok('codice sbagliato rifiutato');

  const valerio = new Bot('Valerio');
  const friends = Array.from({ length: 18 }, (_, i) => new Bot(i === 5 ? 'Marco' : `Amico${i}`));
  await sleep(300);
  for (const b of [valerio, ...friends]) {
    const r = await b.emit('room:join', { code, name: b.name === 'Amico6' ? 'Marco' : b.name });
    assert.ok(r.ok, `join ${b.name}`);
    b.token = r.token;
  }
  await until(() => host.state?.players.length === 20, '20 giocatori');
  ok('20 giocatori in lobby');
  const names = host.state.players.map((p) => p.name);
  assert.ok(names.includes('Marco') && names.includes('Marco 2'));
  ok('nomi duplicati con suffisso ("Marco", "Marco 2")');

  const noValerio = await host.emit('host:start');
  assert.equal(noValerio.error, 'novalerio');
  ok('start bloccato senza festeggiato');

  const valerioId = host.state.players.find((p) => p.name === 'Valerio').id;
  await host.emit('host:valerio', { playerId: valerioId });
  await host.emit('host:settings', { voteSeconds: 8 });
  const notHost = await friends[0].emit('host:start');
  assert.equal(notHost.error, 'nohost');
  ok('solo l\'host comanda');
  assert.ok((await host.emit('host:start')).ok);
  await until(() => valerio.state?.phase === 'question', 'fase domanda');
  assert.equal(valerio.me.isValerio, true);
  ok('partita avviata, Valerio marcato');

  const everyone = [host, valerio, ...friends];
  const others = [host, ...friends]; // 19 votanti "normali"

  // Gioca un round: votes = array di 'x'/'y' per others, vv = voto di Valerio
  async function playRound({ votes, vv, bets = () => 'lose', reconnect = null }) {
    await until(() => everyone.every((b) => b.state?.phase === 'question'), 'tutti in domanda');
    const round = host.state.round.index;
    for (let i = 0; i < others.length; i++) {
      if (reconnect === others[i]) continue;
      await others[i].emit('vote', { round, choice: votes[i] });
    }
    if (reconnect) {
      // telefono bloccato a metà round: stacca, ricollega, riprende e vota
      reconnect.socket.disconnect();
      await sleep(80);
      await reconnect.connect();
      const r = await reconnect.emit('room:resume', { code, token: reconnect.token });
      assert.ok(r.ok, 'resume');
      await until(() => reconnect.state?.phase === 'question' && reconnect.state.round.index === round, 'resume in domanda');
      await reconnect.emit('vote', { round, choice: votes[others.indexOf(reconnect)] });
    }
    // Il voto di Valerio non deve trapelare prima del reveal
    if (vv) await valerio.emit('vote', { round, choice: vv });
    assert.equal(friends[0].state.round.result, null);
    for (let i = 0; i < others.length; i++) await others[i].emit('bet', { round, bet: bets(i) });
    if (!vv) {
      // Valerio non vota: si chiude solo col timer. Forziamo con next? No: aspettiamo il timer.
      await until(() => host.state.phase === 'reveal', 'reveal da timer', 12000);
    }
    await until(() => everyone.every((b) => b.state?.phase === 'reveal' || b.state?.phase === 'scores'), 'tutti in reveal');
    return host.state.round.result;
  }

  // --- round 1: Valerio in maggioranza ---
  const scoreBefore = friends[1].state.players.find((p) => p.id === friends[1].me.id).score;
  let r = await playRound({ votes: Array(19).fill('x').map((v, i) => (i < 12 ? 'x' : 'y')), vv: 'x', bets: (i) => (i % 2 ? 'lose' : 'safe') });
  assert.equal(r.x, 12); assert.equal(r.y, 7); assert.equal(r.majority, 'x');
  assert.equal(r.lost, false); assert.equal(r.reason, 'majority');
  ok('maggioranza: Valerio con il gruppo → salvo');
  assert.equal(r.betStats.correct, 10); // indici pari scommettono "safe"
  await until(() => friends[1].state.players.find((p) => p.id === friends[1].me.id).score === scoreBefore + 1, 'punto scommessa');
  ok('scommesse: chi ha detto "si salva" prende +1');
  const rs = valerio.state.phaseStartsAt - valerio.state.serverNow;
  assert.ok(rs > 300 && rs <= 500, `reveal programmato nel futuro (${rs}ms)`);
  ok(`reveal con partenza sincronizzata (+${rs}ms)`);

  // --- round 2: minoranza ---
  await advance(host);
  r = await playRound({ votes: others.map((_, i) => (i < 15 ? 'y' : 'x')), vv: 'x' });
  assert.equal(r.lost, true); assert.equal(r.reason, 'minority'); assert.equal(r.unanimous, false);
  ok('minoranza: Valerio beve');

  // --- round 3: pareggio (18 votanti perché uno non vota... usiamo 19: impossibile pareggio) ---
  // Per il pareggio l'host non vota: 18 votanti 9/9
  await advance(host);
  await until(() => host.state.phase === 'question', 'q3');
  {
    const round = host.state.round.index;
    for (let i = 0; i < friends.length; i++) await friends[i].emit('vote', { round, choice: i < 9 ? 'x' : 'y' });
    await valerio.emit('vote', { round, choice: 'y' });
    for (const b of friends) await b.emit('bet', { round, bet: 'lose' });
    await host.emit('vote', { round, choice: 'x' });
  }
  // l'host ha votato x → 10/9: non è pareggio. Il pareggio pulito arriva al round 4.
  await until(() => host.state.phase !== 'question' || host.state.round.voted.length === 20, 'q3 voti');
  await host.emit('bet', { round: host.state.round.index, bet: 'lose' });
  await until(() => host.state.phase === 'reveal' || host.state.phase === 'scores', 'q3 reveal');
  assert.equal(host.state.round.result.lost, true);
  assert.equal(host.state.round.result.reason, 'minority');
  ok('10 contro 9 con Valerio nei 9 → beve');

  await advance(host);
  await until(() => host.state.phase === 'question', 'q4');
  {
    const round = host.state.round.index;
    // Kick di un amico per avere 18 votanti "altri" → 9/9
    const kicked = friends.pop();
    const kickedGotEvent = new Promise((res) => kicked.socket.once('kicked', res));
    await host.emit('host:kick', { playerId: kicked.me.id });
    await kickedGotEvent;
    ok('host espelle un giocatore');
    everyone.splice(everyone.indexOf(kicked), 1);
    others.splice(others.indexOf(kicked), 1);
    kicked.socket.disconnect();
    for (let i = 0; i < others.length; i++) await others[i].emit('vote', { round, choice: i < 9 ? 'x' : 'y' });
    await valerio.emit('vote', { round, choice: 'y' });
    for (const b of others) await b.emit('bet', { round, bet: 'lose' });
    await until(() => host.state.phase === 'reveal', 'q4 reveal');
    r = host.state.round.result;
    assert.equal(r.majority, 'tie'); assert.equal(r.lost, true); assert.equal(r.reason, 'tie');
    ok('pareggio 9-9: Valerio beve comunque');
  }

  // --- round 5: unanimità contro Valerio + voti in ritardo ignorati ---
  await advance(host);
  r = await playRound({ votes: others.map(() => 'x'), vv: 'y' });
  assert.equal(r.unanimous, true); assert.equal(r.sameAsValerio, 0);
  ok('UNICO CONTRO TUTTI rilevato');
  const late = await friends[0].emit('vote', { round: host.state.round.index, choice: 'y' });
  assert.equal(late.accepted, false);
  ok('voto arrivato dopo la chiusura ignorato');
  assert.equal(r.onFire, true); assert.equal(r.streak, 4);
  ok('streak di 3 bevute → IN FIAMME');

  // --- round 6: riconnessione a metà round ---
  await advance(host);
  const phoenix = friends[3];
  r = await playRound({ votes: others.map((_, i) => (i % 3 ? 'x' : 'y')), vv: 'x', reconnect: phoenix });
  assert.ok(r.voters.some((v) => v.id === phoenix.me.id));
  assert.equal(phoenix.me.vote, 'x');
  ok('telefono bloccato e riaperto: rientra, stesso nome, vota');

  // --- round 7: host esce → pausa, rientra → riprende ---
  await advance(host);
  await until(() => host.state.phase === 'question', 'q7');
  host.socket.disconnect();
  await until(() => valerio.state.paused === true && valerio.state.pauseReason === 'host', 'pausa host', 2000);
  assert.equal(valerio.state.phaseEndsAt, null);
  ok('host disconnesso → partita in pausa, timer congelato');
  await host.connect();
  assert.ok((await host.emit('room:resume', { code, token: host.token })).ok);
  await until(() => valerio.state.paused === false && valerio.state.phaseEndsAt > valerio.state.serverNow, 'ripresa');
  ok('host rientra → la partita riprende');

  // --- round 7 senza voto di Valerio: chiude il timer e beve ---
  {
    const round = host.state.round.index;
    for (const b of others) { await b.emit('vote', { round, choice: 'x' }); await b.emit('bet', { round, bet: 'safe' }); }
    await sleep(200);
    assert.equal(host.state.phase, 'question');
    ok('senza il voto di Valerio il round aspetta');
    await host.emit('host:settings', { voteSeconds: 8 });
  }
  // Nuovo arrivato a partita iniziata
  const lateBot = new Bot('Ritardatario');
  await sleep(150);
  const lj = await lateBot.emit('room:join', { code, name: 'Ritardatario' });
  lateBot.token = lj.token;
  assert.ok(lj.ok);
  await until(() => lateBot.state?.phase === 'question', 'late state');
  assert.equal(lateBot.me.eligible, false);
  const lv = await lateBot.emit('vote', { round: lateBot.state.round.index, choice: 'x' });
  assert.equal(lv.accepted, false);
  ok('chi entra a partita iniziata aspetta il round successivo');
  await until(() => host.state.phase === 'reveal' || host.state.phase === 'scores', 'timer scade', 12000);
  assert.equal(host.state.round.result.reason, 'novote');
  assert.equal(host.state.round.result.lost, true);
  ok('Valerio non vota → perde per diserzione');
  await sleep(400);
  assert.equal(host.state.phase, 'reveal');
  assert.equal(host.state.revealStep, 0);
  ok('il reveal resta fermo sull\'esito finché l\'host non va avanti');
  await host.emit('host:next');
  await until(() => host.state.phase === 'scores', 'classifica');
  ok('un AVANTI dell\'host porta dall\'esito alla classifica');
  const notHostNext = await friends[0].emit('host:next');
  assert.equal(notHostNext.error, 'nohost');
  ok('solo l\'host gira pagina');

  await advance(host);
  await until(() => lateBot.state?.phase === 'question' && lateBot.me.eligible, 'late eligible');
  ok('il ritardatario gioca dal round successivo');
  everyone.push(lateBot); others.push(lateBot);

  // --- maratona: fino a 30 round totali ---
  const errors = [];
  const fates = { drink: 0, penance: 0 };
  const penanceTexts = [];
  for (const b of everyone) b.socket.on('connect_error', (e) => errors.push(e));
  let played = host.state.round.index;
  while (host.state.phase !== 'end' && played < 30) {
    await until(() => host.state.phase === 'question', `maratona q${played}`);
    const round = host.state.round.index;
    const flip = Math.random();
    await Promise.all(others.map((b) => b.emit('vote', { round, choice: Math.random() < flip ? 'x' : 'y' })));
    await valerio.emit('vote', { round, choice: Math.random() < 0.5 ? 'x' : 'y' });
    await Promise.all(others.map((b) => b.emit('bet', { round, bet: Math.random() < 0.5 ? 'lose' : 'safe' })));
    await until(() => host.state.phase === 'reveal' || host.state.phase === 'scores', `maratona reveal ${round}`);
    const res = host.state.round.result;
    const exp = res.x === res.y ? true : (res.x > res.y ? 'x' : 'y') !== res.valerioVote;
    assert.equal(res.lost, exp, `round ${round}`);
    if (res.lost) {
      const lossesBefore = res.drinksTotal + res.penancesTotal - 1;
      assert.equal(res.punishment.type, lossesBefore % 2 === 0 ? 'penance' : 'drink', 'alternanza penitenza/bevuta');
      if (res.punishment.type === 'penance') { assert.ok(res.punishment.text); penanceTexts.push(res.punishment.text); }
      fates[res.punishment.type]++;
    } else assert.equal(res.punishment, null);
    played = round + 1;
    await advance(host);
    await until(() => host.state.phase !== 'reveal' && host.state.phase !== 'scores', 'dopo next');
  }
  if (host.state.phase !== 'end') await host.emit('host:end');
  await until(() => everyone.every((b) => b.state?.phase === 'end'), 'fine');
  assert.equal(errors.length, 0);
  const fin = host.state.final;
  assert.equal(fin.drinks, host.state.drinks);
  assert.ok(fin.highlights.length <= 3);
  assert.ok(fin.highlights.every((h, i, a) => i === 0 || a[i - 1].isolation >= h.isolation));
  ok(`maratona completata: ${fin.rounds} round, Valerio: ${fin.drinks} bevute + ${fin.penances} penitenze, 0 errori`);
  assert.ok(Math.abs(fates.drink - fates.penance) <= 1, `alternanza (beve ${fates.drink}, penitenza ${fates.penance})`);
  ok(`sconfitte alternate: penitenza, beve, penitenza… (${fates.penance} penitenze, ${fates.drink} bevute)`);
  const DEFAULT_PEN = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', 'penances.default.json'), 'utf8'));
  const firstPen = penanceTexts.length ? DEFAULT_PEN.indexOf(penanceTexts[0]) : 0;
  penanceTexts.forEach((t, i) => assert.equal(t, DEFAULT_PEN[(firstPen + i) % DEFAULT_PEN.length], 'ordine della lista'));
  ok('le penitenze escono nell\'ordine della lista');
  const board = host.state.leaderboard;
  assert.ok(board.every((b, i, a) => i === 0 || a[i - 1].score >= b.score));
  assert.ok(!board.some((b) => b.id === valerioId));
  ok('classifica scommettitori ordinata, Valerio escluso');

  // --- doppio tocco dell'host: nessuna domanda saltata ---
  await host.emit('host:restart');
  await until(() => host.state.phase === 'lobby', 'lobby');
  await host.emit('host:start');
  await until(() => host.state.phase === 'question', 'nuova partita');
  {
    const round = host.state.round.index;
    for (const b of others) { await b.emit('vote', { round, choice: 'x' }); await b.emit('bet', { round, bet: 'safe' }); }
    await valerio.emit('vote', { round, choice: 'x' });
    await until(() => host.state.phase === 'reveal', 'reveal');
    await Promise.all([host.emit('host:next', { expect: 'reveal' }), host.emit('host:next', { expect: 'reveal' })]);
    await until(() => host.state.phase === 'scores', 'classifica');
    const r1 = await host.emit('host:next', { expect: 'scores' });
    const r2 = await host.emit('host:next', { expect: 'scores' });
    assert.ok(r1.ok);
    assert.equal(r2.error, 'stale');
    await until(() => host.state.phase === 'question', 'domanda 2');
    await sleep(200);
    assert.equal(host.state.round.index, round + 1);
    ok('doppio tocco dell\'host su AVANTI/PROSSIMA: nessuna domanda saltata');
  }

  // --- telefono cambiato: si rientra col proprio nome ---
  {
    const victim = friends[2];
    const id = victim.me.id;
    const name = host.state.players.find((p) => p.id === id).name;
    const token = victim.token;
    const count = host.state.players.length;
    victim.socket.disconnect();
    await until(() => !host.state.players.find((p) => p.id === id).connected, 'scollegato');
    const nb = new Bot('nuovo telefono');
    await sleep(200);
    // prima il server chiede "sei tu?" (potrebbe essere un altro con lo stesso nome)
    const ask = await nb.emit('room:join', { code, name: name.toUpperCase() });
    assert.equal(ask.error, 'samename');
    assert.equal(ask.other.name, name);
    // "No, sono un altro": entra come nuovo giocatore con il suffisso
    const other = new Bot('omonimo');
    await sleep(200);
    const ro = await other.emit('room:join', { code, name, reclaim: false });
    assert.ok(ro.ok && !ro.reclaimed);
    await until(() => other.me && other.me.id !== id, 'omonimo nuovo');
    assert.ok(host.state.players.some((p) => p.name === `${name} 2`));
    ok('stesso nome di uno scollegato: "sei tu?" → "no" = nuovo giocatore, niente fusioni');
    await host.emit('host:kick', { playerId: other.me.id });
    other.socket.disconnect();
    const r = await nb.emit('room:join', { code, name: name.toUpperCase(), reclaim: true });
    assert.ok(r.ok && r.reclaimed);
    assert.equal(r.token, token);
    nb.token = token;
    await until(() => nb.me?.id === id, 'stesso giocatore');
    assert.equal(host.state.players.length, count);
    friends[2] = nb;
    everyone[everyone.indexOf(victim)] = nb;
    others[others.indexOf(victim)] = nb;
    ok('telefono cambiato: "sei tu?" → "sì" = rientra col suo nome, posto e punti');

    // l'host senza PIN configurato non si può "rubare" col nome
    const hostName = host.state.players.find((p) => p.id === host.state.hostId).name;
    host.socket.disconnect();
    await until(() => !friends[0].state.players.find((p) => p.id === friends[0].state.hostId).connected, 'host offline');
    const thief = new Bot('ladro');
    await sleep(200);
    const rt = await thief.emit('room:join', { code, name: hostName, reclaim: true });
    assert.ok(rt.ok && !rt.reclaimed);
    await until(() => thief.me, 'ladro dentro');
    assert.equal(thief.me.isHost, false);
    ok('nessuno diventa host scrivendo il suo nome');
    await host.connect();
    assert.ok((await host.emit('room:resume', { code, token: host.token })).ok);
    await until(() => host.me?.isHost && !host.state.paused, 'host di nuovo dentro');
    await host.emit('host:kick', { playerId: thief.me.id });
    thief.socket.disconnect();

    // il voto di chi viene espulso non conta
    const round = host.state.round.index;
    const kickMe = new Bot('Espulso');
    await sleep(200);
    await kickMe.emit('room:join', { code, name: 'Espulso' });
    await until(() => kickMe.me, 'espulso dentro');
    // entra a domanda in corso: non vota questo round. Basta verificare che un voto rifiutato non resti
    const kv = await kickMe.emit('vote', { round, choice: 'x' });
    assert.equal(kv.accepted, false);
    await host.emit('host:kick', { playerId: kickMe.me.id });
    kickMe.socket.disconnect();
    // pausa manuale accettata solo durante la domanda
    assert.ok((await host.emit('host:pause')).ok);
    assert.ok((await host.emit('host:resume')).ok);
    ok('pausa e ripresa della regia');
  }

  // --- telefono di Valerio morto: non si ruba il ruolo, l'host sposta la corona ---
  let v2;
  {
    valerio.socket.disconnect();
    await until(() => !host.state.players.find((p) => p.id === valerioId).connected, 'valerio offline');
    v2 = new Bot('Valerio');
    await sleep(200);
    const r = await v2.emit('room:join', { code, name: 'Valerio' });
    assert.ok(r.ok && !r.reclaimed);
    v2.token = r.token;
    await until(() => v2.me, 'v2 dentro');
    assert.notEqual(v2.me.id, valerioId);
    const notNow = await host.emit('host:valerio', { playerId: v2.me.id });
    assert.equal(notNow.error, 'notnow');
    const round = host.state.round.index;
    for (const b of others) { await b.emit('vote', { round, choice: 'y' }); await b.emit('bet', { round, bet: 'lose' }); }
    await until(() => host.state.phase === 'reveal', 'reveal col timer', 15000);
    await host.emit('host:next', { expect: 'reveal' });
    await until(() => host.state.phase === 'scores', 'classifica');
    const lateP = await host.emit('host:pause');
    assert.equal(lateP.error, 'stale');
    ok('una "pausa" arrivata fuori dalla domanda viene ignorata (niente pausa bloccata)');
    assert.ok((await host.emit('host:valerio', { playerId: v2.me.id })).ok);
    await until(() => host.state.valerioId === v2.me.id, 'corona spostata');
    await host.emit('host:next', { expect: 'scores' });
    await until(() => v2.state?.phase === 'question' && v2.me.isValerio && v2.me.eligible, 'nuovo valerio in gioco');
    assert.equal(host.state.valerioName, 'Valerio');
    ok('telefono di Valerio morto: l\'host gli sposta la corona tra un round e l\'altro');
  }

  // --- il server si riavvia a metà domanda: si riprende da dove si era ---
  {
    const bots = [...others, v2];
    for (const b of bots) { b.code = code; b.autoResume = true; }
    const round = host.state.round.index;
    for (const b of others.slice(0, 5)) await b.emit('vote', { round, choice: 'y' });
    await until(() => host.state.round.voted.length >= 5, 'voti prima del riavvio');
    const board = JSON.stringify(host.state.leaderboard);
    const voted = [...host.state.round.voted].sort().join();
    await sleep(1400); // il salvataggio su disco avviene al massimo una volta al secondo
    const killedAt = Date.now();
    server.kill();
    await new Promise((r) => server.once('exit', r));
    server = await startServer();
    await until(() => host.state?.serverNow > killedAt && host.socket.connected, 'host rientrato dopo il riavvio', 20000);
    await until(() => bots.every((b) => b.state?.serverNow > killedAt), 'tutti rientrati', 20000);
    assert.equal(host.state.phase, 'question');
    assert.equal(host.state.round.index, round);
    assert.equal([...host.state.round.voted].sort().join(), voted);
    assert.equal(JSON.stringify(host.state.leaderboard), board);
    assert.ok(host.state.phaseEndsAt - host.state.serverNow > 5000, 'tempo per rientrare');
    for (const b of others.slice(5)) await b.emit('vote', { round, choice: 'x' });
    await v2.emit('vote', { round, choice: 'x' });
    for (const b of others) await b.emit('bet', { round, bet: 'lose' });
    await until(() => host.state.phase === 'reveal', 'il round si chiude dopo il riavvio', 20000);
    ok('server riavviato a metà domanda: tutti rientrano da soli, voti e punti intatti');
  }

  // --- libreria ---
  const lib = await host.emit('library:op', { type: 'setQuestions', questions: [{ x: 'A', y: 'B' }, { x: '', y: 'no' }] });
  assert.ok(lib.ok);
  await until(() => host.state.questions?.length === 1, 'domande aggiornate');
  assert.equal(friends[0].state.questions, undefined);
  ok('pannello domande (solo l\'host vede la lista)');
  await host.emit('library:op', { type: 'resetQuestions' });

  console.log(`\n✅ ${passed} verifiche passate\n`);
  for (const b of everyone) b.socket.disconnect();
  server.kill();
  process.exit(0);
} catch (err) {
  console.error('\n❌', err);
  server.kill();
  process.exit(1);
}
