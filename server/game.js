// Stato autoritativo di una partita. I client mostrano solo quello che dice il server.
import crypto from 'node:crypto';

export const REVEAL_LEAD_MS = 500; // ritardo programmato: tutti ricevono l'evento prima che parta
export const REVEAL_STEPS = 1; // il reveal scorre tutto di fila e si ferma sull'esito; AVANTI porta alla classifica
const STEP_LEAD_MS = 350; // ogni pagina parte un filo nel futuro, così arriva a tutti prima di iniziare
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS || 3000);
const RESTORE_GRACE_MS = 15000; // dopo un riavvio del server, tempo minimo per ricollegarsi e votare
export const MAX_PLAYERS = 40; // margine se alla festa arriva più gente del previsto
export const COLOR_PAIRS = 6; // coppie di colori X/Y, il client le mappa sulla palette

const token = () => crypto.randomBytes(16).toString('base64url');
const pid = () => crypto.randomBytes(5).toString('base64url');
// Array.from: non spezza le emoji (coppie surrogate) quando si taglia a 16 caratteri
const cut = (s, n) => Array.from(s).slice(0, n).join('');
const cleanName = (s) => cut(String(s ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim(), 16).trim();
export const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// Un errore dentro un timer farebbe cadere tutto il processo: lo logghiamo e andiamo avanti
function safe(fn, label) {
  return () => {
    try { fn(); } catch (err) { console.error(`[timer ${label}]`, err); }
  };
}

const SHAPES = ['blob', 'star', 'flower', 'squircle', 'triangle', 'ghost'];
const COLORS = ['pink', 'yellow', 'cyan', 'orange', 'cream'];
function cleanAvatar(a) {
  return {
    shape: SHAPES.includes(a?.shape) ? a.shape : SHAPES[Math.floor(Math.random() * SHAPES.length)],
    color: COLORS.includes(a?.color) ? a.color : COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

export class GameError extends Error {}

export class Room {
  constructor(code, { getQuestions, getPenances = () => [], onChange }) {
    this.code = code;
    this.getQuestions = getQuestions;
    this.getPenances = getPenances;
    this.onChange = onChange;
    this.players = new Map(); // id -> player
    this.sockets = new Map(); // socketId -> { playerId | null, screen: bool }
    this.hostId = null;
    this.valerioId = null;
    this.valerioName = null; // resta "Valerio" anche se la corona passa a "Valerio 2" (telefono cambiato)
    this.settings = { voteSeconds: 25 };
    this.restoredUntil = 0;
    this.lastActivity = Date.now();
    this.hostGraceTimer = null;
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.phaseStartsAt = Date.now();
    this.phaseEndsAt = null;
    this.paused = false;
    this.pauseReason = null;
    this.pausedRemaining = null;
    this.questions = [];
    this.qIndex = -1;
    this.round = null;
    this.history = [];
    this.drinks = 0; // volte che Valerio ha bevuto
    this.penances = 0; // volte che ha fatto penitenza
    this.streak = 0; // sconfitte di fila
    this.penanceIdx = 0; // le penitenze escono nell'ordine della lista
    this.final = null;
    for (const p of this.players.values()) p.score = 0;
  }

  touch() {
    this.lastActivity = Date.now();
    this.onChange(this);
  }

  // ---------- giocatori ----------

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${cut(name, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  addPlayer({ name, avatar, isHost = false, plays = true }) {
    const n = cleanName(name);
    if (!n) throw new GameError('noname');
    if (this.players.size >= MAX_PLAYERS) throw new GameError('full');
    const p = {
      id: pid(),
      token: token(),
      name: this.uniqueName(n),
      avatar: cleanAvatar(avatar),
      isHost,
      plays: isHost ? !!plays : true,
      score: 0,
      joinedAt: Date.now(),
    };
    this.players.set(p.id, p);
    if (isHost) this.hostId = p.id;
    this.touch();
    return p;
  }

  // Chi ha perso la sessione (telefono cambiato, cronologia cancellata) può rientrare col suo nome
  // e riprendere posto e punti. Solo se quel giocatore è scollegato; la conferma la chiede index.js.
  findReclaimable(name) {
    const n = cleanName(name);
    if (!n) return null;
    for (const p of this.players.values()) {
      if (sameName(p.name, n) && !this.isConnected(p.id)) return p;
    }
    return null;
  }

  byToken(t) {
    for (const p of this.players.values()) if (p.token === t) return p;
    return null;
  }

  isConnected(playerId) {
    for (const v of this.sockets.values()) if (v.playerId === playerId) return true;
    return false;
  }

  attach(socketId, view) {
    this.sockets.set(socketId, view);
    if (view.playerId && view.playerId === this.hostId) {
      clearTimeout(this.hostGraceTimer);
      if (this.paused && this.pauseReason === 'host') this.resume();
    }
    this.touch();
  }

  detach(socketId) {
    const view = this.sockets.get(socketId);
    if (!view) return;
    this.sockets.delete(socketId);
    if (view.playerId === this.hostId && !this.isConnected(this.hostId)) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = setTimeout(safe(() => {
        if (!this.isConnected(this.hostId) && !this.paused && this.phase !== 'lobby' && this.phase !== 'end') {
          this.pause('host');
        }
      }, 'host-grace'), HOST_GRACE_MS);
    }
    this.maybeClose();
    this.touch();
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.id === this.hostId) throw new GameError('nokick');
    if (p.id === this.valerioId && this.phase !== 'lobby') throw new GameError('nokickvalerio');
    this.players.delete(playerId);
    if (this.valerioId === playerId) { this.valerioId = null; this.valerioName = null; }
    if (this.round && this.phase === 'question') {
      this.round.eligible.delete(playerId);
      this.round.votes.delete(playerId);
      this.round.bets.delete(playerId);
    }
    this.maybeClose();
    this.touch();
    return p;
  }

  // In lobby si sceglie (e si toglie) la corona. A partita iniziata si può solo spostare,
  // tra un round e l'altro (es. il telefono di Valerio è morto e lui rientra da un altro).
  setValerio(playerId) {
    const p = this.players.get(playerId);
    if (!p || !p.plays) throw new GameError('noplayer');
    if (this.phase === 'lobby') {
      this.valerioId = this.valerioId === playerId ? null : playerId;
      this.valerioName = this.valerioId ? p.name : null;
    } else if (this.phase === 'scores' || this.phase === 'end') {
      this.valerioName = this.valerioName || this.players.get(this.valerioId)?.name || p.name;
      this.valerioId = playerId;
    } else throw new GameError('notnow');
    this.touch();
  }

  setSettings(s) {
    const v = Number(s?.voteSeconds);
    if (Number.isFinite(v)) this.settings.voteSeconds = Math.max(8, Math.min(90, Math.round(v)));
    this.touch();
  }

  // ---------- flusso partita ----------

  start() {
    if (this.phase !== 'lobby') throw new GameError('started');
    if (!this.valerioId || !this.players.has(this.valerioId)) throw new GameError('novalerio');
    const qs = this.getQuestions();
    if (!qs.length) throw new GameError('noquestions');
    this.questions = qs.map((q) => ({ ...q }));
    this.qIndex = -1;
    this.nextRound();
  }

  nextRound() {
    clearTimeout(this.timer);
    this.paused = false;
    this.pauseReason = null;
    this.qIndex++;
    if (this.qIndex >= this.questions.length) return this.end();
    const now = Date.now();
    const eligible = new Set([...this.players.values()].filter((p) => p.plays).map((p) => p.id));
    eligible.add(this.valerioId);
    this.round = {
      index: this.qIndex,
      question: this.questions[this.qIndex],
      pair: this.qIndex % COLOR_PAIRS,
      eligible,
      votes: new Map(),
      bets: new Map(),
      result: null,
    };
    this.phase = 'question';
    this.phaseStartsAt = now;
    this.phaseEndsAt = now + this.settings.voteSeconds * 1000;
    this.schedule(this.phaseEndsAt - now, () => this.closeRound());
    this.touch();
  }

  schedule(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(safe(fn, this.code), Math.max(0, ms));
  }

  vote(playerId, roundIndex, choice) {
    const r = this.round;
    if (this.phase !== 'question' || !r || r.index !== roundIndex) return false; // voti in ritardo: ignorati
    if (choice !== 'x' && choice !== 'y') return false;
    if (r.votes.has(playerId)) return r.votes.get(playerId) === choice; // reinvio dello stesso voto = ok
    if (!r.eligible.has(playerId)) return false;
    r.votes.set(playerId, choice);
    this.maybeClose();
    this.touch();
    return true;
  }

  bet(playerId, roundIndex, bet) {
    const r = this.round;
    if (this.phase !== 'question' || !r || r.index !== roundIndex) return false;
    if (bet !== 'lose' && bet !== 'safe') return false;
    if (r.bets.has(playerId)) return r.bets.get(playerId) === bet;
    if (playerId === this.valerioId || !r.eligible.has(playerId)) return false;
    r.bets.set(playerId, bet);
    this.maybeClose();
    this.touch();
    return true;
  }

  // Il round si chiude quando tutti i connessi hanno votato e scommesso.
  // Valerio si aspetta sempre (anche se il telefono si è bloccato): ci pensa il timer.
  maybeClose() {
    const r = this.round;
    if (this.phase !== 'question' || !r || this.paused) return;
    if (Date.now() < this.restoredUntil) return; // dopo un riavvio del server: niente chiusure anticipate
    if (!r.votes.has(this.valerioId)) return;
    let waitingOn = 0;
    for (const id of r.eligible) {
      if (id === this.valerioId || !this.isConnected(id)) continue;
      if (!r.votes.has(id) || !r.bets.has(id)) waitingOn++;
    }
    if (waitingOn === 0) this.closeRound();
  }

  closeRound() {
    const r = this.round;
    if (this.phase !== 'question' || !r) return;
    clearTimeout(this.timer);
    let x = 0, y = 0;
    const voters = [];
    for (const [id, choice] of r.votes) {
      if (id === this.valerioId) continue;
      voters.push({ id, choice });
      choice === 'x' ? x++ : y++;
    }
    const n = x + y;
    const majority = x > y ? 'x' : y > x ? 'y' : 'tie';
    const valerioVote = r.votes.get(this.valerioId) ?? null;
    const reason = !valerioVote ? 'novote' : majority === 'tie' ? 'tie' : valerioVote === majority ? 'majority' : 'minority';
    const lost = reason !== 'majority';
    const sameAsValerio = valerioVote ? (valerioVote === 'x' ? x : y) : 0;
    const unanimous = reason === 'minority' && sameAsValerio === 0 && n >= 2;

    const bets = {};
    let correct = 0, wrong = 0;
    for (const [id, bet] of r.bets) {
      const ok = (bet === 'lose') === lost;
      bets[id] = { bet, correct: ok };
      if (ok) { correct++; const p = this.players.get(id); if (p) p.score++; } else wrong++;
    }

    // Se perde, la sorte decide: beve o penitenza. Deciso qui, così tutti vedono lo stesso esito.
    const punishment = lost ? this.drawPunishment() : null;
    this.streak = lost ? this.streak + 1 : 0;
    if (punishment?.type === 'drink') this.drinks++;
    if (punishment?.type === 'penance') this.penances++;

    r.result = {
      x, y, n,
      pctX: n ? Math.round((x / n) * 100) : 0,
      pctY: n ? 100 - Math.round((x / n) * 100) : 0,
      majority, valerioVote, reason, lost, punishment, unanimous,
      sameAsValerio,
      voters,
      bets,
      betStats: { correct, wrong },
      streak: this.streak,
      onFire: lost && this.streak >= 3,
      drinksTotal: this.drinks,
      penancesTotal: this.penances,
    };
    this.history.push({
      number: r.index + 1,
      question: r.question,
      x, y, n, majority, valerioVote, reason, lost, punishment, unanimous, sameAsValerio,
      isolation: n ? (n - sameAsValerio) / n : 0,
    });

    const now = Date.now();
    this.phase = 'reveal';
    this.revealStep = 0;
    this.phaseStartsAt = now + REVEAL_LEAD_MS;
    this.phaseEndsAt = null; // niente timer: le pagine le sfoglia l'host
    this.touch();
  }

  // Niente sorte: si alterna. 1ª sconfitta penitenza, 2ª beve, 3ª penitenza...
  // Le penitenze seguono l'ordine della lista del pannello (e ricominciano quando finiscono).
  drawPunishment() {
    const all = this.getPenances();
    const losses = this.drinks + this.penances;
    if (!all.length || losses % 2 === 1) return { type: 'drink' };
    const text = all[this.penanceIdx % all.length];
    this.penanceIdx++;
    return { type: 'penance', text };
  }

  toScores() {
    if (this.phase !== 'reveal') return;
    clearTimeout(this.timer);
    this.phase = 'scores';
    this.phaseStartsAt = Date.now();
    this.phaseEndsAt = null;
    this.touch();
  }

  // "Avanti" dell'host: nel reveal gira pagina, dall'ultima pagina va alla classifica,
  // dalla classifica (o saltando una domanda) va alla prossima.
  // `expect` = fase in cui l'host ha premuto: un doppio tocco arrivato dopo il cambio fase
  // viene ignorato, così non si salta per sbaglio la domanda appena partita.
  next(expect) {
    if (expect && expect !== this.phase) throw new GameError('stale');
    if (this.phase === 'reveal') {
      if (this.revealStep < REVEAL_STEPS - 1) {
        this.revealStep++;
        this.phaseStartsAt = Date.now() + STEP_LEAD_MS;
        this.touch();
      } else this.toScores();
    } else if (this.phase === 'question' || this.phase === 'scores') this.nextRound();
    else throw new GameError('nonext');
  }

  skip(roundIndex) {
    if (this.phase !== 'question') throw new GameError('noskip');
    if (roundIndex != null && roundIndex !== this.round?.index) throw new GameError('stale');
    this.nextRound();
  }

  pause(reason = 'manual') {
    if (this.paused || this.phase === 'lobby' || this.phase === 'end') return;
    if (reason === 'manual' && this.phase !== 'question') throw new GameError('stale');
    this.paused = true;
    this.pauseReason = reason;
    if (this.phase === 'question') {
      clearTimeout(this.timer);
      this.pausedRemaining = Math.max(0, this.phaseEndsAt - Date.now());
      this.phaseEndsAt = null;
    }
    this.touch();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseReason = null;
    if (this.phase === 'question') {
      const ms = Math.max(this.pausedRemaining ?? 0, 5000);
      this.phaseEndsAt = Date.now() + ms;
      this.schedule(ms, () => this.closeRound());
      this.maybeClose();
    }
    this.touch();
  }

  end() {
    clearTimeout(this.timer);
    this.paused = false;
    this.pauseReason = null;
    this.phase = 'end';
    this.phaseStartsAt = Date.now();
    this.phaseEndsAt = null;
    this.round = null;
    const highlights = this.history
      .filter((h) => h.reason === 'minority' && h.n > 0)
      .sort((a, b) => b.isolation - a.isolation || b.n - a.n)
      .slice(0, 3);
    this.final = { drinks: this.drinks, penances: this.penances, rounds: this.history.length, highlights };
    this.touch();
  }

  restart() {
    this.reset();
    this.touch();
  }

  // ---------- salvataggio su disco (sopravvive a un riavvio del server) ----------

  snapshot() {
    const r = this.round;
    return {
      v: 1,
      savedAt: Date.now(),
      code: this.code,
      hostId: this.hostId,
      valerioId: this.valerioId,
      valerioName: this.valerioName,
      settings: this.settings,
      lastActivity: this.lastActivity,
      players: [...this.players.values()],
      phase: this.phase,
      phaseStartsAt: this.phaseStartsAt,
      phaseEndsAt: this.phaseEndsAt,
      revealStep: this.revealStep ?? 0,
      paused: this.paused,
      pauseReason: this.pauseReason,
      pausedRemaining: this.pausedRemaining,
      questions: this.questions,
      qIndex: this.qIndex,
      history: this.history,
      drinks: this.drinks,
      penances: this.penances,
      streak: this.streak,
      penanceIdx: this.penanceIdx,
      final: this.final,
      round: r && {
        index: r.index,
        question: r.question,
        pair: r.pair,
        eligible: [...r.eligible],
        votes: [...r.votes],
        bets: [...r.bets],
        result: r.result,
      },
    };
  }

  restore(d) {
    this.hostId = d.hostId;
    this.valerioId = d.valerioId;
    this.valerioName = d.valerioName ?? null;
    this.settings = { ...this.settings, ...d.settings };
    this.lastActivity = d.lastActivity || Date.now();
    this.players = new Map((d.players || []).map((p) => [p.id, p]));
    for (const k of ['phase', 'phaseStartsAt', 'phaseEndsAt', 'revealStep', 'paused', 'pauseReason', 'pausedRemaining',
      'questions', 'qIndex', 'history', 'drinks', 'penances', 'streak', 'penanceIdx', 'final']) {
      if (d[k] !== undefined) this[k] = d[k];
    }
    this.round = d.round && {
      ...d.round,
      eligible: new Set(d.round.eligible),
      votes: new Map(d.round.votes),
      bets: new Map(d.round.bets),
    };
    // Domanda in corso: il timer riparte, con un margine per far rientrare tutti
    this.restoredUntil = Date.now() + RESTORE_GRACE_MS;
    if (this.phase === 'question' && !this.paused) {
      // il tempo della domanda resta "congelato" mentre il server era giù: si riparte da quanto mancava
      // al momento del salvataggio, più un margine per far rientrare tutti
      const left = Math.max(0, (this.phaseEndsAt || 0) - (d.savedAt || Date.now()));
      const ms = left + RESTORE_GRACE_MS;
      this.phaseEndsAt = Date.now() + ms;
      this.schedule(ms, () => this.closeRound());
      // passato il margine, se nel frattempo hanno votato tutti si chiude subito
      setTimeout(safe(() => this.maybeClose(), 'restore-grace'), RESTORE_GRACE_MS + 50);
    }
  }

  // ---------- viste ----------

  leaderboard() {
    return [...this.players.values()]
      .filter((p) => p.plays && p.id !== this.valerioId)
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, score: p.score }));
  }

  // Parte comune, calcolata una volta per flush.
  publicState() {
    const r = this.round;
    const showResult = this.phase === 'reveal' || this.phase === 'scores';
    return {
      code: this.code,
      phase: this.phase,
      phaseStartsAt: this.phaseStartsAt,
      phaseEndsAt: this.phaseEndsAt,
      revealStep: this.phase === 'reveal' ? this.revealStep : null,
      paused: this.paused,
      pauseReason: this.pauseReason,
      pausedRemaining: this.paused ? this.pausedRemaining : null,
      settings: this.settings,
      hostId: this.hostId,
      valerioId: this.valerioId,
      valerioName: this.valerioName || this.players.get(this.valerioId)?.name || null,
      hasScreen: [...this.sockets.values()].some((v) => v.screen),
      questionCount: this.phase === 'lobby' ? this.getQuestions().length : this.questions.length,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, isHost: p.isHost, plays: p.plays,
        score: p.score, connected: this.isConnected(p.id),
      })),
      round: r && {
        index: r.index,
        number: r.index + 1,
        total: this.questions.length,
        question: r.question,
        pair: r.pair,
        eligible: [...r.eligible],
        voted: [...r.votes.keys()],
        betted: [...r.bets.keys()],
        result: showResult ? r.result : null,
      },
      drinks: this.drinks,
      penances: this.penances,
      streak: this.streak,
      leaderboard: this.leaderboard(),
      final: this.final,
    };
  }

  meFor(view) {
    const p = view.playerId && this.players.get(view.playerId);
    if (!p) return null;
    const r = this.round;
    return {
      id: p.id,
      isHost: p.id === this.hostId,
      isValerio: p.id === this.valerioId,
      eligible: !!r?.eligible.has(p.id),
      vote: r?.votes.get(p.id) ?? null,
      bet: r?.bets.get(p.id) ?? null,
    };
  }
}
