// logbuffer.js — die letzten Meldungen des Servers im Speicher, damit der Besitzer sie in der Oberfläche lesen kann.
// Schlüssel und lange Kennungen werden unkenntlich gemacht.
import util from 'util';

const MAX = 300;
const entries = [];
let installed = false;

export function redact(text) {
  return String(text)
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(sk|pk|rk|hf|whsec|price)_[A-Za-z0-9_]{8,}\b/g, (m) => `${m.split('_')[0]}_***`)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '***')
    .replace(/\b(key|token|api_?key|secret|password|passwd)=[^&\s"']+/gi, '$1=***');
}

export function add(level, args, now = Date.now()) {
  const msg = redact(util.format(...args)).slice(0, 500);
  entries.push({ t: now, level, msg });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function getLogs({ level = 'all', limit = 100 } = {}) {
  const ok = level === 'error' ? ['error'] : level === 'warn' ? ['warn', 'error'] : ['log', 'info', 'warn', 'error'];
  return entries.filter(e => ok.includes(e.level)).slice(-Math.min(300, Math.max(1, limit))).reverse();
}
export const _clear = () => { entries.length = 0; };

export function install() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { try { add(level, args); } catch { /* nie das Loggen stören */ } orig(...args); };
  }
}
