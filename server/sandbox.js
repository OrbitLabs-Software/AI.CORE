// sandbox.js — Linux-Testlabor für Coder Ultimate. Programme laufen NIE auf dem Server selbst, sondern in einem
// Docker-Container (Ubuntu): ohne Netz, mit Speicher-, CPU- und Prozessgrenze, ohne Rechte, mit Zeitlimit.
// Jedes Konto hat einen eigenen Arbeitsordner (data/sandbox/<konto>), der nach /work in den Container gelegt wird.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'sandbox');
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => { const n = Number(env(k, d)); return Number.isFinite(n) && n > 0 ? n : d; };

export const sandboxEnabled = () => process.env.SANDBOX !== 'false';
export const LIMITS = {
  files: 300, fileBytes: 1_000_000, totalBytes: 8_000_000, command: 4000,
  timeoutMs: () => Math.min(120_000, num('SANDBOX_TIMEOUT_SEC', 30) * 1000),
  maxTimeoutMs: 120_000, output: 64_000,
};

const dirFor = (key) => path.join(root(), crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 24));

/** Pfad im Arbeitsordner prüfen: nur relative Pfade ohne „..“, keine versteckten Systemdateien, keine Sonderzeichen. */
export function safeRelPath(p) {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.length > 200 || s.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(s) || /[\u0000-\u001f]/.test(s) || /^[A-Za-z]:/.test(s)) return null;
  return path.posix.normalize(s);
}

function resolveIn(base, rel) {
  const full = path.resolve(base, rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push({ path: path.relative(base, full).split(path.sep).join('/'), size: fs.statSync(full).size });
    if (out.length > 2000) break;
  }
  return out;
}

export function listFiles(key) {
  const d = dirFor(key);
  return fs.existsSync(d) ? walk(d).sort((a, b) => a.path.localeCompare(b.path)) : [];
}

export function writeFiles(key, files) {
  if (!Array.isArray(files) || !files.length) return { error: 'Keine Dateien übergeben.', status: 400 };
  const base = dirFor(key);
  const existing = listFiles(key);
  let total = existing.reduce((n, f) => n + f.size, 0);
  const incoming = [];
  for (const f of files) {
    const rel = safeRelPath(f?.path);
    if (!rel) return { error: `Ungültiger Dateipfad: ${String(f?.path).slice(0, 80)}`, status: 400 };
    const content = String(f?.content ?? '');
    const bytes = Buffer.byteLength(content);
    if (bytes > LIMITS.fileBytes) return { error: `„${rel}“ ist zu groß (höchstens ${LIMITS.fileBytes / 1_000_000} MB).`, status: 413 };
    incoming.push({ rel, content, bytes });
  }
  const names = new Set(existing.map(f => f.path));
  for (const f of incoming) {
    const prev = existing.find(e => e.path === f.rel);
    total += f.bytes - (prev?.size || 0); names.add(f.rel);
  }
  if (names.size > LIMITS.files) return { error: `Zu viele Dateien (höchstens ${LIMITS.files}).`, status: 413 };
  if (total > LIMITS.totalBytes) return { error: 'Der Arbeitsordner ist voll (8 MB). Setze ihn zurück.', status: 413 };
  for (const f of incoming) {
    const full = resolveIn(base, f.rel);
    if (!full) return { error: 'Ungültiger Dateipfad.', status: 400 };
    fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o777 });
    fs.writeFileSync(full, f.content, { mode: 0o666 });
  }
  try { fs.chmodSync(base, 0o777); } catch { /* egal */ }
  return { ok: true, written: incoming.length };
}

export function readFile(key, rel) {
  const r = safeRelPath(rel); if (!r) return { error: 'Ungültiger Dateipfad.', status: 400 };
  const full = resolveIn(dirFor(key), r);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return { error: 'Datei nicht gefunden.', status: 404 };
  if (fs.statSync(full).size > LIMITS.fileBytes) return { error: 'Datei ist zu groß zum Lesen.', status: 413 };
  return { path: r, content: fs.readFileSync(full, 'utf-8') };
}

export function reset(key) { fs.rmSync(dirFor(key), { recursive: true, force: true }); }

/** Docker-Aufruf. Der Befehl geht als EIN Argument an bash im Container, nie durch eine Shell des Servers. */
export function dockerArgs({ name, dir, command, env: extraEnv = {}, network = false, image = env('SANDBOX_IMAGE', 'aicore-sandbox:latest'), uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000 }) {
  return [
    'run', '--rm', '--name', name,
    '--network', network ? 'bridge' : 'none',
    '--memory', env('SANDBOX_MEMORY', '512m'), '--memory-swap', env('SANDBOX_MEMORY', '512m'),
    '--cpus', env('SANDBOX_CPUS', '1'), '--pids-limit', env('SANDBOX_PIDS', '256'),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', `${uid}:${gid}`,
    '-e', 'HOME=/tmp', '-e', 'TERM=xterm',
    ...Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-v', `${dir}:/work`, '-w', '/work',
    image, 'bash', '-c', command,
  ];
}

const DOCKER = () => env('SANDBOX_DOCKER_BIN', 'docker');

/** Prozess starten, Ausgabe begrenzen, nach Zeitlimit beenden. */
export function runProcess(bin, args, { timeoutMs, maxOut = LIMITS.output, onTimeout } = {}) {
  return new Promise((resolve) => {
    let out = '', cut = false, timedOut = false, done = false;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d) => { if (out.length < maxOut) out += d.toString('utf-8'); else cut = true; };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { timedOut = true; try { onTimeout?.(); } catch { /* egal */ } child.kill('SIGKILL'); }, timeoutMs);
    const finish = (code, err) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ output: out.slice(0, maxOut) + (cut ? '\n[Ausgabe gekürzt]' : ''), exitCode: timedOut ? 124 : (code ?? 1), timedOut, error: err });
    };
    child.on('error', (e) => finish(127, e.code === 'ENOENT' ? 'nodocker' : e.message));
    child.on('close', (code) => finish(code));
  });
}

let spawner = (bin, args, opts) => runProcess(bin, args, opts);
export const _setSpawner = (fn) => { spawner = fn || ((b, a, o) => runProcess(b, a, o)); };

let dockerOk = null, dockerCheckedAt = 0;
export async function status() {
  if (!sandboxEnabled()) return { available: false, reason: 'Das Testlabor ist auf dem Server abgeschaltet (SANDBOX=false).' };
  if (dockerOk === null || Date.now() - dockerCheckedAt > 60_000) {
    const r = await spawner(DOCKER(), ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 6000, maxOut: 500 });
    dockerOk = r.exitCode === 0 && !r.error; dockerCheckedAt = Date.now();
  }
  return dockerOk ? { available: true, image: env('SANDBOX_IMAGE', 'aicore-sandbox:latest') }
    : { available: false, reason: 'Docker läuft auf dem Server nicht. Installation und Image: deploy/sandbox/README.md' };
}
export const _resetStatus = () => { dockerOk = null; };

const busy = new Map();   // pro Konto nur ein Lauf gleichzeitig
export async function run(key, command, { timeoutSec, network = false, env: extraEnv = {} } = {}) {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { error: 'Kein Befehl.', status: 400 };
  if (cmd.length > LIMITS.command) return { error: 'Der Befehl ist zu lang.', status: 400 };
  const st = await status();
  if (!st.available) return { error: st.reason, status: 503 };
  if (busy.get(key)) return { error: 'Es läuft schon ein Befehl. Bitte warten.', status: 429 };
  const wantNet = Boolean(network) && process.env.SANDBOX_NETWORK === 'true';
  const dir = dirFor(key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o777 }); try { fs.chmodSync(dir, 0o777); } catch { /* egal */ }
  const name = `aicore-sbx-${crypto.randomBytes(5).toString('hex')}`;
  const timeoutMs = Math.min(LIMITS.maxTimeoutMs, Math.max(1000, (Number(timeoutSec) || 0) * 1000 || LIMITS.timeoutMs()));
  busy.set(key, true);
  const started = Date.now();
  try {
    const r = await spawner(DOCKER(), dockerArgs({ name, dir, command: cmd, env: extraEnv, network: wantNet }), {
      timeoutMs: timeoutMs + 2000, maxOut: LIMITS.output,
      onTimeout: () => spawn(DOCKER(), ['kill', name], { stdio: 'ignore' }).on('error', () => {}),
    });
    if (r.error === 'nodocker') { dockerOk = false; return { error: 'Docker wurde nicht gefunden.', status: 503 }; }
    if (/Unable to find image|pull access denied|No such image/i.test(r.output) && r.exitCode !== 0) return { error: `Das Image „${env('SANDBOX_IMAGE', 'aicore-sandbox:latest')}“ fehlt. Bauen: deploy/sandbox/README.md`, status: 503 };
    return { output: r.output, exitCode: r.exitCode, timedOut: r.timedOut, ms: Date.now() - started, network: wantNet };
  } finally { busy.delete(key); }
}

// ---------- Programme mit Oberfläche testen: virtueller Bildschirm + Screenshot ----------
const SHOT_SCRIPT = `#!/bin/bash
mkdir -p /work/.aicore
( eval "$AICORE_CMD" ) > /work/.aicore/out.txt 2>&1 &
PID=$!
sleep "$AICORE_DELAY"
import -window root /work/.aicore/shot.png 2>/work/.aicore/shot-err.txt
kill $PID 2>/dev/null
wait $PID 2>/dev/null
cat /work/.aicore/out.txt
`;

/** Befehl auf einem virtuellen Bildschirm (Xvfb) starten, nach `delay` Sekunden ein Bild aufnehmen. */
export async function screenshot(key, command, { delay = 3 } = {}) {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { error: 'Kein Befehl.', status: 400 };
  if (cmd.length > LIMITS.command) return { error: 'Der Befehl ist zu lang.', status: 400 };
  const sec = Math.min(20, Math.max(1, Math.round(Number(delay) || 3)));
  const w = writeFiles(key, [{ path: '.aicore/shot.sh', content: SHOT_SCRIPT }]);
  if (w.error) return w;
  const png = path.join(dirFor(key), '.aicore', 'shot.png');
  fs.rmSync(png, { force: true });
  const r = await run(key, 'xvfb-run -a -s "-screen 0 1280x800x24" bash /work/.aicore/shot.sh', { timeoutSec: sec + 25, env: { AICORE_CMD: cmd, AICORE_DELAY: String(sec) } });
  if (r.error) return r;
  let image = null;
  try { const buf = fs.readFileSync(png); if (buf.length > 0 && buf.length < 4_000_000) image = `data:image/png;base64,${buf.toString('base64')}`; } catch { /* kein Bild */ }
  fs.rmSync(png, { force: true });
  return { ...r, image, note: image ? '' : 'Es wurde kein Bild aufgenommen. Hat das Programm ein Fenster geöffnet?' };
}
