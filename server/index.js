import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room, GameError } from './game.js';
import { library, publicLibrary, applyLibraryOp, saveAsset, exportPack, importPack, ASSET_DIR } from './library.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 3000);
const HOST_PIN = process.env.HOST_PIN || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

// ---------- stanze ----------

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

function createRoom() {
  const code = newCode();
  const room = new Room(code, { getQuestions: () => library.questions, getPenances: () => library.penances, onChange: scheduleFlush });
  rooms.set(code, room);
  return room;
}

// Più cambiamenti ravvicinati (20 voti in un secondo) diventano un solo invio.
const pending = new Set();
function scheduleFlush(room) {
  if (pending.has(room)) return;
  pending.add(room);
  setTimeout(() => { pending.delete(room); flush(room); }, 40);
}

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
      rooms.delete(code);
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
      if (typeof ack === 'function') ack({ ok: false, error: err instanceof GameError ? err.message : 'server' });
    }
  };

  const requireHost = () => {
    const { room, playerId } = ctx();
    if (!room || playerId !== room.hostId) throw new GameError('nohost');
    return room;
  };

  socket.on('time', (_p, ack) => typeof ack === 'function' && ack(Date.now()));
  socket.on('config', (_p, ack) => typeof ack === 'function' && ack({ pinRequired: !!HOST_PIN }));

  socket.on('room:create', guard(({ name, avatar, plays, pin }) => {
    if (HOST_PIN && String(pin || '') !== HOST_PIN) throw new GameError('pin');
    const room = createRoom();
    const p = room.addPlayer({ name, avatar, isHost: true, plays: plays !== false });
    bind(room, { playerId: p.id, screen: false });
    return { code: room.code, token: p.token };
  }));

  socket.on('room:check', guard(({ code }) => {
    if (!rooms.has(String(code || '').toUpperCase())) throw new GameError('noroom');
    return {};
  }));

  socket.on('room:join', guard(({ code, name, avatar }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('noroom');
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
    const { room, playerId } = ctx();
    return { accepted: !!room?.vote(playerId, round, choice) };
  }));

  socket.on('bet', guard(({ round, bet }) => {
    const { room, playerId } = ctx();
    return { accepted: !!room?.bet(playerId, round, bet) };
  }));

  socket.on('host:valerio', guard(({ playerId }) => { requireHost().setValerio(playerId); return {}; }));
  socket.on('host:settings', guard((s) => { requireHost().setSettings(s); return {}; }));
  socket.on('host:start', guard(() => { requireHost().start(); return {}; }));
  socket.on('host:next', guard(() => { requireHost().next(); return {}; }));
  socket.on('host:skip', guard(() => { requireHost().skip(); return {}; }));
  socket.on('host:pause', guard(() => { requireHost().pause('manual'); return {}; }));
  socket.on('host:resume', guard(() => { requireHost().resume(); return {}; }));
  socket.on('host:end', guard(() => { requireHost().end(); return {}; }));
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

app.post('/api/upload', express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  if (!hostOf(req.query.room, req.get('x-token'))) return res.status(403).json({ error: 'nohost' });
  try {
    res.json({ url: saveAsset(req.body, req.get('content-type')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/pack', (req, res) => {
  if (!hostOf(req.query.room, req.get('x-token'))) return res.status(403).json({ error: 'nohost' });
  res.setHeader('Content-Disposition', 'attachment; filename="valerio-beve-pack.json"');
  res.json(exportPack());
});

app.post('/api/pack', express.json({ limit: '60mb' }), (req, res) => {
  if (!hostOf(req.query.room, req.get('x-token'))) return res.status(403).json({ error: 'nohost' });
  try {
    importPack(req.body);
    flushAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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
    app.use((req, res) => res.type('html').send(html));
  } else {
    console.warn('Manca client/dist: esegui prima `npm run build` (per ora gira solo il backend).');
  }
}

server.listen(PORT, () => {
  console.log(`🍺 Valerio Beve su http://localhost:${PORT}${DEV ? ' (dev)' : ''}`);
});

export { rooms };
