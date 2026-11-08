import test from 'node:test';
import assert from 'node:assert/strict';

const models = await import('../server/models.js');
const logs = await import('../server/logbuffer.js');
const search = await import('../server/search.js');

const cfg = { ollamaUrl: 'http://127.0.0.1:11434' };
const ndjson = (lines) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n')); c.close(); } }));
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); };

test('Modellnamen werden geprüft', () => {
  for (const n of ['llama3.2:3b', 'qwen2.5:1.5b', 'hf.co/user/model:Q4_K_M', 'moondream']) assert.equal(models.validName(n), true, n);
  for (const n of ['', ' x', '../etc/passwd', 'a b', 'x;rm -rf', '-x', 'a'.repeat(101), null, 5]) assert.equal(models.validName(n), false, String(n));
});

test('Pull: Fortschritt in Prozent, Ende mit „success“, nur ein Auftrag gleichzeitig', async () => {
  models._resetJob();
  const real = globalThis.fetch;
  let release;
  globalThis.fetch = async (url, opts) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/pull');
    const body = JSON.parse(opts.body); assert.equal(body.model, 'llama3.2:3b'); assert.equal(body.stream, true);
    await new Promise(r => { release = r; });
    return ndjson([{ status: 'pulling manifest' }, { status: 'pulling abc', total: 200, completed: 50 }, { status: 'pulling abc', total: 200, completed: 200 }, { status: 'verifying sha256 digest' }, { status: 'success' }]);
  };
  try {
    assert.equal(models.startPull('llama3.2:3b', cfg).done, false);
    assert.throws(() => models.startPull('qwen2.5:3b', cfg), /gerade/);
    assert.throws(() => models.startPull('böse name', cfg), /gültig/);
    release();
    await until(() => models.pullStatus().done);
    const st = models.pullStatus();
    assert.equal(st.error, null); assert.equal(st.percent, 100); assert.equal(st.status, 'success'); assert.equal(st.done, true);
    assert.doesNotThrow(() => { models._resetJob(); models.startPull('moondream', cfg); models.cancelPull(); });
  } finally { globalThis.fetch = real; models._resetJob(); }
});

test('Pull: Fehler von Ollama und Abbruch werden gemeldet', async () => {
  models._resetJob();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ndjson([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]);
    models.startPull('gibt-es-nicht', cfg); await until(() => models.pullStatus().done);
    assert.match(models.pullStatus().error, /does not exist/);
    models._resetJob();
    globalThis.fetch = async () => new Response('x', { status: 404 });
    models.startPull('weg', cfg); await until(() => models.pullStatus().done);
    assert.match(models.pullStatus().error, /gibt es bei Ollama nicht/);
    models._resetJob();
    globalThis.fetch = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    models.startPull('lang', cfg); assert.equal(models.cancelPull(), true); await until(() => models.pullStatus().done);
    assert.equal(models.pullStatus().error, 'Abgebrochen.');
  } finally { globalThis.fetch = real; models._resetJob(); }
});

test('Modell löschen: richtiger Aufruf, Fehlermeldungen', async () => {
  const real = globalThis.fetch; let seen;
  try {
    globalThis.fetch = async (url, opts) => { seen = { url: String(url), method: opts.method, body: JSON.parse(opts.body) }; return new Response('{}', { status: 200 }); };
    await models.deleteModel('llama3.2:1b', cfg);
    assert.equal(seen.method, 'DELETE'); assert.equal(seen.url, 'http://127.0.0.1:11434/api/delete'); assert.equal(seen.body.model, 'llama3.2:1b');
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(models.deleteModel('x1', cfg), /nicht installiert/);
    await assert.rejects(models.deleteModel('../x', cfg), /gültig/);
  } finally { globalThis.fetch = real; }
});

test('Meldungen: Schlüssel und lange Kennungen werden unkenntlich, Filter und Reihenfolge stimmen', () => {
  logs._clear();
  logs.add('log', ['Start %s', 'ok'], 1);
  logs.add('warn', ['[search] Brave: Fehler 429 key=SUPERGEHEIM123&x=1'], 2);
  logs.add('error', ['Authorization: Bearer abcdefghijklmnop1234 und sk_live_ABCDEFGH12345678 und ' + 'a1'.repeat(20)], 3);
  const all = logs.getLogs();
  assert.deepEqual(all.map(e => e.level), ['error', 'warn', 'log']);          // neueste zuerst
  assert.ok(all.every(e => !/SUPERGEHEIM|abcdefghijklmnop|ABCDEFGH12345678|(a1){20}/.test(e.msg)), all.map(e => e.msg).join(' | '));
  assert.deepEqual(logs.getLogs({ level: 'warn' }).map(e => e.level), ['error', 'warn']);
  assert.deepEqual(logs.getLogs({ level: 'error' }).map(e => e.level), ['error']);
  for (let i = 0; i < 400; i++) logs.add('log', [`n${i}`], i);
  assert.ok(logs.getLogs({ limit: 1000 }).length <= 300);
});

test('readPage: Titel und Text, Heimnetz bleibt gesperrt, zu wenig Text wird gemeldet', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => String(url) === 'https://8.8.8.8/artikel'
      ? new Response(`<html><head><title>Ein &amp; Titel</title></head><body><main><h1>Überschrift</h1>${'<p>Inhalt des Artikels mit Text.</p>'.repeat(30)}</main></body></html>`, { headers: { 'content-type': 'text/html' } })
      : new Response('<html><body>hi</body></html>', { headers: { 'content-type': 'text/html' } });
    const r = await search.readPage('https://8.8.8.8/artikel');
    assert.equal(r.title, 'Ein & Titel'); assert.match(r.text, /Inhalt des Artikels/); assert.equal(r.url, 'https://8.8.8.8/artikel');
    await assert.rejects(search.readPage('https://8.8.8.8/leer'), /kaum Text/);
    await assert.rejects(search.readPage('http://192.168.1.190:3000/api/memories'), /nicht erlaubt/);
  } finally { globalThis.fetch = real; }
});
