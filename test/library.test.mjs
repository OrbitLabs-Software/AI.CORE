import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-lib-'));
const lib = await import('../server/library.js');
const filler = (w, n) => Array.from({ length: n }, (_, i) => `${w} Absatz ${i}: allgemeine Hinweise ohne besondere Bedeutung für niemanden.`).join(' ');

test('Dokument hinzufügen, gleicher Name ersetzt, löschen', () => {
  lib._reset();
  const a = lib.add('u1', 'handbuch.txt', filler('Alpha', 30));
  assert.ok(a.id); assert.equal(lib.list('u1').length, 1);
  const b = lib.add('u1', 'handbuch.txt', filler('Beta', 30));
  assert.equal(lib.list('u1').length, 1); assert.notEqual(a.id, b.id);
  assert.equal(lib.add('u1', 'leer.txt', ' kurz ').status, 400);
  assert.equal(lib.remove('u1', b.id), true); assert.equal(lib.remove('u1', b.id), false);
});
test('Suche findet den Abschnitt über mehrere Dokumente, Konten getrennt', () => {
  lib._reset();
  lib.add('u1', 'vertrag.txt', `${filler('Vertrag', 40)}\n\nDie Kündigungsfrist beträgt drei Monate zum Quartalsende.\n\n${filler('Vertrag', 40)}`);
  lib.add('u1', 'preise.txt', filler('Preise', 60));
  const r = lib.search('u1', 'Wie lange ist die Kündigungsfrist?', 1500);
  assert.equal(r.passages[0].name, 'vertrag.txt'); assert.match(r.passages[0].text, /drei Monate/);
  assert.ok(r.passages.reduce((n, p) => n + p.text.length, 0) <= 1500);
  assert.deepEqual(lib.search('u2', 'Kündigungsfrist').passages, []);
  assert.deepEqual(lib.search('u1', ' ').passages, []);
});
test('Index wird nach Änderung neu gebaut', () => {
  lib._reset();
  const a = lib.add('u1', 'a.txt', `${filler('Alt', 20)} Der Schlüsselbegriff lautet Zitronenbaum.`);
  assert.match(lib.search('u1', 'Zitronenbaum').passages[0].text, /Zitronenbaum/);
  lib.remove('u1', a.id);
  lib.add('u1', 'b.txt', `${filler('Neu', 20)} Der Schlüsselbegriff lautet Pampelmuse.`);
  assert.match(lib.search('u1', 'Pampelmuse').passages[0].text, /Pampelmuse/);
  assert.ok(!lib.search('u1', 'Zitronenbaum').passages.some(p => /Zitronenbaum/.test(p.text)));
});
