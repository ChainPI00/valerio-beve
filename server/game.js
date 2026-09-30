// Stato autoritativo di una partita. I client mostrano solo quello che dice il server.
import crypto from 'node:crypto';

export const REVEAL_LEAD_MS = 500; // ritardo programmato: tutti ricevono l'evento prima che parta
export const REVEAL_STEPS = 4; // pagine del reveal: gruppo, Valerio, verdetto, scommesse (poi classifica)
const STEP_LEAD_MS = 350; // ogni pagina parte un filo nel futuro, così arriva a tutti prima di iniziare
export const PENANCE_CHANCE = Number(process.env.PENANCE_CHANCE ?? 0.5); // quando Valerio perde: 50% beve, 50% penitenza
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS || 3000);
export const MAX_PLAYERS = 30;
export const COLOR_PAIRS = 6; // coppie di colori X/Y, il client le mappa sulla palette

const token = () => crypto.randomBytes(16).toString('base64url');
const pid = () => crypto.randomBytes(5).toString('base64url');
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

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
    this.settings = { voteSeconds: 25 };
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
    this.usedPenances = new Set();
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
      const candidate = `${name.slice(0, 13)} ${i}`;
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
      this.hostGraceTimer = setTimeout(() => {
        if (!this.isConnected(this.hostId) && !this.paused && this.phase !== 'lobby' && this.phase !== 'end') {
          this.pause('host');
        }
      }, HOST_GRACE_MS);
    }
    this.maybeClose();
    this.touch();
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.id === this.hostId) throw new GameError('nokick');
    if (p.id === this.valerioId && this.phase !== 'lobby') throw new GameError('nokickvalerio');
    this.players.delete(playerId);
    if (this.valerioId === playerId) this.valerioId = null;
    this.round?.eligible.delete(playerId);
    this.maybeClose();
    this.touch();
    return p;
  }

  setValerio(playerId) {
    if (this.phase !== 'lobby') throw new GameError('started');
    const p = this.players.get(playerId);
    if (!p || !p.plays) throw new GameError('noplayer');
    this.valerioId = this.valerioId === playerId ? null : playerId;
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
    this.timer = setTimeout(fn, Math.max(0, ms));
  }

  vote(playerId, roundIndex, choice) {
    const r = this.round;
    if (this.phase !== 'question' || !r || r.index !== roundIndex) return false; // voti in ritardo: ignorati
    if (!r.eligible.has(playerId) || r.votes.has(playerId)) return false;
    if (choice !== 'x' && choice !== 'y') return false;
    r.votes.set(playerId, choice);
    this.maybeClose();
    this.touch();
    return true;
  }

  bet(playerId, roundIndex, bet) {
    const r = this.round;
    if (this.phase !== 'question' || !r || r.index !== roundIndex) return false;
    if (playerId === this.valerioId || !r.eligible.has(playerId) || r.bets.has(playerId)) return false;
    if (bet !== 'lose' && bet !== 'safe') return false;
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

  drawPunishment() {
    const all = this.getPenances();
    if (!all.length || Math.random() >= PENANCE_CHANCE) return { type: 'drink' };
    let pool = all.filter((t) => !this.usedPenances.has(t));
    if (!pool.length) { this.usedPenances.clear(); pool = all; }
    const text = pool[Math.floor(Math.random() * pool.length)];
    this.usedPenances.add(text);
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
  next() {
    if (this.phase === 'reveal') {
      if (this.revealStep < REVEAL_STEPS - 1) {
        this.revealStep++;
        this.phaseStartsAt = Date.now() + STEP_LEAD_MS;
        this.touch();
      } else this.toScores();
    } else if (this.phase === 'question' || this.phase === 'scores') this.nextRound();
    else throw new GameError('nonext');
  }

  skip() {
    if (this.phase !== 'question') throw new GameError('noskip');
    this.nextRound();
  }

  pause(reason = 'manual') {
    if (this.paused || this.phase === 'lobby' || this.phase === 'end') return;
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
      .filter((h) => h.lost && h.valerioVote && h.n > 0)
      .sort((a, b) => b.isolation - a.isolation || b.n - a.n)
      .slice(0, 3);
    this.final = { drinks: this.drinks, penances: this.penances, rounds: this.history.length, highlights };
    this.touch();
  }

  restart() {
    this.reset();
    this.touch();
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
