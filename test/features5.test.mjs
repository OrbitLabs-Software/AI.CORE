import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, buildLinkContext, buildLibraryContext, combineContexts } from '../src/js/websearch.js';
import { mermaidPage } from '../src/js/mermaid.js';

test('Links erkennen: Satzzeichen weg, Bilder/doppelte/fremde Protokolle ignoriert, höchstens zwei', () => {
  const t = 'Lies https://example.at/artikel?id=5, und (https://de.wikipedia.org/wiki/Ried_im_Innkreis). Nicht: https://x.at/bild.png ftp://x.at/a javascript:alert(1) http://localhost/x https://example.at/artikel?id=5 https://dritte.at/x';
  assert.deepEqual(extractUrls(t), ['https://example.at/artikel?id=5', 'https://de.wikipedia.org/wiki/Ried_im_Innkreis']);
  assert.deepEqual(extractUrls('kein Link'), []);
});
test('Kontexte: nummerierte Quellen, Platzgrenze, Zusammenführen', () => {
  const l = buildLinkContext([{ url: 'https://www.beispiel.at/a', title: 'Titel A', text: 'T'.repeat(5000) }], 1500);
  assert.match(l.block, /\[L1\] Titel A \(beispiel\.at\)/); assert.ok(l.block.length < 1900);
  const b = buildLibraryContext([{ name: 'vertrag.txt', part: 3, text: 'Kündigungsfrist drei Monate' }], 1000);
  assert.deepEqual(b.sources[0], { n: 'B1', title: 'vertrag.txt · Abschnitt 3', doc: true });
  const c = combineContexts([l, null, b], 700);
  assert.equal(c.sources.length, 2); assert.ok(c.block.length <= 700); assert.equal(combineContexts([null], 700), null);
});
test('Mermaid-Seite: Quelltext maskiert, feste Version, Fehlerfunktion vor dem Skript definiert', () => {
  const html = mermaidPage('graph TD\nA["</pre><script>alert(1)</script>"] --> B');
  assert.ok(!html.includes('<script>alert(1)</script>')); assert.match(html, /mermaid@11\.4\.0/);
  assert.ok(html.indexOf('function e(') < html.indexOf('mermaid.min.js'));
});
