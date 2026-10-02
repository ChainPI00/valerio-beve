import { io } from 'socket.io-client';
import { useSyncExternalStore } from 'react';

// ---------- store minimale ----------
let store = { connected: false, state: null, kicked: false, resuming: false };
const listeners = new Set();
function set(patch) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}
export function useStore(sel = (s) => s) {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => sel(store));
}
export const getStore = () => store;

// ---------- sessione (per rientrare dopo blocco schermo / reload) ----------
const KEY = 'vb:session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

// ---------- socket ----------
// tryAllTransports: se il Wi-Fi del locale blocca i WebSocket si ripiega sul long-polling
export const socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2000, tryAllTransports: true });

export function emit(ev, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'offline' });
    socket.timeout(6000).emit(ev, payload, (err, res) => resolve(err ? { ok: false, error: 'offline' } : res));
  });
}

// "Agganciato" = connesso E rientrato nella stanza (resume fatto). Prima di allora un voto andrebbe perso.
let attached = false;
let waiters = [];
function setAttached(v) {
  attached = v;
  if (v) { waiters.forEach((w) => w()); waiters = []; }
}
function waitAttached(ms) {
  if (attached && socket.connected) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    waiters.push(() => { clearTimeout(t); resolve(); });
  });
}

// Per voti, scommesse e comandi dell'host: se la rete salta un attimo, riprova appena si rientra.
// Il server ignora i doppioni (voto già dato, comando di una fase già passata).
export async function emitReliable(ev, payload = {}, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!socket.connected || !attached) {
      if (Date.now() >= deadline) return { ok: false, error: 'offline' };
      await waitAttached(Math.min(2000, deadline - Date.now()));
      continue;
    }
    const res = await emit(ev, payload);
    if (res.error === 'unbound') {
      // il server non ci ha ancora riagganciati alla stanza: rifacciamo il resume e riproviamo
      setAttached(false);
      reattach();
      if (Date.now() >= deadline) return res;
      continue;
    }
    if (res.ok || res.error !== 'offline' || Date.now() >= deadline) return res;
  }
}

// ---------- orologio condiviso ----------
// offset = oraServer - oraLocale, stimato col campione a RTT minore.
let offset = 0;
let clockSynced = false;
export const serverNow = () => Date.now() + offset;

async function syncClock() {
  let best = null;
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const s = await new Promise((r) => socket.timeout(2000).emit('time', null, (e, v) => r(e ? null : v)));
    const t1 = Date.now();
    if (s == null) continue;
    const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { rtt, off: s + rtt / 2 - t1 };
  }
  if (best) { offset = best.off; clockSynced = true; }
}
setInterval(() => socket.connected && syncClock(), 30000);

// ---------- versione: una scheda vecchia (aperta prima di un aggiornamento) si ricarica da sola ----------
const MY_BUILD = (() => { try { return new URL(import.meta.url).pathname; } catch { return null; } })();
async function checkBuild() {
  const cfg = await emit('config');
  if (!cfg?.build || !MY_BUILD || !MY_BUILD.startsWith('/assets/') || cfg.build === MY_BUILD) return;
  try {
    if (sessionStorage.getItem('vb:reloadedFor') === cfg.build) return; // niente loop
    sessionStorage.setItem('vb:reloadedFor', cfg.build);
  } catch {}
  location.reload();
}

// ---------- errori JS dei telefoni → log del server ----------
function report(msg, where) {
  try {
    if (socket.connected) socket.emit('clientlog', { msg: String(msg).slice(0, 500), where: String(where || '').slice(0, 300), ua: navigator.userAgent });
  } catch {}
}
export const reportError = report;
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => report(e.message, `${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => report(e.reason?.message || e.reason, 'promise'));
}

// Cosa riaprire alla (ri)connessione
let view = null; // { kind: 'player', code, token, boot? } | { kind: 'screen', code }
export function setView(v) { view = v; }

let reattaching = false;
async function reattach() {
  if (!view || reattaching) return;
  reattaching = true;
  try { await doReattach(); } finally { reattaching = false; }
}
async function doReattach() {
  const v = view;
  set({ resuming: true });
  const res = v.kind === 'screen'
    ? await emit('screen:join', { code: v.code })
    : await emit('room:resume', { code: v.code, token: v.token });
  set({ resuming: false });
  if (view !== v) return; // nel frattempo l'utente è uscito o è stato espulso
  if (res.ok) {
    v.boot = false;
    setAttached(true);
    return;
  }
  if (res.error === 'offline') {
    // rete lenta: se il socket è ancora su, riproviamo tra poco (non solo alla prossima connessione)
    setTimeout(() => { if (socket.connected && !attached) reattach(); }, 1500);
    return;
  }
  // All'avvio una sessione vecchia (stanza di prova di giorni fa) si scarta in silenzio
  const silent = v.boot;
  if (v.kind === 'player') session.clear();
  view = null;
  set({ state: null, lostReason: silent ? null : 'gone' });
}

socket.on('connect', async () => {
  set({ connected: true });
  // prima si rientra nella stanza (i voti in attesa partono subito), poi si risincronizza l'orologio
  await reattach();
  checkBuild();
  syncClock();
});
socket.on('disconnect', () => {
  setAttached(false);
  set({ connected: false });
});
socket.on('state', (state) => {
  // finché il ping non ha misurato l'orologio, usiamo l'ora del server allegata allo stato (errore ~ mezzo RTT)
  if (!clockSynced && state.serverNow) offset = state.serverNow - Date.now();
  // ricevere lo stato della stanza prova che il server ci ha riagganciati (anche se l'ack del resume è andato perso)
  if (view && (state.me || view.kind === 'screen')) setAttached(true);
  set({ state });
});
socket.on('kicked', () => {
  session.clear();
  view = null;
  setAttached(false);
  set({ state: null, kicked: true });
});

// iPhone: al ritorno dall'app in background il socket può essere morto senza saperlo
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
});

export async function createRoom(payload) {
  const res = await emit('room:create', payload);
  if (res.ok) enterAsPlayer(res.code, res.token);
  return res;
}
export async function joinRoom(payload) {
  const res = await emit('room:join', payload); // può rispondere 'samename': chiediamo "sei tu?" e si riprova con reclaim
  if (res.ok) enterAsPlayer(res.code, res.token);
  return res;
}
function enterAsPlayer(code, token) {
  session.set({ code, token });
  view = { kind: 'player', code, token };
  setAttached(true);
  set({ kicked: false, lostReason: null });
}
export async function joinScreen(code) {
  const res = await emit('screen:join', { code });
  if (res.ok) {
    view = { kind: 'screen', code: res.code };
    setAttached(true);
  }
  return res;
}
export async function resumeSaved() {
  const s = session.get();
  if (!s?.code || !s?.token) return false;
  view = { kind: 'player', code: s.code, token: s.token, boot: true };
  if (socket.connected) await reattach();
  return true;
}
export async function leave() {
  await emit('room:leave');
  session.clear();
  view = null;
  setAttached(false);
  set({ state: null });
}
export const clearLost = () => set({ lostReason: null, kicked: false });

// ---------- upload (solo host) ----------
export async function upload(blob) {
  const s = session.get();
  const res = await fetch(`/api/upload?room=${encodeURIComponent(s?.code || '')}`, {
    method: 'POST',
    headers: { 'content-type': blob.type, 'x-token': s?.token || '' },
    body: blob,
  });
  if (!res.ok) throw new Error('upload');
  return (await res.json()).url;
}
export async function downloadPack() {
  const s = session.get();
  const res = await fetch(`/api/pack?room=${encodeURIComponent(s?.code || '')}`, { headers: { 'x-token': s?.token || '' } });
  if (!res.ok) throw new Error('pack');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = 'valerio-beve-pack.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function importPackFile(file) {
  const s = session.get();
  const res = await fetch(`/api/pack?room=${encodeURIComponent(s?.code || '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': s?.token || '' },
    body: await file.text(),
  });
  if (!res.ok) throw new Error('pack');
}
