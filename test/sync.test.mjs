import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-sync-'));
const s = await import('../server/sync.js');

const chat = (id, updatedAt, extra = {}) => ({ id, title: `Chat ${id}`, favorite: false, roleId: null, projectId: null, createdAt: 1, updatedAt,
  messages: [{ id: `${id}-m1`, role: 'user', content: 'Hallo', createdAt: 1, attachments: [{ name: 'a.csv', type: 'text/csv', text: 'x;y\n1;2', preview: 'data:image/jpeg;base64,GEHEIM' }] },
    { id: `${id}-m2`, role: 'assistant', content: 'Hi', createdAt: 2, images: ['data:image/png;base64,GROSS'], stats: { tokens: 5 } }], ...extra });

test('Push und Pull: neuere Fassung gewinnt, ältere wird ignoriert', () => {
  s._reset();
  assert.equal(s.push('u1', { chats: [chat('abc1', 100)] }).accepted, 1);
  assert.equal(s.push('u1', { chats: [chat('abc1', 50, { title: 'ALT' })] }).skipped, 1);
  assert.equal(s.push('u1', { chats: [chat('abc1', 200, { title: 'NEU' })] }).accepted, 1);
  const r = s.pull('u1', 0);
  assert.equal(r.chats.length, 1); assert.equal(r.chats[0].title, 'NEU');
  assert.equal(s.pull('u1', r.now + 1).chats.length, 0);     // nichts Neueres seit dem letzten Abruf
  assert.ok(r.now > 0);
});

test('Bilder und Vorschauen werden nicht abgeglichen, Texte schon', () => {
  s._reset();
  s.push('u1', { chats: [chat('abc2', 10)] });
  const c = s.pull('u1').chats[0];
  const text = JSON.stringify(c);
  assert.ok(!text.includes('GEHEIM') && !text.includes('GROSS'));
  assert.equal(c.messages[0].attachments[0].text, 'x;y\n1;2');
  assert.equal(c.messages[1].stats.tokens, 5);
});

test('Konten sind getrennt, gelöschte Chats bleiben als Marker', () => {
  s._reset();
  s.push('u1', { chats: [chat('abc3', 10)] });
  assert.equal(s.pull('u2').chats.length, 0);
  s.push('u1', { chats: [chat('abc3', 20, { deletedAt: 20 })] });
  assert.equal(s.pull('u1', 0).chats[0].deletedAt, 20);
  assert.equal(s.prune('u1', 45, 20 + 46 * 86400000), 1);    // nach 45 Tagen endgültig weg
  assert.equal(s.pull('u1').chats.length, 0);
});

test('Ungültiges wird abgelehnt: falsche IDs, Rollen, zu große Chats, zu viele Elemente', () => {
  s._reset();
  const r = s.push('u1', { chats: [{ ...chat('../x', 1) }, { ...chat('okid1', 1), messages: [{ id: 'm1', role: 'system', content: 'x' }] }, chat('riesig', 1, { messages: [{ id: 'mmmm', role: 'user', content: 'x'.repeat(60000), createdAt: 1 }, ...Array.from({ length: 40 }, (_, i) => ({ id: `m${i}xx`, role: 'user', content: 'y'.repeat(60000), createdAt: 1 }))] })], projects: [{ id: 'p', name: 'zu kurze ID' }] });
  assert.equal(r.rejected >= 3, true);
  assert.equal(s.push('u1', { chats: Array.from({ length: 60 }, (_, i) => chat(`vol${i}x`, 5)) }).accepted, s.LIMITS.perPush);   // höchstens 40 pro Aufruf
});

test('Projekte mit Dateien und Zweige (alts) bleiben erhalten', () => {
  s._reset();
  const alts = [{ no: 1, content: 'Alt', attachments: [], tail: [{ id: 'tail1', role: 'assistant', content: 'Alte Antwort', createdAt: 3 }] }];
  const c = chat('abc5', 10); c.messages[0].alts = alts; c.messages[0].no = 2;
  s.push('u1', { chats: [c], projects: [{ id: 'proj1', name: 'Bewerbung', instructions: 'Förmlich', createdAt: 1, updatedAt: 10, files: [{ id: 'f1', name: 'cv.txt', text: 'Lebenslauf' }] }] });
  const r = s.pull('u1');
  assert.equal(r.chats[0].messages[0].alts[0].tail[0].content, 'Alte Antwort');
  assert.equal(r.chats[0].messages[0].no, 2);
  assert.equal(r.projects[0].files[0].text, 'Lebenslauf');
});

test('Gerätezeit falsch (Gerät geht nach): Änderung wird trotzdem ausgeliefert', async () => {
  s._reset();
  const first = s.pull('u1');
  await new Promise(r => setTimeout(r, 5));
  s.push('u1', { chats: [chat('zeit1', 5)] });             // updatedAt 5 = „Jahr 1970“, weit vor dem letzten Abruf
  assert.equal(s.pull('u1', first.now).chats.length, 1);
});

test('wipe löscht alle Daten eines Kontos', () => {
  s._reset();
  s.push('u1', { chats: [chat('weg1x', 5)] }); s.push('u2', { chats: [chat('bleib', 5)] });
  assert.equal(s.wipe('u1'), true);
  assert.equal(s.pull('u1').chats.length, 0); assert.equal(s.pull('u2').chats.length, 1);
});
