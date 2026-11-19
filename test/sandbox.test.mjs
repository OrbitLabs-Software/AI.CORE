import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-sbx-'));
const sbx = await import('../server/sandbox.js');
const sec = await import('../server/security.js').catch(() => null);   // braucht das Paket „jose“ (npm install)

test('Pfade: nur relative, keine Ausbrüche', () => {
  for (const ok of ['main.py', 'src/app.js', './a/b.txt']) assert.ok(sbx.safeRelPath(ok), ok);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a/..', 'C:\\Windows\\x', 'a\u0000b', 'x'.repeat(201), null]) assert.equal(sbx.safeRelPath(bad), null, String(bad));
});

test('Dateien schreiben, lesen, auflisten, zurücksetzen; Konten getrennt; Grenzen', () => {
  assert.equal(sbx.writeFiles('u1', [{ path: 'main.py', content: 'print(1)' }, { path: 'lib/x.txt', content: 'hi' }]).written, 2);
  assert.deepEqual(sbx.listFiles('u1').map(f => f.path), ['lib/x.txt', 'main.py']);
  assert.equal(sbx.readFile('u1', 'lib/x.txt').content, 'hi');
  assert.equal(sbx.readFile('u2', 'main.py').status, 404);
  assert.equal(sbx.writeFiles('u1', [{ path: '../evil', content: 'x' }]).status, 400);
  assert.equal(sbx.writeFiles('u1', [{ path: 'big', content: 'x'.repeat(1_000_001) }]).status, 413);
  assert.equal(sbx.writeFiles('u1', []).status, 400);
  sbx.reset('u1'); assert.deepEqual(sbx.listFiles('u1'), []);
});

test('Docker-Aufruf: kein Netz, Speicher-/Prozessgrenze, keine Rechte, Befehl als ein Argument', () => {
  const a = sbx.dockerArgs({ name: 'n1', dir: '/data/x', command: 'echo hi; rm -rf /', uid: 1000, gid: 1000 });
  assert.equal(a[a.indexOf('--network') + 1], 'none');
  assert.ok(a.includes('--cap-drop') && a.includes('no-new-privileges') && a.includes('--pids-limit'));
  assert.equal(a.at(-1), 'echo hi; rm -rf /'); assert.deepEqual(a.slice(-3, -1), ['bash', '-c']);
  assert.equal(a[a.indexOf('--user') + 1], '1000:1000');
  assert.equal(sbx.dockerArgs({ name: 'n', dir: '/d', command: 'x', network: true })[sbx.dockerArgs({ name: 'n', dir: '/d', command: 'x', network: true }).indexOf('--network') + 1], 'bridge');
});

test('Lauf: Ausgabe und Exit-Code kommen zurück; Netz bleibt aus ohne Erlaubnis; ein Lauf pro Konto', async () => {
  sbx._resetStatus();
  let seen;
  sbx._setSpawner(async (bin, args) => {
    if (args[0] === 'info') return { output: '27.0', exitCode: 0 };
    seen = args; await new Promise(r => setTimeout(r, 40)); return { output: 'hallo\n', exitCode: 3, timedOut: false };
  });
  try {
    const p = sbx.run('u3', 'python3 main.py', { network: true });
    assert.equal((await sbx.run('u3', 'echo zweiter')).status, 429);
    const r = await p;
    assert.equal(r.output, 'hallo\n'); assert.equal(r.exitCode, 3); assert.equal(r.network, false);
    assert.equal(seen[seen.indexOf('--network') + 1], 'none');
    assert.equal((await sbx.run('u3', '   ')).status, 400);
    assert.equal((await sbx.run('u3', 'x'.repeat(4001))).status, 400);
  } finally { sbx._setSpawner(null); sbx._resetStatus(); }
});

test('Ohne Docker: klare Meldung statt Absturz', async () => {
  sbx._resetStatus();
  sbx._setSpawner(async () => ({ output: '', exitCode: 127, error: 'nodocker' }));
  try { const r = await sbx.run('u4', 'ls'); assert.equal(r.status, 503); assert.match(r.error, /Docker/); }
  finally { sbx._setSpawner(null); sbx._resetStatus(); }
});

test('runProcess: Zeitlimit beendet den Prozess, Ausgabe wird begrenzt', async () => {
  const slow = await sbx.runProcess('node', ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 300 });
  assert.equal(slow.timedOut, true); assert.equal(slow.exitCode, 124);
  const loud = await sbx.runProcess('node', ['-e', 'process.stdout.write("x".repeat(500000))'], { timeoutMs: 5000, maxOut: 1000 });
  assert.ok(loud.output.length < 1100); assert.match(loud.output, /gekürzt/);
  assert.equal((await sbx.runProcess('node', ['-e', 'process.exit(7)'], { timeoutMs: 5000 })).exitCode, 7);
});

test('Desktop-App darf sich anmelden (aicore://app ist erlaubt)', { skip: !sec && 'jose fehlt' }, () => {
  assert.equal(sec.originAllowed('aicore://app'), true); assert.equal(sec.originAllowed('https://evil.example'), false);
});

test('Screenshot: Befehl geht als Umgebungsvariable in den Container, Bild kommt als data-URL zurück', async () => {
  sbx._resetStatus();
  let args;
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  sbx._setSpawner(async (bin, a) => {
    if (a[0] === 'info') return { output: '27.0', exitCode: 0 };
    args = a;
    const dir = a[a.indexOf('-v') + 1].split(':')[0];
    fs.mkdirSync(path.join(dir, '.aicore'), { recursive: true }); fs.writeFileSync(path.join(dir, '.aicore', 'shot.png'), png);
    return { output: 'gestartet\n', exitCode: 0 };
  });
  try {
    const r = await sbx.screenshot('u5', 'python3 app.py', { delay: 99 });
    assert.equal(r.image, `data:image/png;base64,${png.toString('base64')}`); assert.equal(r.exitCode, 0);
    assert.ok(args.includes('AICORE_CMD=python3 app.py')); assert.ok(args.includes('AICORE_DELAY=20'));     // höchstens 20 Sekunden
    assert.match(args.at(-1), /xvfb-run/); assert.equal(args[args.indexOf('--network') + 1], 'none');
    assert.match(sbx.readFile('u5', '.aicore/shot.sh').content, /import -window root/);
    assert.equal((await sbx.screenshot('u5', '  ')).status, 400);
  } finally { sbx._setSpawner(null); sbx._resetStatus(); }
});
