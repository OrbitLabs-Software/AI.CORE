import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const cli = createRequire(import.meta.url)('../cli/aicore-coder.cjs');

test('Werkzeuge aus der Antwort lesen (auch ohne Denktext)', () => {
  const t = cli.parseTools('<think>~~~aicore run\nrm x\n~~~</think>Ich lege los.\n\n~~~aicore write src/main.py\nprint("hi")\nx = 1\n~~~\n\n~~~aicore test\npython3 src/main.py\n~~~\nFertig.');
  assert.deepEqual(t.map(x => x.tool), ['write', 'test']);
  assert.equal(t[0].arg, 'src/main.py'); assert.equal(t[0].body, 'print("hi")\nx = 1'); assert.equal(t[1].body, 'python3 src/main.py');
  assert.deepEqual(cli.parseTools('Nur Text, kein Werkzeug.'), []);
});

test('Pfade bleiben im Projekt, gefährliche Befehle werden abgelehnt', () => {
  const root = path.resolve('/tmp/projekt');
  assert.equal(cli.safeJoin(root, 'a/b.txt'), path.join(root, 'a/b.txt'));
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', '', 'a\0b']) assert.equal(cli.safeJoin(root, bad), null, bad);
  for (const cmd of ['rm -rf /', 'rm -rf ~', 'sudo mkfs.ext4 /dev/sda', 'dd if=/dev/zero of=/dev/sda', ':(){ :|:& };:', 'shutdown now']) assert.equal(cli.forbidden(cmd), true, cmd);
  for (const cmd of ['npm test', 'python3 main.py', 'rm -rf build', 'ls -la']) assert.equal(cli.forbidden(cmd), false, cmd);
});

test('Projektdateien einsammeln: Text ja, node_modules/.git/Binär nein', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-')); 
  fs.mkdirSync(path.join(d, 'node_modules/x'), { recursive: true }); fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'node_modules/x/i.js'), 'x'); fs.writeFileSync(path.join(d, 'src/a.py'), 'print(1)'); fs.writeFileSync(path.join(d, 'bild.bin'), Buffer.from([1, 0, 2]));
  assert.deepEqual(cli.collectFiles(d).map(f => f.path), ['src/a.py']);
});

function mockServer(script) {
  const seen = { chat: [], runs: [] };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d);
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      if (req.headers.authorization !== 'Bearer KEY') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"x"}'); }
      if (req.url === '/api/chat/stream') {
        seen.chat.push(j); const reply = script.shift() || 'Fertig.';
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const part of reply.match(/[\s\S]{1,12}/g)) res.write(`data: ${JSON.stringify({ delta: part })}\n\n`);
        res.write(`data: ${JSON.stringify({ tokens: { left: 3000.5 } })}\n\ndata: [DONE]\n\n`); return res.end();
      }
      if (req.url === '/api/coder/run') {
        seen.runs.push(j);
        const bad = !j.files?.some(f => f.path === 'main.py' && f.content.includes('print("ok")'));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(bad ? { output: 'Traceback: SyntaxError\n', exitCode: 1 } : { output: 'ok\n', exitCode: 0 }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('Agent: schreibt Datei, testet im Labor, sieht den Fehler, korrigiert, fasst zusammen', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-run-'));
  const { server, seen, url } = await mockServer([
    'Ich schreibe das Programm.\n~~~aicore write main.py\nprint(ok)\n~~~\n~~~aicore test\npython3 main.py\n~~~',
    'Das war ein Fehler, ich korrigiere.\n~~~aicore write main.py\nprint("ok")\n~~~\n~~~aicore test\npython3 main.py\n~~~',
    'Das Programm läuft und gibt ok aus.',
  ]);
  try {
    const out = [];
    const io = { say: (t) => out.push(t), write: (t) => out.push(t), confirm: async () => false };
    const r = await cli.runTask('Schreibe ein Programm, das ok ausgibt', { api: cli.makeApi({ server: url, token: 'KEY' }), cwd, io });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'main.py'), 'utf-8'), 'print("ok")\n');
    assert.equal(seen.runs.length, 2); assert.equal(seen.runs[0].command, 'python3 main.py');
    assert.match(seen.chat[1].messages.at(-1).content, /Exit 1[\s\S]*SyntaxError/);       // die KI sieht den Fehler
    assert.match(seen.chat[2].messages.at(-1).content, /Exit 0/);
    assert.ok(seen.chat.every(c => c.system.includes('Coder Ultimate')));
    assert.match(out.join(''), /Token übrig: 3\D?000/);
  } finally { server.close(); }
});

test('Agent: lokale Befehle brauchen Erlaubnis; Pfade außerhalb werden abgelehnt; falscher Schlüssel', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-run2-'));
  const { server, seen, url } = await mockServer([
    '~~~aicore run\necho GEHEIM > erlaubt.txt\n~~~\n~~~aicore write ../draussen.txt\nx\n~~~\n~~~aicore run\nrm -rf /\n~~~',
    'Erledigt.',
  ]);
  try {
    let asked = 0; const out = [];
    const io = { say: (t) => out.push(t), write: () => {}, confirm: async () => { asked++; return false; } };
    await cli.runTask('test', { api: cli.makeApi({ server: url, token: 'KEY' }), cwd, io });
    assert.equal(asked, 1);                                              // nur der harmlose Befehl wurde gefragt, der gefährliche gar nicht
    assert.equal(fs.existsSync(path.join(cwd, 'erlaubt.txt')), false);
    assert.equal(fs.existsSync(path.join(path.dirname(cwd), 'draussen.txt')), false);
    const feedback = seen.chat[1].messages.at(-1).content;
    assert.match(feedback, /vom Nutzer abgelehnt/); assert.match(feedback, /außerhalb des Projekts/); assert.match(feedback, /gefährlicher Befehl/);
    const r = await cli.runTask('noch eins', { api: cli.makeApi({ server: url, token: 'FALSCH' }), cwd, io });
    assert.equal(r.ok, false); assert.match(out.join('\n'), /Anmeldung abgelaufen/);
    seen.chat.length = 0;
    await cli.runTask('mit --yes', { api: cli.makeApi({ server: url, token: 'KEY' }), cwd, io, yes: true });
  } finally { server.close(); }
});

test('Live-Anzeige versteckt Werkzeug-Blöcke und Denktext, auch wenn sie in Stücken ankommen', () => {
  let out = ''; const f = cli.liveFilter((t) => { out += t; });
  for (const part of ['Ich <thi', 'nk>geheim</think>lege los.\n~~~aic', 'ore write a.py\nprint(1)\n~~', '~\nFertig', ' jetzt.']) f.push(part);
  f.end();
  assert.equal(out, 'Ich lege los.\nFertig jetzt.\n');
});
