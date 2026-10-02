// Libreria condivisa della serata: facce di Valerio, meme, domande, meta.
// Vive su disco (DATA_DIR) così un riavvio del server non cancella niente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
export const ASSET_DIR = path.join(DATA_DIR, 'assets');
const LIB_FILE = path.join(DATA_DIR, 'library.json');

export const EXPRESSIONS = ['neutro', 'felice', 'disperato', 'sorpreso', 'ubriaco', 'alloro'];
const DEFAULT_QUESTIONS = JSON.parse(fs.readFileSync(path.join(here, 'questions.default.json'), 'utf8'));
const DEFAULT_PENANCES = JSON.parse(fs.readFileSync(path.join(here, 'penances.default.json'), 'utf8'));

const id = () => crypto.randomBytes(6).toString('base64url');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function defaults() {
  return {
    meta: { course: 'Ingegneria Meccanica (magistrale)', university: 'Politecnico di Torino' },
    faces: Object.fromEntries(EXPRESSIONS.map((e) => [e, null])),
    memes: [],
    questions: DEFAULT_QUESTIONS.map((q) => ({ id: id(), x: q.x, y: q.y, memeId: null })),
    penances: [...DEFAULT_PENANCES],
  };
}

fs.mkdirSync(ASSET_DIR, { recursive: true });

export const library = (() => {
  if (!fs.existsSync(LIB_FILE)) return defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8'));
    const d = defaults();
    return { ...d, ...raw, meta: { ...d.meta, ...raw.meta }, faces: { ...d.faces, ...raw.faces } };
  } catch (err) {
    // File illeggibile: lo mettiamo da parte invece di sovrascriverlo, così domande e foto si recuperano
    const backup = `${LIB_FILE}.rotto-${Date.now()}`;
    try { fs.renameSync(LIB_FILE, backup); } catch {}
    console.error(`[library] library.json illeggibile (${err.message}), salvato in ${backup}`);
    return defaults();
  }
})();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(LIB_FILE + '.tmp', JSON.stringify(library, null, 2));
      fs.renameSync(LIB_FILE + '.tmp', LIB_FILE);
    } catch (err) {
      console.error('[library] salvataggio fallito:', err.message);
    }
  }, 200);
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function saveAsset(buffer, mime) {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error('Formato non supportato');
  const name = `${id()}.${ext}`;
  fs.writeFileSync(path.join(ASSET_DIR, name), buffer);
  return `/assets/${name}`;
}

const sanitizePenances = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map((t) => clip(t, 160)).filter(Boolean))].slice(0, 200);

function sanitizeQuestions(list, memeIds = new Set(library.memes.map((m) => m.id))) {
  return (Array.isArray(list) ? list : [])
    .filter((q) => q && typeof q === 'object')
    .map((q) => ({
      id: typeof q.id === 'string' && q.id ? q.id.slice(0, 20) : id(),
      x: clip(q.x, 140),
      y: clip(q.y, 140),
      memeId: memeIds.has(q.memeId) ? q.memeId : null,
    }))
    .filter((q) => q.x && q.y)
    .slice(0, 300);
}

export function applyLibraryOp(op) {
  switch (op?.type) {
    case 'setMeta':
      library.meta = { course: clip(op.meta?.course, 80), university: clip(op.meta?.university, 80) };
      break;
    case 'setFace':
      if (!EXPRESSIONS.includes(op.expr)) return false;
      library.faces[op.expr] = typeof op.url === 'string' && op.url.startsWith('/assets/') ? op.url : null;
      break;
    case 'addMeme':
      if (typeof op.url !== 'string' || !op.url.startsWith('/assets/')) return false;
      library.memes.push({ id: id(), url: op.url, name: clip(op.name, 40) || 'Meme' });
      break;
    case 'removeMeme':
      library.memes = library.memes.filter((m) => m.id !== op.id);
      library.questions.forEach((q) => { if (q.memeId === op.id) q.memeId = null; });
      break;
    case 'setQuestions':
      library.questions = sanitizeQuestions(op.questions);
      break;
    case 'resetQuestions':
      library.questions = defaults().questions;
      break;
    case 'setPenances':
      library.penances = sanitizePenances(op.penances);
      break;
    case 'resetPenances':
      library.penances = [...DEFAULT_PENANCES];
      break;
    default:
      return false;
  }
  save();
  return true;
}

export function publicLibrary() {
  return { meta: library.meta, faces: library.faces, memes: library.memes };
}

// Pack = libreria + asset in base64, per backup / spostare tutto su un altro server.
export function exportPack() {
  const urls = new Set([...Object.values(library.faces).filter(Boolean), ...library.memes.map((m) => m.url)]);
  const assets = {};
  for (const url of urls) {
    try { assets[url] = fs.readFileSync(path.join(ASSET_DIR, path.basename(url))).toString('base64'); } catch {}
  }
  return { version: 1, library, assets };
}

const isAsset = (u) => typeof u === 'string' && /^\/assets\/[\w-]+\.(png|jpg|webp|gif)$/.test(u);

// Import tutto-o-niente: si valida tutto in un oggetto nuovo e si sostituisce la libreria in un colpo solo
export function importPack(pack) {
  if (!pack || typeof pack !== 'object' || !pack.library || typeof pack.library !== 'object') throw new Error('Pack non valido');
  const l = pack.library;
  const d = defaults();
  const next = {
    meta: {
      course: clip(l.meta?.course ?? d.meta.course, 80),
      university: clip(l.meta?.university ?? d.meta.university, 80),
    },
    faces: Object.fromEntries(EXPRESSIONS.map((e) => [e, isAsset(l.faces?.[e]) ? l.faces[e] : null])),
    memes: (Array.isArray(l.memes) ? l.memes : [])
      .filter((m) => m && typeof m === 'object' && typeof m.id === 'string' && isAsset(m.url))
      .map((m) => ({ id: m.id.slice(0, 20), url: m.url, name: clip(m.name, 40) || 'Meme' })),
  };
  next.questions = sanitizeQuestions(l.questions, new Set(next.memes.map((m) => m.id)));
  next.penances = Array.isArray(l.penances) ? sanitizePenances(l.penances) : [...DEFAULT_PENANCES];
  // file delle immagini: solo nomi sicuri
  const files = [];
  for (const [url, b64] of Object.entries(pack.assets && typeof pack.assets === 'object' ? pack.assets : {})) {
    const name = path.basename(String(url));
    if (!/^[\w-]+\.(png|jpg|webp|gif)$/.test(name) || typeof b64 !== 'string') continue;
    files.push([name, Buffer.from(b64, 'base64')]);
  }
  for (const [name, buf] of files) fs.writeFileSync(path.join(ASSET_DIR, name), buf);
  Object.assign(library, next);
  save();
}
