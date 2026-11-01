// Reine Frontend-Funktionen: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ui = await import('../src/js/ui.js');
const { makeZip, crc32 } = await import('../src/js/zip.js');
const { suggestMemory, parseRememberCommand } = await import('../src/js/hints.js');

test('Markdown: Überschriften, Listen (verschachtelt), Tabelle, Zitat, Links, durchgestrichen', () => {
  const html = ui.renderMarkdown('# Titel\n\nText **fett** und *kursiv* und ~~weg~~ mit [Link](https://a.de/x).\n\n- eins\n  - unter eins\n  - unter zwei\n- zwei\n\n1. a\n2. b\n\n> Zitat\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nBare URL https://orbitlabs.dev/seite.');
  assert.match(html, /<h1>Titel<\/h1>/);
  assert.match(html, /<strong>fett<\/strong>[\s\S]*<em>kursiv<\/em>[\s\S]*<del>weg<\/del>/);
  assert.match(html, /<a href="https:\/\/a\.de\/x" target="_blank" rel="noopener noreferrer">Link<\/a>/);
  assert.match(html, /<ul><li>eins<ul><li>unter eins<\/li><li>unter zwei<\/li><\/ul><\/li><li>zwei<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<blockquote>Zitat<\/blockquote>/);
  assert.match(html, /<table>[\s\S]*<th>A<\/th>[\s\S]*<td>2<\/td>/);
  assert.match(html, /href="https:\/\/orbitlabs\.dev\/seite"/);
});

test('Markdown: HTML wird escaped, Inline-Code bleibt unangetastet', () => {
  const html = ui.renderMarkdown('Text <script>alert(1)</script> und `a * b * c` und `<b>`.');
  assert.ok(!html.includes('<script>')); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>a \* b \* c<\/code>/); assert.match(html, /<code>&lt;b&gt;<\/code>/);
  assert.ok(!/<em>/.test(html), '* in Code ist keine Kursivschrift');
});

test('Code-Blöcke: Kopf, Dateiname, Vorschau-Knopf, offener Block beim Streamen', () => {
  const closed = ui.renderMarkdown('Hier:\n```html index.html\n<h1>Hi</h1>\n```\nFertig.');
  assert.match(closed, /<div class="code-block" data-lang="html" data-file="index\.html">/);
  assert.match(closed, /data-code-preview/); assert.match(closed, /data-code-download/); assert.match(closed, /data-code-copy/);
  assert.match(closed, /<\/div>\s*<p>Fertig\.<\/p>/);
  assert.ok(!/<p>\s*<div class="code-block"/.test(closed), 'Code-Block nicht in <p>');
  const open = ui.renderMarkdown('Code:\n```python\nprint("hi")\nfor i in');   // Stream endet mitten im Block
  assert.match(open, /code-block/); assert.ok(!/data-code-copy/.test(open), 'offener Block ohne Knöpfe');
  assert.match(open, /print/);
  const justOpened = ui.renderMarkdown('Antwort\n```js');
  assert.match(justOpened, /code-block/);
});

test('Code-Hervorhebung: Sprachen, immer escaped, keine Injektion', () => {
  const js = ui.highlight('const x = "a<b>"; // <img onerror=1>\nfoo(1)', 'js');
  assert.match(js, /<span class="tok-k">const<\/span>/); assert.match(js, /<span class="tok-s">&quot;a&lt;b&gt;&quot;<\/span>/);
  assert.match(js, /<span class="tok-c">\/\/ &lt;img onerror=1&gt;<\/span>/); assert.match(js, /<span class="tok-f">foo<\/span>/);
  assert.ok(!js.includes('<img') && !js.includes('<b>'));
  assert.match(ui.highlight('def f(x):\n  return None  # hi', 'python'), /tok-k">def[\s\S]*tok-f">f[\s\S]*tok-c"># hi/);
  assert.match(ui.highlight('{"a": [1, true, null]}', 'json'), /tok-f">&quot;a&quot;[\s\S]*tok-n">1[\s\S]*tok-k">true/);
  assert.match(ui.highlight('body { color: #fff; margin: 0px; }', 'css'), /tok-f">color[\s\S]*tok-n">#fff[\s\S]*tok-n">0px/);
  const html = ui.highlight('<div class="x" id=y><script>alert("<b>")</script></div>', 'html');
  assert.match(html, /tok-t">div<\/span>[\s\S]*tok-a">class<\/span>=<span class="tok-s">&quot;x&quot;/);
  assert.ok(!/<script>|<b>/.test(html));
  assert.match(ui.highlight('echo $HOME "x" # c', 'bash'), /tok-k">echo[\s\S]*tok-a">\$HOME/);
  assert.equal(ui.highlight('<x>', 'unbekannt'), '&lt;x&gt;');
});

test('Denkblock: offen beim Streamen, eingeklappt danach', () => {
  assert.match(ui.renderMarkdown('<think>Ich überl'), /<details class="think-block" open><summary>Denkt nach/);
  const done = ui.renderMarkdown('<think>Fertig gedacht.</think>\n\nAntwort **42**');
  assert.match(done, /<details class="think-block"><summary>Denkprozess anzeigen/); assert.match(done, /<strong>42<\/strong>/);
});

test('Hilfen: Code-Blöcke finden, Dateiinfo, Text fürs Vorlesen, Datumsgruppen, Token', () => {
  const blocks = ui.extractCodeBlocks('a\n```js:app.js\nlet a;\n```\n\n```css\nb{}\n```\n```py\nnicht fertig');
  assert.deepEqual(blocks, [{ lang: 'js', file: 'app.js', code: 'let a;' }, { lang: 'css', file: '', code: 'b{}' }]);
  assert.deepEqual(ui.parseFenceInfo('js title="x.js"'), { lang: 'js', file: 'x.js' });
  assert.deepEqual(ui.parseFenceInfo(''), { lang: '', file: '' });
  assert.equal(ui.plainText('<think>x</think>## Hallo **Welt**\n```js\ncode\n```\nEnde'), 'Hallo Welt\n(Code-Block) \nEnde');
  assert.ok(!ui.plainText('<think>x</think>Hi **du**').includes('think'));
  const now = new Date('2026-10-26T15:00:00');
  assert.equal(ui.dateGroup(new Date('2026-10-26T01:00:00'), now), 'Heute');
  assert.equal(ui.dateGroup(new Date('2026-10-25T23:00:00'), now), 'Gestern');
  assert.equal(ui.dateGroup(new Date('2026-10-22T10:00:00'), now), 'Letzte 7 Tage');
  assert.equal(ui.dateGroup(new Date('2026-10-01T10:00:00'), now), 'Letzte 30 Tage');
  assert.equal(ui.dateGroup(new Date('2026-08-01T10:00:00'), now), 'Älter');
  assert.equal(ui.estimateTokens('x'.repeat(320)), 100); assert.equal(ui.formatBytes(1536), '1.5 KB');
});

test('Erinnerungs-Hinweise: Fakten erkennen, Fragen und Befehle nicht', () => {
  assert.equal(suggestMemory('Ich heiße Brett und wohne in Oberösterreich.'), 'Ich heiße Brett und wohne in Oberösterreich');
  assert.equal(suggestMemory('Ich programmiere am liebsten in JavaScript. Hilf mir bitte.'), 'Ich programmiere am liebsten in JavaScript');
  assert.equal(suggestMemory('Mein Server heißt ObitLabs.'), 'Mein Server heißt ObitLabs');
  for (const t of ['Ich bin gespannt, ob das klappt?', 'Wie spät ist es heute?', 'Schreib mir ein Gedicht über den Herbst', 'ich bin', 'x'.repeat(500)]) assert.equal(suggestMemory(t), null, t);
  assert.equal(parseRememberCommand('Merk dir, dass ich Vegetarier bin.'), 'ich Vegetarier bin');
  assert.equal(parseRememberCommand('Bitte merke dir: Mein Hund heißt Rex'), 'Mein Hund heißt Rex');
  assert.equal(parseRememberCommand('Erinnere dich daran, dass ich Linux nutze'), 'ich Linux nutze');
  assert.equal(parseRememberCommand('Kannst du mir was merken?'), null);
});

test('ZIP: gültige Datei, Umlaute, Prüfsumme — von unzip bestätigt', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = makeZip([{ name: 'index.html', content: '<h1>Grüße €</h1>' }, { name: 'src/app.js', content: 'console.log("ä");\n'.repeat(500) }, { name: '../böse.txt', content: 'x' }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const file = path.join(dir, 't.zip'); fs.writeFileSync(file, zip);
  const listing = execFileSync('unzip', ['-l', file]).toString();
  assert.match(listing, /index\.html/); assert.match(listing, /src\/app\.js/); assert.ok(!/\.\.\//.test(listing), 'kein Pfad nach oben');
  assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
  execFileSync('unzip', ['-q', file, '-d', dir]);
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf-8'), '<h1>Grüße €</h1>');
  assert.equal(fs.readFileSync(path.join(dir, 'src/app.js'), 'utf-8').length, 'console.log("ä");\n'.length * 500);
});
