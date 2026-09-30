// Riempie una stanza di bot che votano e scommettono a caso. Utile per provare lo show da soli.
//   node test/bots.js ABCD 12 [http://localhost:3000]
import { io } from 'socket.io-client';

const [code, n = '10', url = 'http://localhost:3000'] = process.argv.slice(2);
if (!code) {
  console.log('Uso: node test/bots.js CODICE [numero] [url]');
  process.exit(1);
}
const NAMES = ['Valerio', 'Giulia', 'Marco', 'Chiara', 'Luca', 'Sara', 'Matteo', 'Fede', 'Ale', 'Bea', 'Tommi', 'Irene', 'Pietro', 'Marti', 'Nico', 'Gaia', 'Dario', 'Elisa', 'Simo', 'Anna', 'Jacopo'];
const SHAPES = ['blob', 'star', 'flower', 'squircle', 'triangle', 'ghost'];
const COLORS = ['pink', 'yellow', 'cyan', 'orange', 'cream'];

for (let i = 0; i < Number(n); i++) {
  const socket = io(url, { transports: ['websocket'] });
  let lastRound = -1;
  if (i === 0) {
    socket.once('connect_error', () => console.log(`✗ Non riesco a collegarmi a ${url}. Il gioco gira lì? (controlla la porta)`));
  }
  socket.on('connect', () => {
    setTimeout(() => {
      socket.emit('room:join', {
        code,
        name: NAMES[i % NAMES.length],
        avatar: { shape: SHAPES[i % SHAPES.length], color: COLORS[(i * 3) % COLORS.length] },
      }, (r) => console.log(r.ok ? `🤖 ${NAMES[i % NAMES.length]} dentro` : `✗ ${r.error}`));
    }, i * 350);
  });
  socket.on('state', (s) => {
    if (s.phase !== 'question' || !s.me?.eligible || s.round.index === lastRound) return;
    lastRound = s.round.index;
    const lean = Math.random();
    setTimeout(() => {
      socket.emit('vote', { round: s.round.index, choice: Math.random() < lean ? 'x' : 'y' });
      if (!s.me.isValerio) setTimeout(() => socket.emit('bet', { round: s.round.index, bet: Math.random() < 0.5 ? 'lose' : 'safe' }), 400 + Math.random() * 1500);
    }, 800 + Math.random() * 5000);
  });
}
