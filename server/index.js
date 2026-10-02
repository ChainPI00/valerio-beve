import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room, GameError } from './game.js';
import { library, publicLibrary, applyLibraryOp, saveAsset, exportPack, importPack, ASSET_DIR, DATA_DIR } from './library.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 3000);
const HOST_PIN = process.env.HOST_PIN || '';
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// Alla festa il server non deve mai cadere: logghiamo e andiamo avanti
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const app = express();
const server = http.createServer(app);
// pingTimeout non troppo stretto: col Wi-Fi ballerino del locale non vogliamo disconnessioni a raffica
const io = new Server(server, { pingInterval: 10000, pingTimeout: 15000 });

// ---------- stanze ----------

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

const roomDeps = () => ({ getQuestions: () => library.questions, getPenances: () => library.penances, onChange: scheduleFlush });

function createRoom() {
  const code = newCode();
  const room = new Room(code, roomDeps());
  rooms.set(code, room);
  return room;
}

// Più cambiamenti ravvicinati (20 voti in un secondo) diventano un solo invio.
const pending = new Set();
function scheduleFlush(room) {
  schedulePersist();
  if (pending.has(room)) return;
  pending.add(room);
  setTimeout(() => {
    pending.delete(room);
    try { flush(room); } catch (err) { console.error('[flush]', err); }
  }, 40);
}

// ---------- le partite sopravvivono a un riavvio del server ----------
// Ogni cambiamento salva tutte le stanze su disco (al massimo una volta al secondo).
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const data = JSON.stringify([...rooms.values()].map((r) => r.snapshot()));
      fs.writeFileSync(ROOMS_FILE + '.tmp', data);
      fs.renameSync(ROOMS_FILE + '.tmp', ROOMS_FILE);
    } catch (err) {
      console.error('[persist]', err.message);
    }
  }, 1000);
}

function restoreRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const list = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    const cutoff = Date.now() - 12 * 3600 * 1000;
    for (const d of list) {
      if (!d?.code || (d.lastActivity || 0) < cutoff) continue;
      const room = new Room(d.code, roomDeps());
      room.restore(d);
      rooms.set(d.code, room);
      console.log(`[restore] stanza ${d.code} · fase ${room.phase} · ${room.players.size} giocatori`);
    }
  } catch (err) {
    console.error('[restore]', err.message);
  }
}
restoreRooms();

function flush(room) {
  if (!rooms.has(room.code)) return;
  const common = { ...room.publicState(), library: publicLibrary() };
  for (const [sid, view] of room.sockets) {
    const me = room.meFor(view);
    const state = { ...common, me, serverNow: Date.now() };
    if (me?.isHost) { state.questions = library.questions; state.penanceList = library.penances; }
    io.to(sid).emit('state', state);
  }
}

function flushAll() {
  for (const room of rooms.values()) scheduleFlush(room);
}

// Stanze abbandonate da più di 12 ore
setInterval(() => {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  for (const [code, room] of rooms) {
    if (room.sockets.size === 0 && room.lastActivity < cutoff) {
      clearTimeout(room.timer);
      clearTimeout(room.hostGraceTimer);
      rooms.delete(code);
      schedulePersist();
    }
  }
}, 10 * 60 * 1000).unref();

function hostOf(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  const p = room?.byToken(String(token || ''));
  return room && p && p.id === room.hostId ? room : null;
}

// ---------- socket ----------

io.on('connection', (socket) => {
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    return { room, playerId: socket.data.playerId };
  };

  const bind = (room, view) => {
    const prev = rooms.get(socket.data.code);
    if (prev) prev.detach(socket.id);
    socket.data.code = room.code;
    socket.data.playerId = view.playerId;
    room.attach(socket.id, view);
  };

  const guard = (fn) => (payload, ack) => {
    try {
      const res = fn(payload ?? {});
      if (typeof ack === 'function') ack({ ok: true, ...res });
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      if (typeof ack === 'function') ack({ ok: false, error: err instanceof GameError ? err.message : 'server', ...(err.extra || {}) });
    }
  };

  // Socket non ancora rientrato nella stanza (es. telefono appena risvegliato): errore "riprova",
  // così il telefono rifà il resume e reinvia, invece di credere che il voto sia andato a buon fine
  const requireRoom = () => {
    const { room, playerId } = ctx();
    if (!room || !playerId || !room.players.has(playerId)) throw new GameError('unbound');
    return { room, playerId };
  };
  const requireHost = () => {
    const { room, playerId } = requireRoom();
    if (playerId !== room.hostId) throw new GameError('nohost');
    return room;
  };

  socket.on('time', (_p, ack) => typeof ack === 'function' && ack(Date.now()));
  socket.on('config', (_p, ack) => typeof ack === 'function' && ack({ pinRequired: !!HOST_PIN, build: BUILD }));
  // Errori JS dei telefoni finiscono nei log del server (utile per capire cosa succede durante la serata)
  let logs = 0;
  socket.on('clientlog', (p) => {
    if (++logs > 20) return;
    const msg = String(p?.msg ?? '').slice(0, 500);
    const where = String(p?.where ?? '').slice(0, 300);
    console.warn(`[client ${socket.data.code || '-'}] ${msg} ${where} · ${String(p?.ua ?? '').slice(0, 120)}`);
  });

  socket.on('room:create', guard(({ name, avatar, plays, pin }) => {
    if (HOST_PIN && String(pin || '') !== HOST_PIN) throw new GameError('pin');
    const room = createRoom();
    const p = room.addPlayer({ name, avatar, isHost: true, plays: plays !== false });
    bind(room, { playerId: p.id, screen: false });
    console.log(`[room ${room.code}] creata da ${p.name}`);
    return { code: room.code, token: p.token };
  }));

  socket.on('room:check', guard(({ code }) => {
    if (!rooms.has(String(code || '').toUpperCase())) throw new GameError('noroom');
    return {};
  }));

  socket.on('room:join', guard(({ code, name, avatar, pin, reclaim }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('noroom');
    // Stesso nome di un giocatore scollegato: forse è lui che rientra da un altro telefono.
    // - host: solo col PIN (che prova chi è); senza PIN configurato non si può prendere il posto dell'host
    // - Valerio: mai (niente scherzi); rientra come nuovo giocatore e l'host gli sposta la corona
    // - gli altri: solo a partita iniziata e solo se confermano ("sei tu?"), così due Marco non si fondono
    const old = room.findReclaimable(name);
    const take = (p) => {
      bind(room, { playerId: p.id, screen: false });
      console.log(`[room ${room.code}] ${p.name} rientra da un altro telefono`);
      return { code: room.code, token: p.token, reclaimed: true };
    };
    if (old && old.id === room.hostId) {
      if (HOST_PIN && String(pin || '') === HOST_PIN) return take(old);
      if (HOST_PIN && pin) throw new GameError('pin');
      if (HOST_PIN) throw new GameError('hostpin');
    } else if (old && old.id !== room.valerioId && room.phase !== 'lobby') {
      if (reclaim === true) return take(old);
      if (reclaim !== false) {
        throw Object.assign(new GameError('samename'), { extra: { other: { name: old.name, avatar: old.avatar, score: old.score } } });
      }
    }
    const p = room.addPlayer({ name, avatar });
    bind(room, { playerId: p.id, screen: false });
    return { code: room.code, token: p.token };
  }));

  socket.on('room:resume', guard(({ code, token }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('noroom');
    const p = room.byToken(String(token || ''));
    if (!p) throw new GameError('notoken');
    bind(room, { playerId: p.id, screen: false });
    return { code: room.code };
  }));

  socket.on('screen:join', guard(({ code }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('noroom');
    bind(room, { playerId: null, screen: true });
    return { code: room.code };
  }));

  socket.on('room:leave', guard(() => {
    const { room, playerId } = ctx();
    if (room) {
      room.detach(socket.id);
      if (playerId && playerId !== room.hostId && room.phase === 'lobby') room.kick(playerId);
    }
    socket.data.code = null;
    socket.data.playerId = null;
    return {};
  }));

  socket.on('vote', guard(({ round, choice }) => {
    const { room, playerId } = requireRoom();
    return { accepted: room.vote(playerId, round, choice) };
  }));

  socket.on('bet', guard(({ round, bet }) => {
    const { room, playerId } = requireRoom();
    return { accepted: room.bet(playerId, round, bet) };
  }));

  socket.on('host:valerio', guard(({ playerId }) => { requireHost().setValerio(playerId); return {}; }));
  socket.on('host:settings', guard((s) => { requireHost().setSettings(s); return {}; }));
  socket.on('host:start', guard(() => {
    const room = requireHost();
    room.start();
    console.log(`[room ${room.code}] partita iniziata · ${room.players.size} giocatori`);
    return {};
  }));
  socket.on('host:next', guard(({ expect }) => { requireHost().next(expect); return {}; }));
  socket.on('host:skip', guard(({ round }) => { requireHost().skip(round); return {}; }));
  socket.on('host:pause', guard(() => { requireHost().pause('manual'); return {}; }));
  socket.on('host:resume', guard(() => { requireHost().resume(); return {}; }));
  socket.on('host:end', guard(() => {
    const room = requireHost();
    room.end();
    console.log(`[room ${room.code}] fine partita · ${room.drinks} bevute, ${room.penances} penitenze`);
    return {};
  }));
  socket.on('host:restart', guard(() => { requireHost().restart(); return {}; }));
  socket.on('host:kick', guard(({ playerId }) => {
    const room = requireHost();
    room.kick(playerId);
    for (const [sid, view] of room.sockets) {
      if (view.playerId !== playerId) continue;
      room.sockets.delete(sid);
      const s = io.sockets.sockets.get(sid);
      if (s) { s.data.code = null; s.data.playerId = null; s.emit('kicked'); }
    }
    return {};
  }));

  socket.on('library:op', guard((op) => {
    requireHost();
    if (!applyLibraryOp(op)) throw new GameError('badop');
    flushAll();
    return {};
  }));

  socket.on('disconnect', () => {
    const { room } = ctx();
    room?.detach(socket.id);
  });
});

// ---------- http ----------

app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.send('ok'));
app.use('/assets', express.static(ASSET_DIR, { maxAge: '7d', immutable: true }));

// Prima si controlla che sia l'host, poi si legge il corpo (niente upload enormi da chi passa)
const onlyHost = (req, res, next) => (hostOf(req.query.room, req.get('x-token')) ? next() : res.status(403).json({ error: 'nohost' }));

app.post('/api/upload', onlyHost, express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  try {
    res.json({ url: saveAsset(req.body, req.get('content-type')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/pack', onlyHost, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="valerio-beve-pack.json"');
  res.json(exportPack());
});

app.post('/api/pack', onlyHost, express.json({ limit: '30mb' }), (req, res) => {
  try {
    importPack(req.body);
    flushAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Versione del client: i telefoni con una scheda vecchia (aperta prima di un aggiornamento) si ricaricano da soli
let BUILD = null;

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: path.join(root, 'client'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    BUILD = html.match(/\/assets\/index-[\w-]+\.js/)?.[0] || null;
    // L'anteprima dei link (WhatsApp & co.) vuole URL assoluti: li completiamo col dominio della richiesta
    app.use((req, res) => {
      const origin = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html.replaceAll('__ORIGIN__', origin));
    });
  } else {
    console.warn('Manca client/dist: esegui prima `npm run build` (per ora gira solo il backend).');
  }
}

server.listen(PORT, () => {
  console.log(`🍺 Valerio Beve su http://localhost:${PORT}${DEV ? ' (dev)' : ''}`);
});

export { rooms };
