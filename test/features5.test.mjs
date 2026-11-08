import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, buildLinkContext, buildLibraryContext, combineContexts } from '../src/js/websearch.js';
import { mermaidPage } from '../src/js/mermaid.js';

test('Links erkennen: Satzzeichen weg, Bilder/Dateien/doppelte/fremde Protokolle ignoriert, höchstens zwei', () => {
  const t = 'Lies https://example.at/artikel?id=5, und (https://de.wikipedia.org/wiki/Ried_im_Innkreis). Nicht: https://x.at/bild.png ftp://x.at/a javascript:alert(1) http://localhost/x https://example.at/artikel?id=5 https://dritte.at/x';
  assert.deepEqual(extractUrls(t), ['https://example.at/artikel?id=5', 'https://de.wikipedia.org/wiki/Ried_im_Innkreis']);
  assert.deepEqual(extractUrls('kein Link hier'), []);
  assert.deepEqual(extractUrls('https://a.at/x https://b.at/y https://c.at/z', 3).length, 3);
});

test('Link-Kontext und Bibliothek-Kontext: nummerierte Quellen mit Platzgrenze', () => {
  const l = buildLinkContext([{ url: 'https://www.beispiel.at/a', title: 'Titel A', text: 'T'.repeat(5000) }, { url: 'https://b.at/b', title: 'Titel B', text: 'kurz genug' }], 1500);
  assert.match(l.block, /\[L1\] Titel A \(beispiel\.at\)/); assert.match(l.block, /\[L2\] Titel B/); assert.ok(l.block.length < 1900);
  assert.deepEqual(l.sources.map(s => s.n), ['L1', 'L2']); assert.equal(l.sources[0].url, 'https://www.beispiel.at/a');
  const b = buildLibraryContext([{ name: 'vertrag.txt', part: 3, text: 'Kündigungsfrist drei Monate' }], 1000);
  assert.match(b.block, /\[B1\] vertrag\.txt, Abschnitt 3/); assert.deepEqual(b.sources[0], { n: 'B1', title: 'vertrag.txt · Abschnitt 3', doc: true });
  assert.equal(buildLinkContext([], 1000), null); assert.equal(buildLibraryContext([], 1000), null);
});

test('combineContexts: führt zusammen, überspringt leere, begrenzt die Länge', () => {
  const a = { block: 'A'.repeat(500), sources: [{ n: 1 }] }, b = { block: 'B'.repeat(500), sources: [{ n: 'B1' }] };
  const c = combineContexts([a, null, b], 700);
  assert.equal(c.sources.length, 2); assert.ok(c.block.length <= 700); assert.match(c.block, /gekürzt/);
  assert.equal(combineContexts([null], 700), null);
});

test('Mermaid-Seite: Quelltext wird maskiert, feste Version, Fehlermeldungen vorhanden', () => {
  const html = mermaidPage('graph TD\nA["</pre><script>alert(1)</script>"] --> B');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;/);
  assert.match(html, /mermaid@11\.4\.0\/dist\/mermaid\.min\.js/);
  assert.match(html, /securityLevel:'strict'/); assert.match(html, /Bist du online/);
});
