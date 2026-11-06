import test from 'node:test';
import assert from 'node:assert/strict';
import { takeBranch, applyBranch, branchInfo, switchBranch } from '../src/js/branches.js';

const msg = (id, role, content) => ({ id, role, content });
const chat = () => ({ messages: [msg('u1', 'user', 'Frage A'), msg('a1', 'assistant', 'Antwort A'), msg('u2', 'user', 'Folge A'), msg('a2', 'assistant', 'Folgeantwort A')] });

function edit(c, id, text, newId) {
  const b = takeBranch(c, id);
  const m = applyBranch(msg(newId, 'user', text), b);
  c.messages.push(m, msg(`${newId}-a`, 'assistant', `Antwort auf ${text}`));
  return m;
}

test('Bearbeiten hebt den alten Verlauf als Zweig auf', () => {
  const c = chat();
  const m = edit(c, 'u1', 'Frage B', 'u1b');
  assert.deepEqual(c.messages.map(x => x.id), ['u1b', 'u1b-a']);
  assert.equal(m.alts.length, 1);
  assert.equal(m.alts[0].tail.length, 3);
  assert.deepEqual(branchInfo(m), { index: 2, total: 2 });
});

test('Zwischen Zweigen wechseln stellt den kompletten Verlauf wieder her und zurück', () => {
  const c = chat();
  edit(c, 'u1', 'Frage B', 'u1b');
  assert.equal(switchBranch(c, 'u1b', -1), true);
  assert.deepEqual(c.messages.map(x => x.content), ['Frage A', 'Antwort A', 'Folge A', 'Folgeantwort A']);
  assert.deepEqual(branchInfo(c.messages[0]), { index: 1, total: 2 });
  assert.equal(switchBranch(c, 'u1b', -1), false);          // schon beim ersten
  assert.equal(switchBranch(c, 'u1b', 1), true);
  assert.deepEqual(c.messages.map(x => x.content), ['Frage B', 'Antwort auf Frage B']);
});

test('Drei Zweige, Bearbeiten mitten im Gespräch, Reihenfolge bleibt', () => {
  const c = chat();
  edit(c, 'u2', 'Folge B', 'u2b');          // Zweig 2 an Stelle von u2
  edit(c, 'u2b', 'Folge C', 'u2c');         // Zweig 3
  const m = c.messages[2];
  assert.deepEqual(branchInfo(m), { index: 3, total: 3 });
  assert.equal(m.content, 'Folge C');
  switchBranch(c, m.id, -1);
  assert.equal(c.messages[2].content, 'Folge B');
  switchBranch(c, m.id, -1);
  assert.equal(c.messages[2].content, 'Folge A');
  assert.equal(c.messages.length, 4);
  assert.equal(c.messages[3].content, 'Folgeantwort A');
  switchBranch(c, m.id, 1); switchBranch(c, m.id, 1);
  assert.equal(c.messages[2].content, 'Folge C');
  assert.equal(c.messages[0].content, 'Frage A');              // Nachrichten davor bleiben unberührt
});

test('Ungültige Nachrichten und Nachrichten ohne Zweige', () => {
  const c = chat();
  assert.equal(takeBranch(c, 'a1'), null);                      // nur Nutzernachrichten
  assert.equal(takeBranch(c, 'gibtsnicht'), null);
  assert.equal(branchInfo(c.messages[0]), null);
  assert.equal(switchBranch(c, 'u1', 1), false);
});
