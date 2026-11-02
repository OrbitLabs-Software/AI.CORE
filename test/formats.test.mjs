// Datei-Erzeugung (xlsx, pptx, pdf, docx, zip) und Mehrdatei-Vorschau: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { parseSheets, xlsxBytes, toCell, normalizeFormula, colName, sheetsFromMarkdown } = await import('../src/js/xlsx.js');
const { parseSlides, layoutSlides, pptxBytes } = await import('../src/js/pptx.js');
const { pdfBytes, toCodes, glyphWidth } = await import('../src/js/pdf.js');
const { markdownToDocx } = await import('../src/js/docx.js');
const { blocks, spans, answerOnly, tablesOf } = await import('../src/js/mdblocks.js');
const { bundleHtml } = await import('../src/js/bundle.js');
const { parseZipSpec, outName, exportBlock, exportMessage } = await import('../src/js/formats.js');
const { formatsFor, isNativeLang, messageExports } = await import('../src/js/formatsMeta.js');
const { makeZip } = await import('../src/js/zip.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-fmt-'));
const unzipList = (bytes) => {
  const f = path.join(tmp, `z${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(f, bytes);
  return { file: f, names: execFileSync('unzip', ['-Z1', f]).toString().trim().split('\n'), read: (n) => execFileSync('unzip', ['-p', f, n.replace(/[[\]]/g, '\\$&')]).toString('utf8') };
};
/** Sehr einfache Prüfung: jedes öffnende Tag hat sein schließendes. */
function wellFormed(xml) {
  const stack = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

test('Markdown-Blöcke: Überschrift, Absatz mit Zeilenumbruch, Liste, Tabelle, Code, Zitat', () => {
  const b = blocks('# T\nA\nB\n\n- x\n  - y\n1. z\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\ncode\n```\n> q');
  assert.deepEqual(b.map(x => x.type), ['h', 'p', 'li', 'li', 'li', 'table', 'code', 'quote']);
  assert.deepEqual(b[1].lines, ['A', 'B']);
  assert.equal(b[3].level, 1); assert.equal(b[4].ordered, true);
  assert.equal(b[5].header, true); assert.deepEqual(b[5].rows, [['a', 'b'], ['1', '2']]);
  assert.equal(answerOnly('<think>x</think>\nAntwort'), 'Antwort');
  assert.deepEqual(spans('a **b** *c* `d` [e](https://x.de)').map(s => s.t), ['a ', 'b', ' ', 'c', ' ', 'd', ' ', 'e (https://x.de)']);
  assert.equal(tablesOf('## Preise\n| a |\n|---|\n| 1 |')[0].name, 'Preise');
});

test('Excel: Zellen, Formeln (deutsch), Trenner, Blätter, gültiges Archiv', () => {
  assert.equal(colName(0), 'A'); assert.equal(colName(26), 'AA');
  assert.deepEqual(toCell('1.234,50'), { kind: 'n', v: 1234.5, style: 0 });
  assert.deepEqual(toCell('12%'), { kind: 'n', v: 0.12, style: 2 });
  assert.equal(toCell('99,90 €').style, 4);
  assert.equal(toCell('007').kind, 's'); assert.equal(toCell('+4366012').kind, 's');
  assert.equal(normalizeFormula('=SUMME(B2;B3)'), 'SUM(B2,B3)');
  assert.equal(normalizeFormula('=WENN(A1>1;"a;b";"c")'), 'IF(A1>1,"a;b","c")');
  const sheets = parseSheets('Monat;Summe\nJan;=SUMME(1;2)\n=== Blatt: Zwei ===\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(sheets.length, 2); assert.equal(sheets[1].name, 'Zwei'); assert.deepEqual(sheets[0].rows[1], ['Jan', '=SUMME(1;2)']);
  assert.equal(parseSheets('a,b\n1,2')[0].rows[1][1], '2');
  assert.deepEqual(parseSheets('{"sheets":[{"name":"X","rows":[["a","b"],[1,2]]}]}')[0].rows, [['a', 'b'], [1, 2]]);
  assert.deepEqual(parseSheets('[{"n":"A","w":1},{"n":"B","w":2}]')[0].rows, [['n', 'w'], ['A', 1], ['B', 2]]);
  const z = unzipList(xlsxBytes(sheets));
  assert.ok(z.names.includes('xl/workbook.xml') && z.names.includes('xl/worksheets/sheet2.xml'));
  for (const n of z.names) assert.ok(wellFormed(z.read(n)), `${n} ist wohlgeformt`);
  assert.match(z.read('xl/worksheets/sheet1.xml'), /<f>SUM\(1,2\)<\/f>/);
  assert.equal(sheetsFromMarkdown('| a |\n|---|\n| 1 |').length, 1);
});

test('Excel: Sonderzeichen und Blattnamen werden bereinigt', () => {
  const z = unzipList(xlsxBytes([{ name: 'A/B:C*?[x]', rows: [['<&>"', 'ä']] }, { name: 'a/b:c*?[x]', rows: [['x']] }]));
  const wb = z.read('xl/workbook.xml');
  assert.ok(wellFormed(wb)); assert.ok(!/name="[^"]*[/:*?[\]]/.test(wb));
  assert.match(z.read('xl/worksheets/sheet1.xml'), /&lt;&amp;&gt;&quot;/);
  assert.equal((wb.match(/<sheet /g) || []).length, 2);
});

test('PowerPoint: Titelfolie, Folien, Zwischenfolie, Aufteilung langer Folien', () => {
  const md = '# Titel\nUntertitel\n\n## Eins\n- a\n  - b\n1. c\n\n# Teil\n\n## Lang\n' + Array.from({ length: 16 }, (_, i) => `- Punkt ${i} mit etwas längerem Text, damit die Folie schnell voll wird und umbrochen werden muss`).join('\n');
  const d = parseSlides(md);
  assert.deepEqual(d.slides.map(s => s.kind), ['title', 'content', 'section', 'content']);
  assert.equal(d.slides[0].subtitle, 'Untertitel'); assert.equal(d.slides[1].items[1].level, 1);
  const L = layoutSlides(d);
  assert.ok(L.length > 4 && L.some(s => s.title === 'Lang (Forts.)'), 'lange Folie wird geteilt');
  assert.ok(L.filter(s => s.kind === 'content').every(s => s.size >= 14 && s.size <= 28));
  const z = unzipList(pptxBytes(md));
  assert.ok(z.names.includes('ppt/slides/slide1.xml') && z.names.includes('ppt/theme/theme1.xml'));
  for (const n of z.names) assert.ok(wellFormed(z.read(n)), `${n} ist wohlgeformt`);
  assert.equal((z.read('ppt/presentation.xml').match(/<p:sldId /g) || []).length, L.length);
  assert.deepEqual(parseSlides('{"title":"T","slides":[{"title":"A","bullets":["x","y"]}]}').slides.map(s => s.title), ['T', 'A']);
  assert.equal(parseSlides('Titel\nText\n---\nZwei\n- a').slides.length, 2);
  assert.ok(wellFormed(unzipList(pptxBytes('# <&> **fett** "x"')).read('ppt/slides/slide1.xml')));
  assert.ok(unzipList(pptxBytes('')).names.includes('ppt/slides/slide1.xml'), 'leere Eingabe gibt trotzdem eine Folie');
});

test('PDF: Kopf, Umlaute in WinAnsi, Seitenumbruch, Verweistabelle stimmt', () => {
  assert.deepEqual(toCodes('äß€'), [0xE4, 0xDF, 0x80]);
  assert.deepEqual(toCodes('a😀b'), [97, 98]); assert.deepEqual(toCodes('→'), [45, 62]);
  assert.equal(glyphWidth(65, 'F1'), 667); assert.equal(glyphWidth(65, 'F3'), 600); assert.ok(glyphWidth(0xE4, 'F2') > 500);
  const md = '# Titel ä\n\n' + Array.from({ length: 80 }, (_, i) => `Absatz ${i} mit Text.`).join('\n\n') + '\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```';
  const bytes = pdfBytes(md);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  const pages = Number(/\/Count (\d+)/.exec(text)[1]);
  assert.ok(pages >= 2, 'mehrere Seiten');
  assert.match(text, /Seite 1 von \d+/);
  // Verweistabelle: jeder Eintrag zeigt auf „n 0 obj“
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  const entries = text.slice(xref).split('\n').slice(3).filter(l => /^\d{10} 00000 n/.test(l));
  entries.forEach((l, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, Number(l.slice(0, 10))), `Objekt ${i + 1}`));
  assert.ok(pdfBytes('').length > 300, 'leeres Dokument ist gültig');
  const f = path.join(tmp, 'x.pdf'); fs.writeFileSync(f, bytes);
  try { assert.match(execFileSync('pdftotext', [f, '-']).toString(), /Titel ä/); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('Word: echte Tabelle, kein Denkprozess, gültiges Archiv', async () => {
  const blob = markdownToDocx('<think>geheim</think>\n# T\n\nText **fett**\n\n| A | B |\n|---|---|\n| 1 | <2> |');
  const z = unzipList(Buffer.from(await blob.arrayBuffer()));
  const doc = z.read('word/document.xml');
  assert.ok(wellFormed(doc)); assert.match(doc, /<w:tbl>/); assert.match(doc, /&lt;2&gt;/); assert.ok(!doc.includes('geheim'));
  assert.ok(doc.indexOf('</w:tbl>') < doc.indexOf('<w:sectPr>') && /<\/w:tbl><w:p>/.test(doc), 'nach der Tabelle folgt ein Absatz');
});

test('ZIP-Beschreibung: Dateien, Pfade werden bereinigt, Archiv ist lesbar', () => {
  const files = parseZipSpec('=== index.html ===\n<h1>Hi</h1>\n\n=== css/style.css ===\nbody{}\n--- Datei: ../../x/../y.txt ---\nz\n=== index.html ===\ndoppelt');
  assert.deepEqual(files.map(f => f.name), ['index.html', 'css/style.css', 'x/y.txt', '4-index.html']);
  assert.equal(files[0].content, '<h1>Hi</h1>\n');
  assert.equal(parseZipSpec('nur Text')[0].name, 'datei.txt');
  const z = unzipList(makeZip(files));
  assert.deepEqual(z.names, files.map(f => f.name)); assert.equal(z.read('css/style.css'), 'body{}\n');
});

test('Vorschau-Bündelung: CSS und JS werden eingebettet, Fremdes bleibt, Fehlendes wird gemeldet', () => {
  const html = '<!doctype html><link rel="stylesheet" href="./style.css"><link rel="stylesheet" href="https://cdn.x/a.css"><body><script src="app.js"></script><script src="https://cdn.x/lib.js"></script><script src="fehlt.js"></script>';
  const r = bundleHtml(html, [{ file: 'style.css', lang: 'css', code: 'b{}</style>' }, { file: 'app.js', lang: 'js', code: 'x="</script>"' }]);
  assert.match(r.html, /<style>\nb\{\}<\\\/style>\n<\/style>/); assert.match(r.html, /<script>\nx="<\\\/script>"\n<\/script>/);
  assert.match(r.html, /href="https:\/\/cdn\.x\/a\.css"/); assert.match(r.html, /src="https:\/\/cdn\.x\/lib\.js"/);
  assert.deepEqual(r.inlined, ['./style.css', 'app.js']);
  assert.deepEqual(r.missing, ['fehlt.js']);
  const guess = bundleHtml('<script src="script.js"></script>', [{ file: '', lang: 'javascript', code: 'a()' }]);
  assert.match(guess.html, /<script>\na\(\)\n<\/script>/, 'einziger JS-Block ohne passenden Namen wird genommen');
});

test('Formate: Zuordnung, Dateinamen, Export im Block und als Antwort', async () => {
  assert.deepEqual(formatsFor('XLSX'), ['xlsx']); assert.deepEqual(formatsFor('csv'), ['xlsx']); assert.deepEqual(formatsFor('svg'), ['png', 'jpg']);
  assert.deepEqual(formatsFor('md'), ['docx', 'pdf']); assert.deepEqual(formatsFor('js'), []);
  assert.ok(isNativeLang('pptx') && isNativeLang('zip') && !isNativeLang('csv') && !isNativeLang('svg'));
  assert.equal(outName('Budget 2026.xlsx', 'xlsx'), 'Budget 2026.xlsx'); assert.equal(outName('', 'pptx'), 'praesentation.pptx'); assert.equal(outName('a/b/Bericht.docx', 'pdf'), 'Bericht.pdf');
  const x = await exportBlock({ lang: 'xlsx', code: 'a;b\n1;2', file: 'T.xlsx' });
  assert.equal(x.name, 'T.xlsx'); assert.ok(x.blob.size > 1000);
  assert.equal(await exportBlock({ lang: 'js', code: 'x' }), null);
  assert.deepEqual(messageExports('Text').map(e => e.fmt), ['docx', 'pdf', 'md', 'txt']);
  assert.deepEqual(messageExports('# A\n## B\n| x |\n|---|\n| 1 |').map(e => e.fmt), ['docx', 'pdf', 'pptx', 'xlsx', 'md', 'txt']);
  for (const fmt of ['docx', 'pdf', 'pptx', 'xlsx', 'md', 'txt']) {
    const r = exportMessage('<think>x</think>\n# A\n## B\n- p\n| x |\n|---|\n| 1 |', fmt, 'Mein Chat');
    assert.ok(r && r.blob.size > 10 && r.name.startsWith('Mein Chat.'), fmt);
  }
  assert.ok(!/geheim|\*\*|```/.test(await exportMessage('<think>geheim</think>**fett**\n```js\nx\n```', 'txt').blob.text()));
});
