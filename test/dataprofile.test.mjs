import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseNumber, parseDate, profile, summarize, tableForModel, isTableName } from '../src/js/dataprofile.js';

test('Trennzeichen, Anführungszeichen und Zeilenumbrüche in Zellen', () => {
  const a = parseDelimited('Name;Betrag\nAnna;"1.234,50"\nBen;"12,5"\n');
  assert.equal(a.delimiter, ';'); assert.deepEqual(a.header, ['Name', 'Betrag']); assert.equal(a.rows.length, 2);
  const b = parseDelimited('a,b,c\n1,"x, y",3\n4,"sagt ""hi""\nZeile 2",6\r\n');
  assert.equal(b.delimiter, ','); assert.equal(b.rows[0][1], 'x, y'); assert.equal(b.rows[1][1], 'sagt "hi"\nZeile 2'); assert.equal(b.rows.length, 2);
  assert.equal(parseDelimited('x\ty\n1\t2').delimiter, '\t');
  assert.deepEqual(parseDelimited('\uFEFFid,wert\n1,2').header, ['id', 'wert']);
  assert.deepEqual(parseDelimited('a,b\n1\n').rows[0], ['1', '']);           // kurze Zeile wird aufgefüllt
});

test('Zahlen: deutsch, englisch, Währung, Prozent', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56); assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('12,5'), 12.5); assert.equal(parseNumber('€ 3,40'), 3.4); assert.equal(parseNumber('45 %'), 45);
  assert.equal(parseNumber('1.234.567'), 1234567); assert.equal(parseNumber('-7'), -7); assert.equal(parseNumber('1e3'), 1000);
  assert.ok(Number.isNaN(parseNumber('abc'))); assert.ok(Number.isNaN(parseNumber('12abc'))); assert.ok(Number.isNaN(parseNumber('')));
});

test('Datum: ISO und Tag.Monat.Jahr', () => {
  assert.equal(new Date(parseDate('04.11.2026')).toISOString().slice(0, 10), '2026-11-04');
  assert.equal(new Date(parseDate('2026-11-04T10:30')).toISOString().slice(0, 16), '2026-11-04T10:30');
  assert.ok(Number.isNaN(parseDate('31.13.2026'))); assert.ok(Number.isNaN(parseDate('morgen')));
});

const csv = ['Datum;Stadt;Umsatz;Aktiv;Notiz'].concat(Array.from({ length: 40 }, (_, i) =>
  `${String(1 + i % 28).padStart(2, '0')}.10.2026;${['Ried', 'Linz', 'Wels'][i % 3]};${(100 + i * 7.5).toLocaleString('de-AT', { minimumFractionDigits: 2 })};${i % 2 ? 'ja' : 'nein'};${i % 10 === 0 ? '' : 'ok'}`)).join('\n');

test('Profil: Typen, Kennzahlen, fehlende Werte, häufigste Werte, Verteilung', () => {
  const t = parseDelimited(csv), p = profile(t);
  assert.equal(p.rows, 40);
  const by = Object.fromEntries(p.cols.map(c => [c.name, c]));
  assert.equal(by.Datum.type, 'Datum'); assert.equal(by.Datum.min, '2026-10-01');
  assert.equal(by.Stadt.type, 'Text'); assert.equal(by.Stadt.unique, 3); assert.equal(by.Stadt.top[0][1], 14);
  assert.equal(by.Umsatz.type, 'Zahl'); assert.equal(by.Umsatz.min, 100); assert.equal(by.Umsatz.max, 392.5);
  assert.equal(Math.round(by.Umsatz.mean * 100) / 100, 246.25); assert.equal(by.Umsatz.hist.reduce((a, b) => a + b, 0), 40);
  assert.equal(by.Aktiv.type, 'Ja/Nein');
  assert.equal(by.Notiz.missing, 4);
});

test('Zusammenfassung für das Modell ist kompakt; kleine Dateien bleiben komplett', () => {
  const t = parseDelimited(csv), s = summarize(t, profile(t), 'umsatz.csv');
  assert.match(s, /Tabelle „umsatz.csv“: 40 Zeilen, 5 Spalten/); assert.match(s, /Umsatz \(Zahl\): 100 bis 392\.5/); assert.match(s, /Stadt \(Text\): 3 verschiedene Werte/);
  assert.ok(s.length <= 3500);
  const big = 'a;b\n' + Array.from({ length: 3000 }, (_, i) => `${i};x${i % 5}`).join('\n');
  const m = tableForModel('gross.csv', big);
  assert.ok(big.length > 6000 && m.length < 3600); assert.match(m, /3000 Zeilen/);
  assert.equal(tableForModel('klein.csv', 'a;b\n1;2'), 'a;b\n1;2');
  assert.equal(isTableName('Daten.CSV'), true); assert.equal(isTableName('notiz.txt'), false);
});

test('Leere und kaputte Tabellen stürzen nicht ab', () => {
  assert.equal(profile(parseDelimited('')).rows, 0);
  assert.equal(profile(parseDelimited('nur,kopf')).cols.length, 2);
  assert.doesNotThrow(() => summarize(parseDelimited('a,b\n,'), profile(parseDelimited('a,b\n,')), 'x.csv'));
});
