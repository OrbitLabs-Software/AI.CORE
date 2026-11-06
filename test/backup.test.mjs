import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/js/exporter.js';

const chat = { id: 'c1', title: 'Test', messages: [{ id: 'm1', role: 'user', content: 'Hallo' }] };

test('Komplette Sicherung: Chats, Projekte und Einstellungen; Schlüssel bleiben draußen', () => {
  const text = JSON.stringify({ app: 'ai-core', type: 'backup', chats: [chat],
    projects: [{ id: 'p1', name: 'Bewerbung', instructions: 'Förmlich', files: [{ id: 'f1', name: 'cv.txt', text: 'Lebenslauf' }, { name: 'kaputt' }] }, { name: 'ohne id' }],
    settings: { theme: 'dark', style: 'concise', instructions: 'Duze mich', apiKey: 'geheim', cloudToken: 'x', cloudAck: true, templates: [{ id: 't', name: 'A', text: 'B' }] } });
  const r = parseBackup(text);
  assert.equal(r.chats.length, 1);
  assert.equal(r.projects.length, 1);
  assert.deepEqual(r.projects[0].files.map(f => f.name), ['cv.txt']);
  assert.equal(r.settings.theme, 'dark'); assert.equal(r.settings.instructions, 'Duze mich');
  assert.ok(!('apiKey' in r.settings) && !('cloudToken' in r.settings) && !('cloudAck' in r.settings));
  assert.equal(r.settings.templates.length, 1);
});

test('Alte Chat-Sicherung (nur Liste) lässt sich weiter einlesen', () => {
  const r = parseBackup(JSON.stringify([chat]));
  assert.equal(r.chats.length, 1); assert.deepEqual(r.projects, []); assert.deepEqual(r.settings, {});
});

test('Ungültige Datei wirft einen Fehler', () => {
  assert.throws(() => parseBackup('{"nichts":1}'), /AI-Core-Sicherung/);
  assert.throws(() => parseBackup('kein json'));
});
