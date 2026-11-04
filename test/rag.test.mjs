import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, tokenize, retrieve } from '../src/js/rag.js';
import { buildSearchContext } from '../src/js/websearch.js';
import { projectContext } from '../src/js/projects.js';
import { buildRunnerHtml } from '../src/js/runner.js';

const filler = (w, n) => Array.from({ length: n }, (_, i) => `${w} Satz Nummer ${i} über allgemeine Dinge und nichts Besonderes.`).join(' ');

test('chunkText teilt lange Texte in überlappende Abschnitte', () => {
  const t = filler('Alltag', 80);
  const c = chunkText(t, 600, 80);
  assert.ok(c.length > 5);
  assert.ok(c.every(x => x.length <= 620));
  assert.ok(c.join(' ').includes('Nummer 79'));
});

test('tokenize: Stoppwörter weg, deutsche Endungen gekürzt', () => {
  assert.deepEqual(tokenize('Die Rechnungen der Firma'), tokenize('Rechnung Firma'));
  assert.ok(!tokenize('und der die das').length);
});

test('retrieve findet den passenden Abschnitt in einer großen Datei', () => {
  const files = [
    { name: 'handbuch.txt', text: `${filler('Allgemein', 60)}\n\nDie Kündigungsfrist beträgt drei Monate zum Quartalsende. Die Kündigung muss schriftlich erfolgen.\n\n${filler('Weiteres', 60)}` },
    { name: 'preise.txt', text: filler('Preise', 60) },
  ];
  const out = retrieve(files, 'Wie lange ist die Kündigungsfrist?', 1500);
  assert.match(out, /Kündigungsfrist beträgt drei Monate/);
  assert.match(out, /### handbuch\.txt \(Abschnitt \d+\)/);
  assert.ok(out.length <= 1700);
});

test('retrieve ohne Treffer liefert den Anfang jeder Datei', () => {
  const out = retrieve([{ name: 'a.txt', text: filler('Eins', 40) }, { name: 'b.txt', text: filler('Zwei', 40) }], 'xyzzy', 3000);
  assert.match(out, /a\.txt \(Abschnitt 1\)/); assert.match(out, /b\.txt \(Abschnitt 1\)/);
});

test('projectContext: kleine Projekte komplett, große nur als Auszug', () => {
  const small = { name: 'P', instructions: 'Reime', files: [{ name: 'k.txt', text: 'kurz und klein' }] };
  assert.match(projectContext(small, { budget: 5000 }), /kurz und klein/);
  const big = { name: 'P', instructions: '', files: [{ name: 'g.txt', text: `${filler('Rauschen', 200)}\n\nDer Schlüsselsatz lautet Ananas.\n\n${filler('Rauschen', 200)}` }] };
  const ctx = projectContext(big, { query: 'Wie lautet der Schlüsselsatz?', budget: 2500 });
  assert.match(ctx, /Ananas/); assert.match(ctx, /Auszüge/); assert.ok(ctx.length < 3000);
});

test('buildSearchContext: nummerierte Quellen, Platzgrenze, nur http(s)', () => {
  const r = Array.from({ length: 6 }, (_, i) => ({ title: `Titel ${i}`, url: `https://www.beispiel${i}.at/x`, snippet: 'A'.repeat(2000) }));
  r.push({ title: 'böse', url: 'javascript:alert(1)', snippet: 'x' });
  const c = buildSearchContext(r, 3000, new Date('2026-11-04'));
  assert.equal(c.sources.length, 5);
  assert.ok(c.block.length <= 3200);
  assert.match(c.block, /\[1\] Titel 0 \(beispiel0\.at\)/);
  assert.match(c.block, /4\.11\.2026/);
  assert.ok(c.sources.every(s => s.url.startsWith('https://')));
  assert.equal(buildSearchContext([], 3000), null);
});

test('Runner-Seite schützt vor </script> im Code', () => {
  const html = buildRunnerHtml('console.log("</script><img src=x onerror=alert(1)>")', 'abc');
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.match(html, /aicoreRun:ID/);
});
