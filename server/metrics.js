// metrics.js — einfache Nutzungszähler pro Tag (data/metrics.json): Chats, Tokens, Suchen, Bilder, Videos, API-Aufrufe, Fehler.
// Gespeichert werden nur Zahlen und gekürzte Konto-Hashes, keine Inhalte. Es bleiben 60 Tage.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data');
const file = () => path.join(dataDir(), 'metrics.json');
export const KINDS = ['chat', 'tokens', 'search', 'image', 'video', 'api', 'apiTokens', 'errors'];

let cache = null, cachePath = null, timer = null;
function load() {
  if (cache && cachePath === file()) return cache;
  cachePath = file();
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch { cache = {}; }
  if (!cache.days || typeof cache.days !== 'object') cache = { days: {} };
  return cache;
}
export function flush() {
  clearTimeout(timer); timer = null;
  if (!cache) return;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { console.warn('[metrics] Speichern fehlgeschlagen:', e.message); }
}
const day = (now) => new Date(now).toISOString().slice(0, 10);

export function record(kind, key = '', amount = 1, now = Date.now()) {
  if (!KINDS.includes(kind) || !(amount > 0)) return;
  const d = load(), k = day(now);
  const b = (d.days[k] ||= { users: [] });
  b[kind] = (b[kind] || 0) + Math.round(amount);
  if (key && kind !== 'tokens' && kind !== 'apiTokens' && kind !== 'errors' && !b.users.includes(key) && b.users.length < 500) b.users.push(String(key).slice(0, 12));
  const old = Object.keys(d.days).sort().slice(0, -60);
  old.forEach(o => delete d.days[o]);
  if (!timer) { timer = setTimeout(flush, 3000); timer.unref?.(); }
}

/** Letzte `days` Tage (ältester zuerst) mit Summen. */
export function snapshot(days = 14, now = Date.now()) {
  const d = load(), rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = day(now - i * 86400000), b = d.days[k] || {};
    rows.push({ date: k, ...Object.fromEntries(KINDS.map(x => [x, b[x] || 0])), users: b.users?.length || 0 });
  }
  const totals = Object.fromEntries(KINDS.map(x => [x, rows.reduce((n, r) => n + r[x], 0)]));
  return { rows, totals };
}
