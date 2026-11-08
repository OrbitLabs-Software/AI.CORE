#!/usr/bin/env node
// AI Core Coder Ultimate — arbeitet in deinem aktuellen Ordner, testet Programme in einem abgeschotteten Linux (Docker).
// Aufruf:  coder login | coder | coder "Aufgabe" | coder --auto | coder --net | coder sandbox-reset
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const CONF = path.join(os.homedir(), '.aicore-coder.json');
const IMAGE = 'aicore-coder-sandbox:1';
const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const rest = args.filter(a => !a.startsWith('--'));
const AUTO = flag('--auto');       // Befehle im Linux ohne Nachfrage ausführen (Dateien werden trotzdem erfragt, außer mit --yes)
const YES = flag('--yes');
const NET = flag('--net');         // Netzwerk im Linux erlauben (z. B. für pip/npm install)

const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(90, s), bold = (s) => c(1, s), red = (s) => c(31, s), green = (s) => c(32, s), cyan = (s) => c(36, s);
const out = (s = '') => process.stdout.write(s);
const die = (m) => { console.error(red(m)); process.exit(1); };

const readConf = () => { try { return JSON.parse(fs.readFileSync(CONF, 'utf-8')); } catch { return {}; } };
const writeConf = (v) => fs.writeFileSync(CONF, JSON.stringify(v, null, 2), { mode: 0o600 });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);

// ---------- Server ----------
async function api(pathname, { method = 'GET', body } = {}) {
  const conf = readConf();
  if (!conf.server) die('Noch nicht eingerichtet. Starte: coder login');
  const res = await fetch(conf.server.replace(/\/+$/, '') + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(conf.key ? { Authorization: `Bearer ${conf.key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}
const errText = async (res) => { try { return (await res.json()).error || `Fehler ${res.status}`; } catch { return `Fehler ${res.status}`; } };

async function login() {
  const conf = readConf();
  const server = (await ask(`Serveradresse [${conf.server || 'http://192.168.1.190:3000'}]: `)).trim() || conf.server || 'http://192.168.1.190:3000';
  const key = (await ask('Coder-Schlüssel (in AI Core unter Einstellungen → Pro erzeugen; leer, wenn der Server keine Anmeldung hat): ')).trim();
  writeConf({ ...conf, server, key });
  const res = await api('/api/coder/me').catch(e => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
  if (!res.ok) die(`Verbindung fehlgeschlagen: ${res.status ? await errText(res) : (await res.json()).error}`);
  const me = await res.json();
  console.log(green(`Verbunden. Pro: ${me.pro ? 'ja' : 'nein'}${me.unlimited ? ' (unbegrenzt)' : ` · ${Math.floor(me.tokens.remaining)} Token übrig`}`));
  if (!me.pro) console.log('Coder Ultimate gehört zu AI Core Pro.');
}

// ---------- Linux-Umgebung (Docker) ----------
const DOCKERFILE = `FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 python3-pip python3-venv nodejs npm git curl ca-certificates unzip zip jq make cmake golang-go default-jdk-headless && rm -rf /var/lib/apt/lists/*
RUN useradd -m coder
WORKDIR /work
`;
function docker(argv, opts = {}) { return spawnSync('docker', argv, { encoding: 'utf-8', ...opts }); }
function ensureSandbox() {
  const v = docker(['version', '--format', '{{.Server.Version}}']);
  if (v.error || v.status !== 0) {
    die(`Die Linux-Testumgebung braucht Docker.\n  Windows/Mac: Docker Desktop installieren und starten (https://www.docker.com/products/docker-desktop)\n  Linux: Docker installieren (z. B. "sudo apt install docker.io") und deinen Nutzer zur Gruppe "docker" hinzufügen.`);
  }
  if (docker(['image', 'inspect', IMAGE]).status === 0) return;
  console.log(dim('Erster Start: Die Linux-Umgebung wird gebaut (einige Minuten) …'));
  const b = spawnSync('docker', ['build', '-t', IMAGE, '-'], { input: DOCKERFILE, stdio: ['pipe', 'inherit', 'inherit'] });
  if (b.status !== 0) die('Die Linux-Umgebung konnte nicht gebaut werden.');
}
function runInLinux(cmd, timeoutSec = 120) {
  return new Promise((resolve) => {
    const user = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
    const p = spawn('docker', ['run', '--rm', '-i', ...(NET ? [] : ['--network', 'none']), '--memory', '2g', '--cpus', '2', '--pids-limit', '512', ...user,
      '-e', 'HOME=/tmp', '-v', `${ROOT}:/work`, '-w', '/work', IMAGE, 'bash', '-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', done = false;
    const add = (d) => { const t = d.toString(); out(dim(t)); buf += t; if (buf.length > 60000) buf = buf.slice(-60000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { if (!done) { buf += `\n[Abbruch nach ${timeoutSec} s]`; spawnSync('docker', ['kill', '--signal', 'KILL', ...docker(['ps', '-q', '--filter', `ancestor=${IMAGE}`]).stdout.split()]); p.kill('SIGKILL'); } }, timeoutSec * 1000);
    p.on('close', (code) => { done = true; clearTimeout(timer); resolve({ code, text: buf }); });
    p.on('error', (e) => { done = true; clearTimeout(timer); resolve({ code: -1, text: `Docker-Fehler: ${e.message}` }); });
  });
}

// ---------- Werkzeuge ----------
const SYSTEM = `Du bist "Coder Ultimate", ein Programmierassistent in der Konsole des Nutzers. Du arbeitest im Projektordner des Nutzers (Wurzel "."). Programme testest du in einem abgeschotteten Linux (Ubuntu 24.04 mit gcc, make, cmake, python3, pip, node, npm, git, go, java), in dem der Projektordner unter /work liegt${NET ? '' : '; das Netzwerk ist dort AUS (kein pip/npm install)'}.
Du benutzt Werkzeuge, indem du genau diese Tags schreibst (ein Werkzeug pro Tag, mehrere pro Antwort sind erlaubt, sie laufen der Reihe nach):
<list_dir path="."/>
<read_file path="src/main.py"/>
<write_file path="src/main.py">
vollständiger neuer Dateiinhalt
</write_file>
<run>
Shell-Befehl im Linux, z. B. python3 src/main.py oder make test
</run>
Regeln: Schreibe niemals Pfade außerhalb des Projektordners. Schreibe Dateien immer vollständig. Nach Werkzeug-Tags hörst du auf zu schreiben und wartest auf das Ergebnis. Teste, was du baust, mit <run>, und repariere Fehler, bis es läuft. Wenn du fertig bist, antworte ohne Werkzeug-Tags und fasse kurz zusammen, was du getan hast und wie man es startet. Antworte auf Deutsch, außer der Nutzer schreibt anders.`;

const safe = (p) => {
  const full = path.resolve(ROOT, String(p || '.'));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw new Error('Pfad liegt außerhalb des Projektordners');
  return full;
};
const clip = (s, n = 8000) => (s.length > n ? `${s.slice(0, n / 2)}\n[… ${s.length - n} Zeichen ausgelassen …]\n${s.slice(-n / 2)}` : s);
const TAG = /<(list_dir|read_file)\s+path="([^"]*)"\s*\/?>|<write_file\s+path="([^"]*)">\n?([\s\S]*?)<\/write_file>|<run>\n?([\s\S]*?)<\/run>/g;

function parseTools(text) {
  const calls = []; let m; TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    if (m[1]) calls.push({ tool: m[1], path: m[2] });
    else if (m[3] !== undefined) calls.push({ tool: 'write_file', path: m[3], content: m[4].replace(/\n$/, '') });
    else calls.push({ tool: 'run', cmd: m[5].trim() });
  }
  return calls;
}

async function confirm(q) { if (YES) return true; const a = (await ask(`${q} ${dim('[J/n]')} `)).trim().toLowerCase(); return a === '' || a === 'j' || a === 'y' || a === 'ja'; }

async function execTool(t, sandboxReady) {
  try {
    if (t.tool === 'list_dir') {
      const dir = safe(t.path);
      const list = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !['node_modules', '.git'].includes(e.name)).slice(0, 300).map(e => e.name + (e.isDirectory() ? '/' : ''));
      out(dim(`📁 ${t.path}\n`));
      return list.join('\n') || '(leer)';
    }
    if (t.tool === 'read_file') {
      const f = safe(t.path); out(dim(`📄 ${t.path}\n`));
      return clip(fs.readFileSync(f, 'utf-8'), 30000);
    }
    if (t.tool === 'write_file') {
      const f = safe(t.path);
      const exists = fs.existsSync(f);
      out(`\n${cyan(exists ? '✎ ändern' : '＋ neu')} ${bold(t.path)} ${dim(`(${t.content.split('\n').length} Zeilen)`)}\n`);
      if (!(await confirm('Datei schreiben?'))) return 'Der Nutzer hat das Schreiben abgelehnt.';
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, t.content.endsWith('\n') ? t.content : t.content + '\n');
      return `Geschrieben: ${t.path}`;
    }
    if (t.tool === 'run') {
      out(`\n${cyan('▶ Linux')} ${bold(t.cmd)}\n`);
      if (!AUTO && !(await confirm('Im Linux ausführen?'))) return 'Der Nutzer hat das Ausführen abgelehnt.';
      sandboxReady();
      const r = await runInLinux(t.cmd);
      return `Exit-Code ${r.code}\n${clip(r.text)}`;
    }
  } catch (e) { return `Fehler: ${e.message}`; }
  return 'Unbekanntes Werkzeug';
}

// ---------- Chat ----------
async function chat(messages) {
  const res = await api('/api/chat/stream', { method: 'POST', body: { messages, system: SYSTEM, memory: false, temperature: 0.2 } });
  if (!res.ok) throw new Error(await errText(res));
  const dec = new TextDecoder(); let buf = '', text = '', tokens = null;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try { const ev = JSON.parse(payload); if (ev.delta) { text += ev.delta; out(ev.delta); } if (ev.tokens) tokens = ev.tokens; } catch { /* Stück unvollständig */ }
    }
  }
  out('\n');
  return { text, tokens };
}

async function work(history, task) {
  history.push({ role: 'user', content: task });
  let ready = false;
  const sandbox = () => { if (!ready) { ensureSandbox(); ready = true; } };
  for (let step = 0; step < 25; step++) {
    const { text, tokens } = await chat(history);
    history.push({ role: 'assistant', content: text || '(keine Antwort)' });
    if (tokens) out(dim(`⚡ ${Math.floor(tokens.remaining)} Token übrig\n`));
    const calls = parseTools(text);
    if (!calls.length) return;
    const results = [];
    for (const t of calls) results.push(`[${t.tool}${t.path ? ' ' + t.path : ''}]\n${await execTool(t, sandbox)}`);
    history.push({ role: 'user', content: `Ergebnisse der Werkzeuge:\n\n${results.join('\n\n')}` });
  }
  console.log(red('Nach 25 Schritten angehalten. Schreibe "weiter", um fortzufahren.'));
}

async function main() {
  if (rest[0] === 'login') { await login(); return; }
  if (rest[0] === 'sandbox-reset') { docker(['image', 'rm', '-f', IMAGE]); console.log('Linux-Umgebung entfernt; sie wird beim nächsten Bedarf neu gebaut.'); return; }
  if (flag('--version')) { console.log(VERSION); return; }
  const me = await api('/api/coder/me').catch(() => null);
  if (!me) die('Server nicht erreichbar. Prüfe die Adresse mit: coder login');
  if (!me.ok) die(await errText(me));
  const info = await me.json();
  console.log(`${bold('AI Core Coder Ultimate')} ${dim(VERSION)}  ·  Ordner: ${ROOT}\n${dim('Befehle: /neu = neues Gespräch · /exit = beenden. Dateien und Befehle werden vorher erfragt.')}`);
  if (!info.unlimited) console.log(dim(`⚡ ${Math.floor(info.tokens.remaining)} von ${info.tokens.limit} Token`));
  let history = [];
  if (rest.length) { await work(history, rest.join(' ')); rl.close(); return; }
  while (true) {
    const line = (await ask(`\n${green('Du ▸ ')}`).catch(() => '/exit')).trim();
    if (!line) continue;
    if (line === '/exit') break;
    if (line === '/neu') { history = []; console.log('Neues Gespräch.'); continue; }
    try { await work(history, line); } catch (e) { console.log(red(e.message)); }
  }
  rl.close();
}
main().catch(e => die(e.message)).finally(() => { if (rest[0] === 'login' || rest.length) rl.close(); });
