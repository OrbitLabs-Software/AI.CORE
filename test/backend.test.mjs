// Backend-Tests: node --test test/   (startet Server + simuliertes Ollama)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures');

// ---------- simuliertes Ollama ----------
const calls = { chat: [], generate: [], pull: [] };
let slowMs = 0;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    const json = () => { try { return JSON.parse(b); } catch { return {}; } };
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ models: [{ name: 'deepseek-r1:1.5b', size: 1.1e9 }, { name: 'llava:7b', size: 4.7e9 }, { name: 'llama3.2:3b', size: 2e9 }] }));
    }
    if (req.url === '/api/ps') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ models: [{ name: 'deepseek-r1:1.5b' }] })); }
    if (req.url === '/api/generate') { calls.generate.push(json()); res.setHeader('Content-Type', 'application/json'); return res.end('{"done":true}'); }
    if (req.url === '/api/pull') {
      calls.pull.push(json());
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write('{"status":"pulling manifest"}\n');
      res.write('{"status":"downloading","total":100,"completed":40}\n');
      return res.end('{"status":"success"}\n');
    }
    if (req.url === '/api/chat') {
      calls.chat.push(json());
      res.setHeader('Content-Type', 'application/x-ndjson');
      const parts = ['<think>', 'Denke ', '</think>', 'Antwort ', 'fertig.'];
      let i = 0;
      const t = setInterval(() => {
        if (i < parts.length) res.write(JSON.stringify({ message: { role: 'assistant', content: parts[i++] }, done: false }) + '\n');
        else { clearInterval(t); res.end(JSON.stringify({ done: true, eval_count: 20, eval_duration: 2e9, prompt_eval_count: 50, load_duration: 5e8, total_duration: 3e9 }) + '\n'); }
      }, slowMs || 5);
      return;
    }
    res.statusCode = 404; res.end();
  });
});

let FAKE_PORT;
before(async () => { await new Promise(r => fake.listen(0, '127.0.0.1', r)); FAKE_PORT = fake.address().port; });
after(() => fake.close());

// ---------- Server-Helfer ----------
let nextPort = 3400;
async function withServer(env, fn) {
  const port = nextPort++;
  const dataDir = fs.mkdtempSync('/tmp/aicore-');
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OLLAMA_URL: `http://127.0.0.1:${FAKE_PORT}`, AI_PROVIDER: 'ollama',
      OLLAMA_WARMUP: 'false', SESSION_SECRET: 'x'.repeat(40), AICORE_DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${base}/api/config`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  try { await fn(base, () => log); } finally { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); }
}

async function readSse(res) {
  const text = await res.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find(l => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice(5).trim();
    events.push(payload === '[DONE]' ? { done: true } : JSON.parse(payload));
  }
  return events;
}
const post = (base, url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// ---------- Tests ----------
test('Quellcode, package.json und .env werden NICHT ausgeliefert', async () => {
  await withServer({}, async (base) => {
    for (const p of ['/server/ai.js', '/package.json', '/.env', '/.env.example', '/data/session.secret', '/uploads/x.txt', '/node_modules/express/package.json']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 404, `${p} sollte 404 sein, war ${r.status}`);
    }
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/src/js/app.js')).status, 200);
    const r = await fetch(base + '/');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('Ohne Passwort: Config und Health offen, Modellliste da', async () => {
  await withServer({}, async (base) => {
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.authRequired, false);
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.reachable, true);
    assert.deepEqual(h.models.map(m => m.id), ['ollama/deepseek-r1:1.5b', 'ollama/llava:7b', 'ollama/llama3.2:3b']);
    assert.equal(h.model, 'ollama/deepseek-r1:1.5b'); assert.equal(h.status.cloud.enabled, false);
    assert.deepEqual(h.loaded, ['deepseek-r1:1.5b']);
  });
});

test('Passwortschutz: 401 ohne Login, Login-Cookie, falsches Passwort, Brute-Force-Sperre, Logout', async () => {
  await withServer({ ACCESS_PASSWORD: 'geheim123' }, async (base) => {
    assert.equal((await fetch(base + '/api/health')).status, 401);
    assert.equal((await post(base, '/api/chat/stream', { messages: [{ role: 'user', content: 'hi' }] })).status, 401);
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.authRequired, true); assert.equal(cfg.authenticated, false);

    const bad = await post(base, '/api/login', { password: 'falsch' });
    assert.equal(bad.status, 401);

    const ok = await post(base, '/api/login', { password: 'geheim123' });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
    const c = cookie.split(';')[0];
    assert.equal((await fetch(base + '/api/health', { headers: { cookie: c } })).status, 200);
    assert.equal((await (await fetch(base + '/api/config', { headers: { cookie: c } })).json()).authenticated, true);

    // manipuliertes Token wird abgelehnt
    assert.equal((await fetch(base + '/api/health', { headers: { cookie: 'aicore_session=9999999999999.abc' } })).status, 401);

    const lo = await post(base, '/api/logout', {}, { cookie: c });
    assert.match(lo.headers.get('set-cookie'), /Max-Age=0/);
  });
  await withServer({ ACCESS_PASSWORD: 'geheim123' }, async (base) => {
    let last;
    for (let i = 0; i < 10; i++) last = (await post(base, '/api/login', { password: 'nein' })).status;
    assert.equal(last, 429);
    // auch das richtige Passwort ist während der Sperre blockiert
    assert.equal((await post(base, '/api/login', { password: 'geheim123' })).status, 429);
  });
});

test('Fremder Ursprung (CSRF) wird bei POST abgelehnt', async () => {
  await withServer({}, async (base) => {
    const r = await post(base, '/api/warmup', { model: 'x' }, { Origin: 'http://evil.example' });
    assert.equal(r.status, 403);
    const ok = await post(base, '/api/warmup', { model: 'x' }, { Origin: base });
    assert.equal(ok.status, 202);
  });
});

test('Chat: Streaming, Denkblock, Statistik (Tokens/s), Anhänge im Kontext', async () => {
  calls.chat.length = 0;
  await withServer({}, async (base) => {
    const res = await post(base, '/api/chat/stream', {
      model: 'deepseek-r1:1.5b',
      system: 'Antworte wie ein Pirat.',
      temperature: 0.2,
      messages: [{ role: 'user', content: 'Fasse zusammen', attachments: [{ name: 'notiz.txt', text: 'Das Codewort lautet ZEBRA42.' }] }],
    });
    const ev = await readSse(res);
    const text = ev.filter(e => e.delta).map(e => e.delta).join('');
    assert.equal(text, '<think>Denke </think>Antwort fertig.');
    const meta = ev.find(e => e.meta).meta;
    assert.equal(meta.tokens, 20); assert.equal(meta.tps, 10); assert.equal(meta.promptTokens, 50);
    assert.ok(ev.at(-1).done);

    const sent = calls.chat.at(-1);
    assert.equal(sent.options.temperature, 0.2);
    // R1: keine System-Rolle, Anweisung steht in der ersten Nutzernachricht
    assert.equal(sent.messages[0].role, 'user');
    assert.match(sent.messages[0].content, /Antworte wie ein Pirat\./);
    assert.match(sent.messages[0].content, /\[Anhang: notiz\.txt\][\s\S]*ZEBRA42/);
  });
});

test('Chat: Nicht-R1-Modelle bekommen System-Rolle; alter Denktext fliegt aus dem Verlauf', async () => {
  calls.chat.length = 0;
  await withServer({}, async (base) => {
    await readSse(await post(base, '/api/chat/stream', {
      model: 'llama3.2:3b',
      messages: [
        { role: 'user', content: 'Hallo' },
        { role: 'assistant', content: '<think>geheime Gedanken</think>Hi!' },
        { role: 'user', content: 'Und jetzt?' },
      ],
    }));
    const sent = calls.chat.at(-1);
    assert.equal(sent.messages[0].role, 'system');
    const all = JSON.stringify(sent.messages);
    assert.ok(!all.includes('geheime Gedanken'));
    assert.ok(all.includes('Hi!'));
  });
});

test('Chat: langer Verlauf wird gekürzt, letzte Nachricht bleibt, Hinweis kommt', async () => {
  calls.chat.length = 0;
  await withServer({ OLLAMA_NUM_CTX: '1024', AI_MAX_TOKENS: '256' }, async (base) => {
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'user', content: `Frage ${i} ` + 'x'.repeat(300) });
      messages.push({ role: 'assistant', content: `Antwort ${i} ` + 'y'.repeat(300) });
    }
    messages.push({ role: 'user', content: 'LETZTE-FRAGE' });
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'llama3.2:3b', messages }));
    const notice = ev.find(e => e.notice === 'trimmed');
    assert.ok(notice && notice.dropped > 40, 'Kürzung muss gemeldet werden');
    const sent = calls.chat.at(-1).messages;
    assert.ok(sent.length < 20, `gesendet: ${sent.length}`);
    assert.match(sent.at(-1).content, /LETZTE-FRAGE/);
    assert.equal(sent[1].role, 'user', 'Verlauf beginnt mit einer Nutzernachricht (nach der System-Rolle)');
  });
});

test('Bilder: Vision-Modell bekommt sie, andere Modelle nicht (mit Hinweis)', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const body = (model) => ({ model, messages: [{ role: 'user', content: 'Was ist das?', attachments: [{ name: 'bild.png', image: png }] }] });
  calls.chat.length = 0;
  await withServer({}, async (base) => {
    await readSse(await post(base, '/api/chat/stream', body('llava:7b')));
    const v = calls.chat.at(-1).messages.at(-1);
    assert.equal(v.images.length, 1); assert.ok(!v.images[0].startsWith('data:'));

    const ev = await readSse(await post(base, '/api/chat/stream', body('llama3.2:3b')));
    const t = calls.chat.at(-1).messages.at(-1);
    assert.equal(t.images, undefined);
    assert.match(t.content, /kann keine Bilder ansehen/);
    assert.ok(ev.some(e => e.notice === 'images_ignored'));
  });
});

test('Zu viele Nachrichten: Rate-Limit und gleichzeitige Anfragen', async () => {
  await withServer({ RATE_LIMIT_PER_MIN: '3' }, async (base) => {
    const m = { messages: [{ role: 'user', content: 'x' }], model: 'llama3.2:3b' };
    const s = [];
    for (let i = 0; i < 5; i++) { const r = await post(base, '/api/chat/stream', m); s.push(r.status); await r.text(); }
    assert.deepEqual(s, [200, 200, 200, 429, 429]);
  });
  slowMs = 200;
  await withServer({ MAX_CONCURRENT_CHATS: '1' }, async (base) => {
    const m = { messages: [{ role: 'user', content: 'x' }], model: 'llama3.2:3b' };
    const first = post(base, '/api/chat/stream', m);
    await new Promise(r => setTimeout(r, 150));
    const second = await post(base, '/api/chat/stream', m);
    assert.equal(second.status, 429);
    assert.equal((await first).status, 200);
  });
  slowMs = 0;
});

test('Warm-up beim Start und per API, Modellliste, Modell-Download mit Fortschritt', async () => {
  calls.generate.length = 0; calls.pull.length = 0;
  await withServer({ OLLAMA_WARMUP: 'true', OLLAMA_MODEL: 'deepseek-r1:1.5b' }, async (base, log) => {
    for (let i = 0; i < 40 && !calls.generate.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(calls.generate[0].model, 'deepseek-r1:1.5b');
    assert.ok(calls.generate[0].keep_alive);

    await post(base, '/api/warmup', { model: 'llama3.2:3b' });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(calls.generate.at(-1).model, 'llama3.2:3b');

    const models = await (await fetch(base + '/api/models')).json();
    assert.equal(models.models.length, 3); assert.equal(models.admin, true);

    const ev = await readSse(await post(base, '/api/models/pull', { name: 'qwen2.5:0.5b' }));
    assert.ok(ev.some(e => e.percent === 40));
    assert.ok(ev.some(e => e.done));
    assert.equal(calls.pull[0].model, 'qwen2.5:0.5b');

    assert.equal((await post(base, '/api/models/pull', { name: '../../etc/passwd' })).status, 400);
  });
  await withServer({ ALLOW_MODEL_ADMIN: 'false' }, async (base) => {
    assert.equal((await post(base, '/api/models/pull', { name: 'qwen2.5:0.5b' })).status, 403);
  });
});

test('Upload: txt, pdf, docx, Bild, Binärdatei — nichts landet auf der Festplatte', async () => {
  await withServer({}, async (base) => {
    const up = async (file, type) => {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(path.join(FIX, file))], { type }), file);
      return (await fetch(base + '/api/upload', { method: 'POST', body: fd })).json();
    };
    const txt = await up('sample.txt', 'text/plain');
    assert.equal(txt.kind, 'text'); assert.match(txt.extractedText, /90 Tage/);
    const pdf = await up('sample.pdf', 'application/pdf');
    assert.equal(pdf.kind, 'pdf'); assert.match(pdf.extractedText, /ZEBRA42/); assert.equal(pdf.pages, 1);
    const docx = await up('sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(docx.kind, 'docx'); assert.match(docx.extractedText, /Falke/);
    const bin = await up('blob.bin', 'application/octet-stream');
    assert.equal(bin.extractedText, null); assert.ok(bin.note);
    const png = await up('sample.txt', 'image/png'); // Bild-MIME ohne passende Endung
    assert.ok(png);
    assert.equal(fs.existsSync(path.join(ROOT, 'uploads')), false, 'es gibt keinen Upload-Ordner mehr');
  });
});

test('Fallback: Ollama nicht erreichbar → Demo-Antwort mit Begründung', async () => {
  await withServer({ OLLAMA_URL: 'http://127.0.0.1:9' }, async (base) => {
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.reachable, false);
    const ev = await readSse(await post(base, '/api/chat/stream', { messages: [{ role: 'user', content: 'Hallo' }] }));
    const text = ev.filter(e => e.delta).map(e => e.delta).join('');
    assert.match(text, /Demo-Modus/); assert.match(text, /nicht erreichbar/);
    assert.ok(ev.some(e => e.demo));
  });
});

// ---------- Firebase-Anmeldung ----------
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PROJECT = 'orbitlabs-test';
let keyPair, otherKey, jwksServer, JWKS_URL;
before(async () => {
  keyPair = await generateKeyPair('RS256');
  otherKey = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  jwksServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(r => jwksServer.listen(0, '127.0.0.1', r));
  JWKS_URL = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
});
after(() => jwksServer?.close());

const fbEnv = (extra = {}) => ({
  FIREBASE_PROJECT_ID: PROJECT, FIREBASE_API_KEY: 'AIzaFAKE', FIREBASE_JWKS_URL: JWKS_URL,
  FIREBASE_PROVIDERS: 'password,google,github', ALLOWED_EMAILS: 'brett@example.com', ...extra,
});

async function idToken({ email = 'brett@example.com', verified = true, aud = PROJECT, key, exp = '1h', name = 'Brett Test', iss, sub = 'uid-123', phone, provider = 'password' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { auth_time: now - 5, firebase: { sign_in_provider: provider } };
  if (email) { claims.email = email; claims.email_verified = verified; }
  if (name) claims.name = name;
  if (phone) claims.phone_number = phone;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss || `https://securetoken.google.com/${PROJECT}`)
    .setAudience(aud).setSubject(sub).setIssuedAt(now - 5).setExpirationTime(exp)
    .sign((key || keyPair).privateKey);
}

test('Firebase: Oberfläche bekommt Web-Konfiguration und Anbieter, nichts Geheimes', async () => {
  await withServer(fbEnv({ ACCESS_PASSWORD: '' }), async (base) => {
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.authRequired, true);
    assert.equal(cfg.methods.password, false);
    assert.equal(cfg.methods.firebase.projectId, PROJECT);
    assert.equal(cfg.methods.firebase.authDomain, `${PROJECT}.firebaseapp.com`);
    assert.deepEqual(cfg.methods.firebase.providers, ['password', 'google', 'github']);
    assert.ok(!JSON.stringify(cfg).includes('JWKS'));
    const csp = (await fetch(base + '/')).headers.get('content-security-policy');
    assert.match(csp, /https:\/\/www\.gstatic\.com/); assert.match(csp, /identitytoolkit/);
  });
  await withServer({}, async (base) => {   // ohne Firebase bleibt die CSP streng
    const csp = (await fetch(base + '/')).headers.get('content-security-policy');
    assert.ok(!csp.includes('gstatic.com/') && !csp.includes('googleapis.com') || /fonts\./.test(csp));
    assert.ok(!/script-src[^;]*gstatic/.test(csp));
  });
});

test('Firebase: gültiges Token → Sitzung mit Identität, Chat-Zugriff, Logout', async () => {
  await withServer(fbEnv(), async (base) => {
    assert.equal((await fetch(base + '/api/health')).status, 401);
    const res = await post(base, '/api/auth/firebase', { idToken: await idToken() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, 'brett@example.com'); assert.equal(body.user.name, 'Brett Test');
    const cookie = res.headers.get('set-cookie').split(';')[0];
    assert.match(res.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await fetch(base + '/api/health', { headers: { cookie } })).status, 200);
    const cfg = await (await fetch(base + '/api/config', { headers: { cookie } })).json();
    assert.equal(cfg.authenticated, true); assert.equal(cfg.user.email, 'brett@example.com');
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'Hi' }] }, { cookie }));
    assert.ok(ev.some(e => e.delta));
    // Cookie fälschen: andere E-Mail im Token-Inhalt, Signatur unverändert → abgelehnt
    const [payload, mac] = decodeURIComponent(cookie.split('=')[1]).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), email: 'admin@example.com' })).toString('base64url');
    assert.equal((await fetch(base + '/api/health', { headers: { cookie: `aicore_session=${forged}.${mac}` } })).status, 401);
  });
});

test('Firebase: falsche Signatur, falsche Zielgruppe, falscher Aussteller, abgelaufen, Müll → 401', async () => {
  await withServer(fbEnv(), async (base) => {
    const cases = {
      'fremder Schlüssel': await idToken({ key: otherKey }),
      'falsche Zielgruppe': await idToken({ aud: 'anderes-projekt' }),
      'falscher Aussteller': await idToken({ iss: 'https://securetoken.google.com/anderes-projekt' }),
      'abgelaufen': await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      'Müll': 'x'.repeat(120),
    };
    for (const [name, tok] of Object.entries(cases)) {
      const r = await post(base, '/api/auth/firebase', { idToken: tok });
      assert.equal(r.status, 401, `${name}: ${r.status}`);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    assert.equal((await post(base, '/api/auth/firebase', {})).status, 401);
  });
});

test('Firebase: Zugangsliste — unbestätigte Adresse, fremde Adresse, Domain, alle, keine Liste', async () => {
  await withServer(fbEnv(), async (base) => {
    const un = await post(base, '/api/auth/firebase', { idToken: await idToken({ verified: false }) });
    assert.equal(un.status, 403); assert.match((await un.json()).error, /bestätige/);
    const other = await post(base, '/api/auth/firebase', { idToken: await idToken({ email: 'fremd@example.com' }) });
    assert.equal(other.status, 403); assert.match((await other.json()).error, /nicht freigegeben/);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ email: 'BRETT@Example.com' }) })).status, 200, 'Groß-/Kleinschreibung egal');
  });
  await withServer(fbEnv({ ALLOWED_EMAILS: '', ALLOWED_EMAIL_DOMAINS: '@orbitlabs.dev' }), async (base) => {
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ email: 'wer@orbitlabs.dev' }) })).status, 200);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ email: 'wer@evil.dev' }) })).status, 403);
  });
  await withServer(fbEnv({ ALLOWED_EMAILS: '', ALLOW_ANY_FIREBASE_USER: 'true' }), async (base) => {
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ email: 'irgendwer@x.org' }) })).status, 200);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ verified: false }) })).status, 403, 'auch hier nur bestätigte Adressen');
  });
  await withServer(fbEnv({ ALLOWED_EMAILS: '' }), async (base, log) => {
    const r = await post(base, '/api/auth/firebase', { idToken: await idToken() });
    assert.equal(r.status, 403); assert.match((await r.json()).error, /niemand freigegeben|noch niemand/);
    assert.match(log(), /ALLOWED_UIDS und ALLOWED_EMAILS sind leer/);
  });
});

test('Firebase: Google nicht erreichbar → 503; ohne Firebase-Konfiguration → 400; Brute-Force-Sperre', async () => {
  await withServer(fbEnv({ FIREBASE_JWKS_URL: 'http://127.0.0.1:9/jwks' }), async (base) => {
    const r = await post(base, '/api/auth/firebase', { idToken: await idToken() });
    assert.equal(r.status, 503);
  });
  await withServer({ ACCESS_PASSWORD: 'geheim123' }, async (base) => {
    assert.equal((await post(base, '/api/auth/firebase', { idToken: 'x'.repeat(100) })).status, 400);
  });
  await withServer(fbEnv(), async (base) => {
    let last;
    for (let i = 0; i < 10; i++) last = (await post(base, '/api/auth/firebase', { idToken: 'x'.repeat(100) })).status;
    assert.equal(last, 429);
  });
});

test('Firebase und Passwort gleichzeitig; nur Firebase → Passwort-Login ist aus', async () => {
  await withServer(fbEnv({ ACCESS_PASSWORD: 'geheim123' }), async (base) => {
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.methods.password, true); assert.ok(cfg.methods.firebase);
    assert.equal((await post(base, '/api/login', { password: 'geheim123' })).status, 200);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken() })).status, 200);
  });
  await withServer(fbEnv(), async (base) => {
    assert.equal((await post(base, '/api/login', { password: 'irgendwas' })).status, 400);
  });
});

test('Firebase: Benutzer-ID und Handynummer als Freigabe, Gäste nie, Telefon ohne E-Mail', async () => {
  // genau die Admin-ID der OrbitLabs-Webseite — kommt auch ohne bestätigte E-Mail herein
  await withServer(fbEnv({ ALLOWED_EMAILS: '', ALLOWED_UIDS: 'BqjMsG66UdOSqmqJDpkVBt7FR8h2' }), async (base) => {
    const ok = await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'BqjMsG66UdOSqmqJDpkVBt7FR8h2', verified: false }) });
    assert.equal(ok.status, 200);
    const phoneUser = await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'BqjMsG66UdOSqmqJDpkVBt7FR8h2', email: null, name: null, phone: '+436601234567', provider: 'phone' }) });
    assert.equal(phoneUser.status, 200);
    assert.equal((await phoneUser.json()).user.name, '+436601234567');
    // andere ID, gleiche E-Mail → nein
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'fremde-id' }) })).status, 403);
    // Gast nie, auch nicht mit passender ID
    const guest = await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'BqjMsG66UdOSqmqJDpkVBt7FR8h2', email: null, name: null, provider: 'anonymous' }) });
    assert.equal(guest.status, 403); assert.match((await guest.json()).error, /Gast/);
  });
  await withServer(fbEnv({ ALLOWED_EMAILS: '', ALLOWED_PHONES: '+436601234567' }), async (base) => {
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'p1', email: null, name: null, phone: '+436601234567', provider: 'phone' }) })).status, 200);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'p2', email: null, name: null, phone: '+436609999999', provider: 'phone' }) })).status, 403);
  });
  await withServer(fbEnv({ ALLOWED_EMAILS: '', ALLOW_ANY_FIREBASE_USER: 'true' }), async (base) => {
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'p3', email: null, name: null, phone: '+436601111111', provider: 'phone' }) })).status, 200);
    assert.equal((await post(base, '/api/auth/firebase', { idToken: await idToken({ sub: 'g', email: null, name: null, provider: 'anonymous' }) })).status, 403);
  });
});

test('Firebase: Telefon-Anmeldung öffnet reCAPTCHA in der CSP, ohne Telefon nicht', async () => {
  await withServer(fbEnv({ FIREBASE_PROVIDERS: 'password,google,github,phone' }), async (base) => {
    const csp = (await fetch(base + '/')).headers.get('content-security-policy');
    assert.match(csp, /script-src[^;]*recaptcha/); assert.match(csp, /frame-src[^;]*www\.google\.com/);
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.deepEqual(cfg.methods.firebase.providers, ['password', 'google', 'github', 'phone']);
  });
  await withServer(fbEnv({ FIREBASE_PROVIDERS: 'password,google' }), async (base) => {
    const csp = (await fetch(base + '/')).headers.get('content-security-policy');
    assert.ok(!/recaptcha/.test(csp));
  });
});


// ======================= 3.0: Cloud (DeepSeek), Erinnerungen, Vorschau =======================
const cloudCalls = [];
let cloudMode = 'ok';
const cloud = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    if (req.url !== '/chat/completions') { res.statusCode = 404; return res.end(); }
    cloudCalls.push({ auth: req.headers.authorization, body: JSON.parse(b) });
    if (cloudMode === '401') { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: { message: 'Authentication Fails' } })); }
    res.setHeader('Content-Type', 'text/event-stream');
    const chunks = [
      { choices: [{ delta: { role: 'assistant', reasoning_content: 'Ich ' } }] },
      { choices: [{ delta: { reasoning_content: 'rechne.' } }] },
      { choices: [{ delta: { content: 'Das Ergebnis ' } }] },
      { choices: [{ delta: { content: 'ist 42.' } }] },
      { choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } },
    ];
    let i = 0;
    const t = setInterval(() => {
      if (i < chunks.length) res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`);
      else { clearInterval(t); res.end('data: [DONE]\n\n'); }
    }, 5);
  });
});
let CLOUD_URL;
before(async () => { await new Promise(r => cloud.listen(0, '127.0.0.1', r)); CLOUD_URL = `http://127.0.0.1:${cloud.address().port}`; });
after(() => cloud.close());

const cloudEnv = (extra = {}) => ({ OLLAMA_URL: '', AI_PROVIDER: '', CLOUD_API_KEY: 'sk-test', CLOUD_BASE_URL: CLOUD_URL, CLOUD_MODELS: 'deepseek-flash', CLOUD_THINKING_PARAM: 'true', ...extra });
const textOf = (ev) => ev.filter(e => e.delta).map(e => e.delta).join('');

test('Cloud: Modelle (DeepSeek V4.1 Flash, Denkmodus), Standardquelle ohne Ollama', async () => {
  await withServer(cloudEnv(), async (base) => {
    const m = await (await fetch(base + '/api/models')).json();
    assert.deepEqual(m.models.map(x => x.id), ['cloud/deepseek-flash', 'cloud/deepseek-flash+think']);
    assert.equal(m.models[0].label, 'DeepSeek V4.1 Flash'); assert.match(m.models[1].label, /Denkmodus/);
    assert.equal(m.models[0].group, 'Cloud · DeepSeek'); assert.equal(m.defaultModel, 'cloud/deepseek-flash');
    assert.equal(m.status.ollama.enabled, false); assert.equal(m.admin, false);
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.mode, 'live'); assert.equal(h.reachable, null);
    assert.ok(!JSON.stringify(h).includes('sk-test'), 'Schlüssel darf nie nach außen');
  });
  await withServer(cloudEnv({ CLOUD_THINKING: 'false' }), async (base) => {
    assert.deepEqual((await (await fetch(base + '/api/models')).json()).models.map(x => x.id), ['cloud/deepseek-flash']);
  });
});

test('Cloud: Denkmodus → <think>-Block, Statistik, korrekte Anfrage an DeepSeek', async () => {
  cloudCalls.length = 0;
  await withServer(cloudEnv({ CLOUD_BASE_URL: CLOUD_URL.replace('127.0.0.1', 'localhost') + '/' }), async (base) => {
    const ev = await readSse(await post(base, '/api/chat/stream', {
      model: 'cloud/deepseek-flash+think', temperature: 0.3, system: 'Sei kurz.',
      messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: '<think>alt</think>Hallo' }, { role: 'user', content: 'Wie viel ist 6*7?' }],
    }));
    assert.equal(textOf(ev), '<think>Ich rechne.</think>Das Ergebnis ist 42.');
    const meta = ev.find(e => e.meta).meta;
    assert.equal(meta.tokens, 12); assert.equal(meta.promptTokens, 30); assert.match(meta.model, /deepseek-flash.*Denkmodus/);
    const call = cloudCalls.at(-1);
    assert.equal(call.auth, 'Bearer sk-test');
    assert.equal(call.body.model, 'deepseek-flash'); assert.equal(call.body.stream, true);
    assert.deepEqual(call.body.thinking, { type: 'enabled' }); assert.equal(call.body.reasoning_effort, 'high');
    assert.equal(call.body.temperature, undefined, 'im Denkmodus keine Temperatur');
    assert.equal(call.body.messages[0].role, 'system'); assert.match(call.body.messages[0].content, /Sei kurz/);
    assert.ok(!JSON.stringify(call.body.messages).includes('alt</think>'), 'alter Denktext fliegt raus');
  });
});

test('Cloud: Schnellmodus, fremde Anbieter ohne thinking-Feld, Bilder, Fehler 401 → Demo mit Grund', async () => {
  cloudCalls.length = 0;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await withServer(cloudEnv(), async (base) => {
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'cloud/deepseek-flash', temperature: 0.7,
      messages: [{ role: 'user', content: 'Was ist das?', attachments: [{ name: 'a.png', image: png }] }] }));
    assert.equal(textOf(ev), '<think>Ich rechne.</think>Das Ergebnis ist 42.', 'Antwortfelder werden auch ohne Denkmodus korrekt umgesetzt');
    const call = cloudCalls.at(-1).body;
    assert.deepEqual(call.thinking, { type: 'disabled' }); assert.equal(call.temperature, 0.7); assert.equal(call.reasoning_effort, undefined);
    const last = call.messages.at(-1);
    assert.equal(last.content[0].type, 'image_url'); assert.match(last.content[0].image_url.url, /^data:image\/png;base64,/);
    assert.deepEqual(last.content.at(-1), { type: 'text', text: 'Was ist das?' });
  });
  await withServer(cloudEnv({ CLOUD_MODELS: 'meta/llama', CLOUD_THINKING_PARAM: 'false' }), async (base) => {
    await readSse(await post(base, '/api/chat/stream', { model: 'cloud/meta/llama', messages: [{ role: 'user', content: 'x' }] }));
    assert.equal(cloudCalls.at(-1).body.thinking, undefined, 'Fremdanbieter bekommen kein thinking-Feld');
  });
  cloudMode = '401';
  await withServer(cloudEnv(), async (base) => {
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'cloud/deepseek-flash', messages: [{ role: 'user', content: 'x' }] }));
    assert.match(textOf(ev), /Demo-Modus/); assert.match(textOf(ev), /401 Authentication Fails/);
  });
  cloudMode = 'ok';
});

test('Modell-Wahl: Ollama und Cloud gleichzeitig, falsche Quelle → klarer Hinweis, alte Namen gehen an den Standard', async () => {
  calls.chat.length = 0; cloudCalls.length = 0;
  await withServer({ ...cloudEnv(), OLLAMA_URL: `http://127.0.0.1:${FAKE_PORT}`, AI_PROVIDER: 'ollama' }, async (base) => {
    const m = await (await fetch(base + '/api/models')).json();
    assert.deepEqual(m.models.map(x => x.group).filter((g, i, a) => a.indexOf(g) === i), ['Lokal (Tiny)', 'Cloud · DeepSeek']);
    assert.equal(m.defaultModel, 'ollama/deepseek-r1:1.5b'); assert.equal(m.admin, true);
    await readSse(await post(base, '/api/chat/stream', { model: 'ollama/llama3.2:3b', messages: [{ role: 'user', content: 'a' }] }));
    assert.equal(calls.chat.at(-1).model, 'llama3.2:3b');
    await readSse(await post(base, '/api/chat/stream', { model: 'cloud/deepseek-flash', messages: [{ role: 'user', content: 'b' }] }));
    assert.equal(cloudCalls.at(-1).body.model, 'deepseek-flash');
    await readSse(await post(base, '/api/chat/stream', { model: 'core-large', messages: [{ role: 'user', content: 'c' }] }));
    assert.equal(calls.chat.at(-1).model, 'deepseek-r1:1.5b', 'Platzhalter → Standardmodell');
    await readSse(await post(base, '/api/chat/stream', { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'd' }] }));
    assert.equal(calls.chat.at(-1).model, 'llama3.2:3b', 'alter Name ohne Präfix funktioniert weiter');
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'anthropic/claude-x', messages: [{ role: 'user', content: 'e' }] }));
    assert.match(textOf(ev), /nicht eingerichtet/);
  });
});

test('Erinnerungen: speichern, doppelt, zu kurz, löschen — und sie fließen in den Chat ein', async () => {
  calls.chat.length = 0;
  await withServer({}, async (base) => {
    assert.deepEqual((await (await fetch(base + '/api/memories')).json()).items, []);
    const a = await post(base, '/api/memories', { text: '  Ich heiße Brett\nund wohne in   Oberösterreich ' });
    assert.equal(a.status, 201);
    const item = (await a.json()).item;
    assert.equal(item.text, 'Ich heiße Brett und wohne in Oberösterreich');
    assert.equal((await post(base, '/api/memories', { text: 'ich heiße brett und wohne in oberösterreich' })).status, 409);
    assert.equal((await post(base, '/api/memories', { text: 'a' })).status, 400);
    await post(base, '/api/memories', { text: 'Ich programmiere am liebsten in JavaScript' });
    assert.equal((await (await fetch(base + '/api/memories')).json()).items.length, 2);

    // Chat: Erinnerungen stehen im Systemprompt (R1: in der ersten Nutzernachricht)
    const ev = await readSse(await post(base, '/api/chat/stream', { model: 'llama3.2:3b', messages: [{ role: 'user', content: 'Wer bin ich?' }] }));
    assert.ok(ev.some(e => e.notice === 'memory'));
    assert.match(calls.chat.at(-1).messages[0].content, /Ich heiße Brett/); assert.match(calls.chat.at(-1).messages[0].content, /JavaScript/);
    // ausgeschaltet (pro Anfrage)
    const ev2 = await readSse(await post(base, '/api/chat/stream', { model: 'llama3.2:3b', memory: false, messages: [{ role: 'user', content: 'Wer bin ich?' }] }));
    assert.ok(!ev2.some(e => e.notice === 'memory')); assert.ok(!calls.chat.at(-1).messages[0].content.includes('Ich heiße Brett'));

    assert.equal((await fetch(base + '/api/memories/' + item.id, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(base + '/api/memories/' + item.id, { method: 'DELETE' })).status, 404);
    assert.equal((await (await fetch(base + '/api/memories', { method: 'DELETE' })).json()).removed, 1);
  });
  await withServer({ MEMORY: 'false' }, async (base) => {
    assert.equal((await post(base, '/api/memories', { text: 'Test Erinnerung' })).status, 403);
    assert.equal((await (await fetch(base + '/api/memories')).json()).enabled, false);
  });
});

test('Erinnerungen: pro Konto getrennt (Firebase), Datei auf dem Server, kein Zugriff ohne Login', async () => {
  await withServer(fbEnv({ ALLOWED_EMAILS: 'a@example.com,b@example.com' }), async (base) => {
    assert.equal((await fetch(base + '/api/memories')).status, 401);
    const login = async (email, sub) => (await post(base, '/api/auth/firebase', { idToken: await idToken({ email, sub, name: email }) })).headers.get('set-cookie').split(';')[0];
    const ca = await login('a@example.com', 'uid-a'); const cb = await login('b@example.com', 'uid-b');
    await post(base, '/api/memories', { text: 'Geheimnis von A' }, { cookie: ca });
    const listA = await (await fetch(base + '/api/memories', { headers: { cookie: ca } })).json();
    const listB = await (await fetch(base + '/api/memories', { headers: { cookie: cb } })).json();
    assert.equal(listA.items.length, 1); assert.equal(listB.items.length, 0);
    assert.equal((await fetch(base + '/api/memories/' + listA.items[0].id, { method: 'DELETE', headers: { cookie: cb } })).status, 404, 'fremde Erinnerung nicht löschbar');
  });
});

test('Vorschau: HTML/SVG in der Sandbox, Größenlimit, Ablauf, Login-Pflicht', async () => {
  await withServer({ ACCESS_PASSWORD: 'geheim123' }, async (base) => {
    const cookie = (await post(base, '/api/login', { password: 'geheim123' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await post(base, '/api/preview', { kind: 'html', code: '<h1>x</h1>' })).status, 401);
    const r = await post(base, '/api/preview', { kind: 'html', code: '<button onclick="alert(1)">Klick</button>' }, { cookie });
    const { url } = await r.json();
    assert.match(url, /^\/preview\/[0-9a-f]{32}$/);
    assert.equal((await fetch(base + url)).status, 401, 'ohne Cookie kein Zugriff');
    const page = await fetch(base + url, { headers: { cookie } });
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /^sandbox allow-scripts/); assert.match(csp, /connect-src 'none'/); assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(await page.text(), /<!doctype html>[\s\S]*<base target="_blank">[\s\S]*Klick/i);

    const svg = await (await post(base, '/api/preview', { kind: 'svg', code: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>' }, { cookie })).json();
    assert.match(await (await fetch(base + svg.url, { headers: { cookie } })).text(), /<svg[\s\S]*circle/);
    const full = await (await post(base, '/api/preview', { kind: 'html', code: '<!DOCTYPE html><html><head><title>t</title></head><body>ok</body></html>' }, { cookie })).json();
    assert.match(await (await fetch(base + full.url, { headers: { cookie } })).text(), /<head><meta charset="utf-8">/);

    assert.equal((await post(base, '/api/preview', { kind: 'html', code: 'x'.repeat(450 * 1024) }, { cookie })).status, 413);
    assert.equal((await fetch(base + '/preview/' + 'a'.repeat(32), { headers: { cookie } })).status, 404);
    const main = (await fetch(base + '/')).headers.get('content-security-policy');
    assert.match(main, /frame-src 'self'/);
  });
});

test('Konfiguration: DeepSeek-Adresse schaltet das thinking-Feld automatisch ein, Standardmodell ist deepseek-flash', async () => {
  const { getConfig, defaultModelId } = await import('../server/ai.js');
  const keep = { ...process.env };
  try {
    for (const k of ['CLOUD_BASE_URL', 'CLOUD_THINKING_PARAM', 'CLOUD_MODELS', 'OLLAMA_URL', 'AI_PROVIDER', 'AI_API_KEY']) delete process.env[k];
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    let c = getConfig();
    assert.equal(c.cloudBase, 'https://api.deepseek.com'); assert.equal(c.cloudThinkingParam, true);
    assert.deepEqual(c.cloudModels, ['deepseek-flash']); assert.equal(c.provider, 'cloud'); assert.equal(defaultModelId(c), 'cloud/deepseek-flash');
    process.env.CLOUD_BASE_URL = 'https://api.groq.com/openai/v1';
    c = getConfig(); assert.equal(c.cloudThinkingParam, false);
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});
