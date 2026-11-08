import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-lib-'));
const lib = await import('../server/library.js');
const filler = (w, n) => Array.from({ length: n }, (_, i) => `${w} Absatz ${i}: allgemeine Hinweise ohne besondere Bedeutung für niemanden.`).join(' ');

test('Dokument hinzufügen, auflisten, gleicher Name ersetzt, löschen', () => {
  lib._reset();
  const a = lib.add('u1', 'handbuch.txt', filler('Alpha', 30));
  assert.ok(a.id); assert.equal(lib.list('u1').length, 1);
  const b = lib.add('u1', 'handbuch.txt', filler('Beta', 30));
  assert.equal(lib.list('u1').length, 1); assert.notEqual(a.id, b.id);       // ersetzt
  assert.equal(lib.add('u1', 'leer.txt', ' kurz ').status, 400);
  assert.equal(lib.remove('u1', b.id), true); assert.equal(lib.remove('u1', b.id), false);
  assert.equal(lib.list('u1').length, 0);
});

test('Suche findet den passenden Abschnitt über mehrere Dokumente, mit Name und Abschnittsnummer', () => {
  lib._reset();
  lib.add('u1', 'vertrag.txt', `${filler('Vertrag', 40)}\n\nDie Kündigungsfrist beträgt drei Monate zum Quartalsende.\n\n${filler('Vertrag', 40)}`);
  lib.add('u1', 'preise.txt', filler('Preise', 60));
  const r = lib.search('u1', 'Wie lange ist die Kündigungsfrist?', 1500);
  assert.ok(r.passages.length >= 1);
  assert.equal(r.passages[0].name, 'vertrag.txt'); assert.match(r.passages[0].text, /drei Monate/); assert.ok(r.passages[0].part >= 1);
  assert.ok(r.passages.reduce((n, p) => n + p.text.length, 0) <= 1500);
  assert.deepEqual(lib.search('u1', ' ', 1000).passages, []);
});

test('Konten sind getrennt, Daten überleben einen Neustart, Grenzen greifen', () => {
  lib._reset();
  lib.add('u1', 'a.txt', filler('Eins', 20));
  assert.equal(lib.list('u2').length, 0); assert.deepEqual(lib.search('u2', 'Eins').passages, []);
  const file = fs.readdirSync(path.join(process.env.AICORE_DATA_DIR, 'library'))[0];
  assert.ok(file.endsWith('.json'));
  const big = 'x '.repeat(300_000);
  const r = lib.add('u1', 'riesig.txt', big);
  assert.equal(r.truncated, true); assert.ok(lib.stats('u1').chars <= lib.LIMITS.docChars + 3000);
  assert.equal(lib.stats('u1').count, 2);
});

test('Suche nach Änderung: Index wird neu gebaut', () => {
  lib._reset();
  lib.add('u1', 'a.txt', `${filler('Alt', 20)} Der Schlüsselbegriff lautet Zitronenbaum.`);
  assert.match(lib.search('u1', 'Zitronenbaum').passages[0].text, /Zitronenbaum/);
  const d = lib.list('u1')[0]; lib.remove('u1', d.id);
  lib.add('u1', 'b.txt', `${filler('Neu', 20)} Der Schlüsselbegriff lautet Pampelmuse.`);
  assert.match(lib.search('u1', 'Pampelmuse').passages[0].text, /Pampelmuse/);
  assert.ok(!lib.search('u1', 'Zitronenbaum').passages.some(p => /Zitronenbaum/.test(p.text)));
});

test('Statistik überschreibt nie die Dokumentliste (Form der Antwort von GET /api/library)', () => {
  lib._reset();
  lib.add('u1', 'a.txt', filler('Eins', 20));
  const body = { docs: lib.list('u1'), ...lib.stats('u1') };
  assert.ok(Array.isArray(body.docs)); assert.equal(body.docs.length, 1); assert.equal(body.count, 1);
  assert.ok(body.chars > 0 && body.maxDocs > 0 && body.maxChars > 0);
});
