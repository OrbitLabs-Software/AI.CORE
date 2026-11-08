import test from 'node:test';
import assert from 'node:assert/strict';
const models = await import('../server/models.js');
const logs = await import('../server/logbuffer.js');
const cfg = { ollamaUrl: 'http://127.0.0.1:11434' };
const ndjson = (lines) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n')); c.close(); } }));
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); };

test('Modellnamen werden geprüft', () => {
  for (const n of ['llama3.2:3b', 'hf.co/user/model:Q4_K_M', 'moondream']) assert.equal(models.validName(n), true, n);
  for (const n of ['', ' x', '../etc/passwd', 'a b', 'x;rm -rf', '-x', 'a'.repeat(101), null]) assert.equal(models.validName(n), false, String(n));
});
test('Pull: Fortschritt, Ende, nur ein Auftrag', async () => {
  models._resetJob(); const real = globalThis.fetch; let release;
  globalThis.fetch = async () => { await new Promise(r => { release = r; }); return ndjson([{ status: 'pulling manifest' }, { status: 'pulling a', total: 200, completed: 50 }, { status: 'success' }]); };
  try {
    models.startPull('llama3.2:3b', cfg);
    assert.throws(() => models.startPull('qwen2.5:3b', cfg), /gerade/);
    release(); await until(() => models.pullStatus().done);
    const st = models.pullStatus(); assert.equal(st.error, null); assert.equal(st.percent, 100);
  } finally { globalThis.fetch = real; models._resetJob(); }
});
test('Pull: Fehler und Abbruch', async () => {
  models._resetJob(); const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ndjson([{ error: 'file does not exist' }]);
    models.startPull('x1', cfg); await until(() => models.pullStatus().done); assert.match(models.pullStatus().error, /does not exist/);
    models._resetJob();
    globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    models.startPull('lang', cfg); assert.equal(models.cancelPull(), true); await until(() => models.pullStatus().done);
    assert.equal(models.pullStatus().error, 'Abgebrochen.');
  } finally { globalThis.fetch = real; models._resetJob(); }
});
test('Meldungen: Geheimnisse unkenntlich, Filter, Reihenfolge, Obergrenze', () => {
  logs._clear();
  logs.add('log', ['Start'], 1);
  logs.add('warn', ['[search] 429 key=SUPERGEHEIM123&x=1'], 2);
  logs.add('error', ['Bearer abcdefghijklmnop1234 sk_live_ABCDEFGH12345678 ' + 'a1'.repeat(20)], 3);
  const all = logs.getLogs();
  assert.deepEqual(all.map(e => e.level), ['error', 'warn', 'log']);
  assert.ok(all.every(e => !/SUPERGEHEIM|abcdefghijklmnop|ABCDEFGH12345678|(a1){20}/.test(e.msg)));
  assert.deepEqual(logs.getLogs({ level: 'error' }).map(e => e.level), ['error']);
  for (let i = 0; i < 400; i++) logs.add('log', [`n${i}`], i);
  assert.ok(logs.getLogs({ limit: 1000 }).length <= 300);
});
