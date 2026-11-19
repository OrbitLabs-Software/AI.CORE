#!/usr/bin/env node
// aicore-coder — Coder Ultimate für die Konsole (Windows, macOS, Linux). Keine Abhängigkeiten, ein einziges Programm.
// Du beschreibst eine Aufgabe, die KI liest und schreibt Dateien im aktuellen Ordner, führt Befehle (mit deiner Erlaubnis)
// aus und testet Programme im Linux-Testlabor deines AI-Core-Servers. Gehört zu AI Core Pro.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

const VERSION = '1.0.0';
const CONFIG = path.join(os.homedir(), '.aicore-coder.json');
const DEFAULT_SERVER = 'https://obitlabs.tailc8dd2c.ts.net';
const MAX_STEPS = 10;

// ---------- Farben ----------
let color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = (s) => c(2, s), bold = (s) => c(1, s), red = (s) => c(31, s), green = (s) => c(32, s), yellow = (s) => c(33, s), cyan = (s) => c(36, s), violet = (s) => c('38;5;141', s);

// ---------- Konfiguration ----------
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf-8')); } catch { return {}; } }
function saveConfig(cfg) { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 }); }

// ---------- Pfade ----------
/** Pfad innerhalb des Projektordners auflösen; alles außerhalb wird abgelehnt. */
function safeJoin(root, rel) {
  const p = String(rel ?? '').trim();
  if (!p || p.includes('\0')) return null;
  const full = path.resolve(root, p);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', 'target', '.next', '.cache']);
/** Textdateien des Projekts für das Testlabor einsammeln (klein, ohne Binärdateien und Abhängigkeiten). */
function collectFiles(root, { maxFiles = 300, maxBytes = 6_000_000, maxFile = 400_000 } = {}) {
  const out = []; let total = 0;
  (function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.size > maxFile || total + st.size > maxBytes) continue;
      let buf; try { buf = fs.readFileSync(full); } catch { continue; }
      if (buf.includes(0)) continue;                          // Binärdatei
      total += st.size;
      out.push({ path: path.relative(root, full).split(path.sep).join('/'), content: buf.toString('utf-8') });
    }
  })(root);
  return out;
}

// ---------- Werkzeuge der KI ----------
// Format, das auch kleine Modelle zuverlässig schaffen:
//   ~~~aicore write pfad/datei.py
//   ...Inhalt...
//   ~~~
const TOOL_RE = /^~~~aicore[ \t]+(write|read|list|run|test)[ \t]*([^\n]*)\n([\s\S]*?)\n?^~~~[ \t]*$/gm;
function parseTools(text) {
  const clean = String(text ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const tools = []; let m;
  TOOL_RE.lastIndex = 0;
  while ((m = TOOL_RE.exec(clean))) tools.push({ tool: m[1], arg: m[2].trim(), body: m[3] });
  return tools;
}

const DENY = [/\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)\s+(\/|~|\$HOME|\*)(\s|$)/i, /\bmkfs\b/i, /:\(\)\s*\{/, /\bdd\s+.*of=\/dev\//i, />\s*\/dev\/sd/i, /\bformat\s+[a-z]:/i, /\bdel\s+\/[sq]/i, /\bshutdown\b|\breboot\b/i];
const forbidden = (cmd) => DENY.some(r => r.test(cmd));

const SYSTEM = `Du bist Coder Ultimate, ein Programmier-Agent in der Konsole des Nutzers. Du arbeitest im Projektordner des Nutzers.
Du hast diese Werkzeuge. Schreibe sie genau so, mit ~~~ am Anfang und am Ende, höchstens fünf pro Antwort:

~~~aicore list .
~~~
(zeigt Dateien des Ordners)

~~~aicore read pfad/datei.py
~~~
(liest eine Datei)

~~~aicore write pfad/datei.py
kompletter neuer Inhalt der Datei
~~~
(schreibt oder ersetzt die ganze Datei)

~~~aicore run
befehl für die Konsole des Nutzers
~~~
(läuft auf dem Rechner des Nutzers, der muss es erlauben; nur wenn nötig)

~~~aicore test
befehl für Linux, zum Beispiel: python3 main.py
~~~
(läuft im Linux-Testlabor, ohne Netz, mit allen Projektdateien in /work; zum Testen deiner Programme)

Regeln: Schau dir zuerst die Dateien an, bevor du etwas änderst. Schreibe ganze Dateien, keine Auszüge. Teste Programme mit dem test-Werkzeug und korrigiere Fehler, bis es läuft. Wenn du fertig bist, antworte ohne Werkzeug mit einer kurzen Zusammenfassung auf Deutsch. Erfinde keine Ausgaben.`;

/** Zeigt die Antwort live an, versteckt aber die Werkzeug-Blöcke (~~~aicore … ~~~); die werden unten als Zeile gezeigt. */
function liveFilter(write) {
  let raw = '', done = 0, inTool = false;
  const line = (l) => {
    if (inTool) { if (/^~~~\s*$/.test(l)) inTool = false; return; }
    if (/^~~~aicore\b/.test(l)) { inTool = true; return; }
    write(l + '\n');
  };
  const visible = () => {          // Denktext weg; angefangene Tags am Ende zurückhalten
    let v = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const open = v.indexOf('<think>'); if (open >= 0) v = v.slice(0, open);
    const part = /<(t(h(i(n(k)?)?)?)?|\/(t(h(i(n(k)?)?)?)?)?)?$/.exec(v); if (part) v = v.slice(0, part.index);
    return v;
  };
  return {
    push(s) {
      raw += s;
      const v = visible();
      let i;
      while ((i = v.indexOf('\n', done)) >= 0) { line(v.slice(done, i)); done = i + 1; }
    },
    end() { const rest = visible().slice(done); if (rest && !inTool && !/^~~~/.test(rest)) write(rest + '\n'); done = visible().length; },
  };
}

// ---------- Verbindung zum Server ----------
class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }

function makeApi({ server, token }) {
  const base = String(server).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  async function check(res) {
    if (res.ok) return res;
    let msg = `Fehler ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* kein JSON */ }
    if (res.status === 401) msg = 'Anmeldung abgelaufen oder ungültig. Neuen Zugangsschlüssel holen: aicore-coder login';
    throw new ApiError(msg, res.status);
  }
  const post = (p, body, signal) => fetch(`${base}${p}`, { method: 'POST', headers, body: JSON.stringify(body), signal }).then(check);
  return {
    base,
    async *chat({ messages, system, model, signal }) {
      const res = await post('/api/chat/stream', { messages, system, model, memory: false, temperature: 0.2 }, signal);
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try { yield JSON.parse(data); } catch { /* unvollständig */ }
          }
        }
      }
    },
    async coderStatus() { return (await fetch(`${base}/api/coder/status`, { headers }).then(check)).json(); },
    async coderRun(command, files) { return (await post('/api/coder/run', { command, files, timeout: 60 })).json(); },
    async coderShot(command, files) { return (await post('/api/coder/screenshot', { command, files, delay: 3 })).json(); },
    async coderReset() { await fetch(`${base}/api/coder/files`, { method: 'DELETE', headers }).then(check); },
  };
}

// ---------- Lokal ausführen (mit Erlaubnis) ----------
function runLocal(cmd, cwd, onData) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d) => { const s = d.toString(); if (out.length < 40_000) out += s; onData?.(s); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[Abbruch nach 120 Sekunden]'; }, 120_000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
  });
}

function ask(rl, question) { return new Promise((resolve) => rl.question(question, (a) => resolve(a))); }

// ---------- Agent ----------
/**
 * Eine Aufgabe bearbeiten. io = { say(text), write(text), confirm(cmd) → Promise<boolean> } (für Tests austauschbar).
 * Gibt den Verlauf zurück, damit die Unterhaltung weitergeführt werden kann.
 */
async function runTask(task, { api, cwd, model, history = [], yes = false, io }) {
  const messages = [...history, { role: 'user', content: task }];
  const synced = new Map();     // Pfad → Hash, damit nur Geändertes zum Testlabor geht
  let lastTokens = null;
  for (let step = 1; step <= MAX_STEPS; step++) {
    let reply = '';
    io.write(`\n${violet('●')} `);
    const live = liveFilter(io.write);
    try {
      for await (const ev of api.chat({ messages, system: SYSTEM, model })) {
        if (ev.delta) { reply += ev.delta; live.push(ev.delta); }
        if (ev.tokens) lastTokens = ev.tokens;
      }
      live.end();
    } catch (e) { io.say(`\n${red('✖')} ${e.message}`); return { messages, ok: false }; }
    messages.push({ role: 'assistant', content: reply });
    const tools = parseTools(reply).slice(0, 5);
    if (!tools.length) { if (lastTokens && lastTokens.left != null) io.say(dim(`   Token übrig: ${Math.floor(lastTokens.left).toLocaleString('de-AT')}`)); return { messages, ok: true }; }

    const results = [];
    for (const t of tools) {
      try {
        if (t.tool === 'list') {
          const dir = safeJoin(cwd, t.arg || '.'); if (!dir) throw new Error('Pfad liegt außerhalb des Projekts');
          const files = collectFiles(dir).map(f => f.path);
          results.push(`list ${t.arg || '.'}:\n${files.length ? files.join('\n') : '(leer)'}`);
          io.say(dim(`   ☰ list ${t.arg || '.'} (${files.length} Dateien)`));
        } else if (t.tool === 'read') {
          const file = safeJoin(cwd, t.arg); if (!file) throw new Error('Pfad liegt außerhalb des Projekts');
          const text = fs.readFileSync(file, 'utf-8');
          results.push(`read ${t.arg}:\n${text.slice(0, 30_000)}${text.length > 30_000 ? '\n[gekürzt]' : ''}`);
          io.say(dim(`   📄 read ${t.arg}`));
        } else if (t.tool === 'write') {
          const file = safeJoin(cwd, t.arg); if (!file) throw new Error('Pfad liegt außerhalb des Projekts');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const existed = fs.existsSync(file);
          fs.writeFileSync(file, t.body.endsWith('\n') ? t.body : `${t.body}\n`);
          results.push(`write ${t.arg}: ok (${t.body.split('\n').length} Zeilen)`);
          io.say(`   ${green('✎')} ${existed ? 'geändert' : 'neu'}: ${t.arg}`);
        } else if (t.tool === 'run') {
          const cmd = t.body.trim() || t.arg;
          if (forbidden(cmd)) { results.push(`run: abgelehnt (gefährlicher Befehl)`); io.say(`   ${red('✖')} abgelehnt: ${cmd}`); continue; }
          io.say(`   ${yellow('$')} ${cmd}`);
          if (!yes && !(await io.confirm(cmd))) { results.push('run: vom Nutzer abgelehnt'); io.say(dim('   übersprungen')); continue; }
          const r = await runLocal(cmd, cwd, (s) => io.write(dim(s)));
          results.push(`run ${cmd} → Exit ${r.code}\n${r.out.slice(-6000)}`);
        } else if (t.tool === 'test') {
          const cmd = t.body.trim() || t.arg;
          io.say(`   ${cyan('🐧')} Linux-Testlabor: ${cmd}`);
          const files = collectFiles(cwd).filter(f => { const h = crypto.createHash('sha1').update(f.content).digest('hex'); if (synced.get(f.path) === h) return false; synced.set(f.path, h); return true; });
          const r = await api.coderRun(cmd, files);
          if (r.error) throw new Error(r.error);
          io.write(dim((r.output || '').replace(/\n?$/, '\n')));
          io.say(`   ${r.exitCode === 0 ? green('✔ Exit 0') : red(`✖ Exit ${r.exitCode}${r.timedOut ? ' (Zeitlimit)' : ''}`)}`);
          results.push(`test ${cmd} → Exit ${r.exitCode}${r.timedOut ? ' (Zeitlimit)' : ''}\n${(r.output || '').slice(-6000)}`);
        }
      } catch (e) {
        io.say(`   ${red('✖')} ${t.tool}: ${e.message}`);
        results.push(`${t.tool} ${t.arg}: Fehler: ${e.message}`);
        if (e.status === 402 || e.status === 401) return { messages, ok: false };
      }
    }
    messages.push({ role: 'user', content: `Ergebnisse der Werkzeuge:\n\n${results.join('\n\n---\n\n')}\n\nMach weiter oder fasse zusammen, wenn du fertig bist.` });
  }
  io.say(yellow(`\nNach ${MAX_STEPS} Schritten angehalten. Schreibe "weiter", um fortzufahren.`));
  return { messages, ok: true };
}

// ---------- Konsole ----------
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--no-color') o.noColor = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (['--server', '--token', '--model', '--dir'].includes(a)) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

const HELP = `${bold('Coder Ultimate')} ${dim(`v${VERSION}`)}  ·  AI Core Pro

  aicore-coder                    Unterhaltung im aktuellen Ordner starten
  aicore-coder "Aufgabe"          eine Aufgabe erledigen und beenden
  aicore-coder login              Server und Zugangsschlüssel speichern
  aicore-coder status             Verbindung, Pro und Linux-Testlabor prüfen

Optionen:  --server URL  --token KEY  --model ID  --dir ORDNER  --yes (Befehle ohne Nachfrage)  --no-color

In der Unterhaltung:  /test BEFEHL (im Linux-Testlabor)  /shot BEFEHL (Programm mit Fenster testen, speichert shot.png)  /reset  /clear  /status  /exit
  aicore-coder chat               nur Unterhaltung, ohne Dateien und Befehle
Der Zugangsschlüssel steht in AI Core unter Einstellungen → Pro → Coder Ultimate.`;

let lastLeft = null;
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.noColor) color = false;
  if (args.version) return console.log(VERSION);
  if (args.help) return console.log(HELP);
  const cfg = loadConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => process.exit(0));

  if (args._[0] === 'login') {
    const server = (await ask(rl, `Server [${cfg.server || DEFAULT_SERVER}]: `)).trim() || cfg.server || DEFAULT_SERVER;
    const token = (await ask(rl, 'Zugangsschlüssel (aus AI Core → Einstellungen → Pro): ')).trim() || cfg.token;
    saveConfig({ ...cfg, server, token });
    console.log(green('✔ Gespeichert in ') + CONFIG);
    return rl.close();
  }

  const server = args.server || process.env.AICORE_SERVER || cfg.server || DEFAULT_SERVER;
  const token = args.token || process.env.AICORE_TOKEN || cfg.token;
  if (!token) { console.log(red('Noch nicht angemeldet.') + ' Führe aus: aicore-coder login'); return rl.close(); }
  const api = makeApi({ server, token });
  const cwd = path.resolve(args.dir || process.cwd());
  const model = args.model || cfg.model;

  const showStatus = async () => {
    try {
      const s = await api.coderStatus();
      console.log(`Server: ${api.base}\nPro: ${s.pro ? green('ja') : red('nein, Coder Ultimate gehört zu AI Core Pro')}\nLinux-Testlabor: ${s.available ? green('bereit') : yellow(s.reason || 'nicht verfügbar')}`);
    } catch (e) { console.log(red(`✖ ${e.message}`)); }
  };
  if (args._[0] === 'status') { await showStatus(); return rl.close(); }

  if (args._[0] === 'chat') {                             // nur Unterhaltung, ohne Werkzeuge
    console.log(`${violet('◆')} ${bold('AI Core')} ${dim('· Unterhaltung · /clear leert, /exit beendet')}`);
    let msgs = [];
    for (;;) {
      const line = (await ask(rl, `\n${cyan('›')} `)).trim();
      if (!line) continue;
      if (line === '/exit' || line === '/quit') break;
      if (line === '/clear') { msgs = []; console.log(dim('Verlauf geleert.')); continue; }
      msgs.push({ role: 'user', content: line });
      let reply = ''; const live = liveFilter((t) => process.stdout.write(t));
      process.stdout.write(`${violet('●')} `);
      try {
        for await (const ev of api.chat({ messages: msgs.slice(-24), model })) { if (ev.delta) { reply += ev.delta; live.push(ev.delta); } if (ev.tokens?.left != null) lastLeft = ev.tokens.left; }
        live.end(); msgs.push({ role: 'assistant', content: reply });
        if (lastLeft != null) console.log(dim(`   Token übrig: ${Math.floor(lastLeft).toLocaleString('de-AT')}`));
      } catch (e) { console.log(red(`\n✖ ${e.message}`)); msgs.pop(); }
    }
    return rl.close();
  }

  const io = {
    say: (t) => console.log(t), write: (t) => process.stdout.write(t),
    confirm: async (cmd) => /^(j|ja|y|yes)$/i.test((await ask(rl, `   ${yellow('Ausführen?')} [j/N] `)).trim()),
  };

  console.log(`${violet('◆')} ${bold('Coder Ultimate')} ${dim(`· ${cwd}`)}\n${dim('  Beschreibe, was gebaut oder repariert werden soll. /help für Befehle.')}`);
  let history = [];
  const one = args._.join(' ').trim();
  if (one) { await runTask(one, { api, cwd, model, yes: args.yes, io }); return rl.close(); }

  for (;;) {
    const line = (await ask(rl, `\n${cyan('›')} `)).trim();
    if (!line) continue;
    if (line === '/exit' || line === '/quit') break;
    if (line === '/help') { console.log(HELP); continue; }
    if (line === '/clear') { history = []; console.log(dim('Verlauf geleert.')); continue; }
    if (line === '/status') { await showStatus(); continue; }
    if (line.startsWith('/shot ')) {
      try {
        const r = await api.coderShot(line.slice(6), collectFiles(cwd)); if (r.error) throw new Error(r.error);
        process.stdout.write(r.output || '');
        if (r.image) { const f = path.join(cwd, 'shot.png'); fs.writeFileSync(f, Buffer.from(r.image.split(',')[1], 'base64')); console.log(green(`✔ Bild gespeichert: ${f}`)); } else console.log(yellow(r.note || 'Kein Bild.'));
      } catch (e) { console.log(red(`✖ ${e.message}`)); }
      continue;
    }
    if (line === '/reset') { try { await api.coderReset(); console.log(green('✔ Testlabor geleert')); } catch (e) { console.log(red(`✖ ${e.message}`)); } continue; }
    if (line.startsWith('/test ')) {
      try { const r = await api.coderRun(line.slice(6), collectFiles(cwd)); if (r.error) throw new Error(r.error); process.stdout.write(r.output || ''); console.log(r.exitCode === 0 ? green('✔ Exit 0') : red(`✖ Exit ${r.exitCode}`)); }
      catch (e) { console.log(red(`✖ ${e.message}`)); }
      continue;
    }
    const r = await runTask(line, { api, cwd, model, history, yes: args.yes, io });
    history = r.messages.slice(-24);
  }
  rl.close();
}

module.exports = { liveFilter, parseTools, safeJoin, collectFiles, forbidden, runTask, makeApi, SYSTEM, VERSION };
if (require.main === module) main().catch((e) => { console.error(red(`✖ ${e.message}`)); process.exit(1); });
