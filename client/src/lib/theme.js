export const C = {
  night: '#2B1055',
  pink: '#FF3E8A',
  yellow: '#FFD23F',
  cyan: '#1FD1F9',
  orange: '#FF7A1A',
  siren: '#FF1F3D', // solo per "Valerio beve"
  cream: '#FFF4E0',
  ink: '#170530',
};

// Ogni round una coppia diversa per X e Y: la partita cambia colore di continuo.
export const PAIRS = [
  ['pink', 'yellow'],
  ['cyan', 'orange'],
  ['yellow', 'pink'],
  ['orange', 'cyan'],
  ['pink', 'cyan'],
  ['yellow', 'orange'],
];
export const pairColors = (i) => PAIRS[(i ?? 0) % PAIRS.length].map((k) => C[k]);
export const pairKeys = (i) => PAIRS[(i ?? 0) % PAIRS.length];

// Colore del testo migliore sopra un colore pieno
export const inkOn = () => C.ink;

export const JOKES = {
  noroom: 'Questa stanza non esiste, come la voglia di studiare di Valerio.',
  noname: 'Anche Valerio ha un nome. Più o meno.',
  full: 'Stanza piena. Alla laurea di Valerio c’era meno gente.',
  pin: 'PIN sbagliato. Neanche Valerio ci sarebbe cascato.',
  notoken: 'La tua sessione è evaporata, come i crediti di Valerio.',
  novalerio: 'Prima scegli chi è Valerio. Tocca il suo nome.',
  noquestions: 'Zero domande. Più vuoto di un’aula del Poli al terzo appello.',
  nohost: 'Solo l’host può farlo. Ci hai provato però.',
  started: 'La partita è già partita. Come Valerio al terzo spritz.',
  kicked: 'Sei stato espulso. Valerio ha più dignità di te (forse).',
  offline: 'Connessione persa… la cerchiamo come Valerio cerca il relatore.',
  server: 'Il server ha ceduto a fatica. Andava dimensionato meglio, ingegnere. Riprova.',
  upload: 'Upload fallito. La foto era troppo brutta anche per noi.',
};
export const joke = (code) => JOKES[code] || JOKES.server;

export const EXPRESSIONS = [
  ['neutro', 'Neutra'],
  ['felice', 'Felice'],
  ['disperato', 'Disperata'],
  ['sorpreso', 'Sorpresa'],
  ['ubriaco', 'Ubriaca'],
  ['alloro', 'Con l’alloro'],
];

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const motion = reducedMotion ? 0.35 : 1; // si riduce, non si elimina

export const vibrate = (p) => { try { navigator.vibrate?.(p); } catch {} };

export const isTv = () => location.pathname.startsWith('/tv');
