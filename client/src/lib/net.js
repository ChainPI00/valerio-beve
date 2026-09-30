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
export const socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 400, reconnectionDelayMax: 2000 });

export function emit(ev, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'offline' });
    socket.timeout(6000).emit(ev, payload, (err, res) => resolve(err ? { ok: false, error: 'offline' } : res));
  });
}

// ---------- orologio condiviso ----------
// offset = oraServer - oraLocale, stimato col campione a RTT minore.
let offset = 0;
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
  if (best) offset = best.off;
}
setInterval(() => socket.connected && syncClock(), 30000);

// Cosa riaprire alla (ri)connessione
let view = null; // { kind: 'player', code, token } | { kind: 'screen', code }
export function setView(v) { view = v; }

async function reattach() {
  if (!view) return;
  set({ resuming: true });
  const res = view.kind === 'screen'
    ? await emit('screen:join', { code: view.code })
    : await emit('room:resume', { code: view.code, token: view.token });
  set({ resuming: false });
  if (!res.ok) {
    if (view.kind === 'player') session.clear();
    view = null;
    set({ state: null, lostReason: res.error });
  }
}

socket.on('connect', async () => {
  set({ connected: true });
  await syncClock();
  await reattach();
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('state', (state) => set({ state }));
socket.on('kicked', () => {
  session.clear();
  view = null;
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
  const res = await emit('room:join', payload);
  if (res.ok) enterAsPlayer(res.code, res.token);
  return res;
}
function enterAsPlayer(code, token) {
  session.set({ code, token });
  view = { kind: 'player', code, token };
  set({ kicked: false, lostReason: null });
}
export async function joinScreen(code) {
  const res = await emit('screen:join', { code });
  if (res.ok) view = { kind: 'screen', code: res.code };
  return res;
}
export async function resumeSaved() {
  const s = session.get();
  if (!s) return false;
  view = { kind: 'player', ...s };
  if (socket.connected) await reattach();
  return true;
}
export async function leave() {
  await emit('room:leave');
  session.clear();
  view = null;
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
