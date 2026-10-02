// Test diretti sulla logica della stanza (senza rete): casi limite segnalati in review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-unit-'));
const { Room } = await import('../server/game.js');
const lib = await import('../server/library.js');

let passed = 0;
const ok = (m) => { passed++; console.log(`  ✓ ${m}`); };
console.log('\n🧪 Logica di gioco\n');

const questions = [{ id: 'q1', x: 'A', y: 'B' }, { id: 'q2', x: 'C', y: 'D' }];
const mk = () => new Room('TEST', { getQuestions: () => questions, getPenances: () => ['P1', 'P2'], onChange: () => {} });

// 1) l'espulso che aveva già votato non sposta la maggioranza
{
  const room = mk();
  const host = room.addPlayer({ name: 'Host', isHost: true, plays: false });
  const v = room.addPlayer({ name: 'Valerio' });
  const a = room.addPlayer({ name: 'A' });
  const b = room.addPlayer({ name: 'B' });
  const c = room.addPlayer({ name: 'C' });
  room.sockets.set('s1', { playerId: a.id }); // A connesso: il round non si chiude da solo
  room.setValerio(v.id);
  room.start();
  room.vote(b.id, 0, 'y');
  room.vote(c.id, 0, 'y');
  room.vote(a.id, 0, 'x');
  room.kick(b.id);
  room.kick(c.id);
  room.vote(v.id, 0, 'x');
  room.closeRound();
  assert.equal(room.round.result.y, 0);
  assert.equal(room.round.result.lost, false);
  ok('i voti di chi viene espulso non contano');
  clearTimeout(room.timer);
}

// 2) nomi con emoji non vengono spezzati
{
  const room = mk();
  const p = room.addPlayer({ name: '🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺🍺' });
  assert.equal(Array.from(p.name).length, 16);
  assert.ok(!/�/.test(p.name) && p.name === p.name.normalize());
  ok('nomi con emoji tagliati senza caratteri rotti');
}

// 3) dopo un riavvio niente chiusura anticipata del round finché non passa il margine
{
  const room = mk();
  room.addPlayer({ name: 'Host', isHost: true, plays: false });
  const v = room.addPlayer({ name: 'Valerio' });
  const a = room.addPlayer({ name: 'A' });
  room.setValerio(v.id);
  room.sockets.set('s0', { playerId: a.id }); // A collegato prima del riavvio: il round resta aperto
  room.start();
  room.vote(v.id, 0, 'x');
  assert.equal(room.phase, 'question');
  const snap = JSON.parse(JSON.stringify(room.snapshot()));
  clearTimeout(room.timer);
  const r2 = mk();
  r2.restore(snap);
  r2.sockets.set('s', { playerId: a.id });
  r2.vote(a.id, 0, 'x');
  r2.bet(a.id, 0, 'safe');
  assert.equal(r2.phase, 'question');
  ok('dopo un riavvio il round aspetta che tutti abbiano il tempo di rientrare');
  clearTimeout(r2.timer);
}

// 4) pack malformato: o tutto o niente
{
  const before = JSON.stringify(lib.library);
  assert.throws(() => lib.importPack({ nope: 1 }));
  assert.equal(JSON.stringify(lib.library), before);
  lib.importPack({ library: { memes: [null, { id: 'm1', url: '/assets/ok.png', name: 'x' }, { id: 'm2', url: 'javascript:alert(1)' }], questions: [null, { x: 'A', y: 'B', memeId: 'm1' }], faces: { neutro: '/etc/passwd' } } });
  assert.equal(lib.library.memes.length, 1);
  assert.equal(lib.library.questions.length, 1);
  assert.equal(lib.library.questions[0].memeId, 'm1');
  assert.equal(lib.library.faces.neutro, null);
  ok('pack malformato: niente libreria a metà, campi strani scartati');
}

console.log(`\n✅ ${passed} verifiche passate\n`);
process.exit(0);
