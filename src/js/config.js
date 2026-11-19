// config.js — wo läuft der AI-Core-Server?
// Nutzer sehen und ändern die Serveradresse nie: Die Anmeldung ist immer dieselbe. Die Adressen stehen fest hier (oder in
// aicore.config.json neben index.html: { "servers": ["http://192.168.1.190:3000", "https://dein-server"] }).
// Nur für dich als Betreiber: Seite einmal mit ?server=https://adresse öffnen, ?server=reset setzt zurück.

export const DEFAULT_SERVER = 'https://obitlabs.tailc8dd2c.ts.net';   // Tailscale Funnel; im Heimnetz geht auch http://192.168.1.190:3000

// Adressen, die beim Start automatisch ausprobiert werden (zuerst die schnelle im Heimnetz, dann die von unterwegs).
export const SERVER_CANDIDATES = ['http://192.168.1.190:3000', DEFAULT_SERVER];

/** Optionale Adressliste aus aicore.config.json (ersetzt die festen Adressen, wenn vorhanden). */
export async function loadServerList() {
  try {
    const res = await fetch(new URL('./aicore.config.json', document.baseURI).href, { cache: 'no-store' });
    if (!res.ok) return;
    const list = ((await res.json()).servers || []).map(s => normalizeServer(s)).filter(Boolean);
    if (list.length) SERVER_CANDIDATES.splice(0, SERVER_CANDIDATES.length, ...list);
  } catch { /* keine Datei: feste Adressen */ }
}
let detected = '';

const KEY = 'aicore_server';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?(::1|f[cd][0-9a-f]{2}:|fe80:))|\.local$|\.lan$/i;
export const isPrivateHost = (host = location.hostname) => PRIVATE_HOST.test(host);

/** Kommt die Seite selbst vom AI-Core-Server (Heimnetz-Adresse oder Port 3000)? Dann gilt derselbe Ursprung. */
// Nur GitHub Pages (und lokale Dateien) liegen außerhalb des Servers; jede andere Adresse, auch ein Tunnel, ist der Server selbst.
// Vom AI-Core-Server selbst ausgeliefert (http/https, nicht GitHub). In der Desktop-App (aicore://) und bei file:// gilt das nicht.
const servedByServer = () => /^https?:$/.test(location.protocol) && !/\.github\.io$/i.test(location.hostname);

/** Basisadresse ohne „/“ am Ende; leer = gleicher Ursprung. */
export function serverBase() {
  const saved = read();
  if (saved) return saved.replace(/\/+$/, '');
  return servedByServer() ? '' : (detected || DEFAULT_SERVER);
}

export const isCrossOrigin = () => serverBase() !== '';
export const apiUrl = (path) => serverBase() + path;

/** Normalisiert Eingaben wie „192.168.1.190:3000“ zu „http://192.168.1.190:3000“. */
export function normalizeServer(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = (isPrivateHost(v.split(/[:/]/)[0]) || /^\d/.test(v) ? 'http://' : 'https://') + v;
  try { const u = new URL(v); return u.origin; } catch { return null; }
}

/** Probiert die bekannten Adressen gleichzeitig durch und nimmt die erste, die als AI-Core-Server antwortet. */
export async function findServer(timeoutMs = 3500) {
  if (read() || servedByServer()) return '';
  const tries = SERVER_CANDIDATES.map(async (base) => {
    const res = await fetch(`${base}/api/config`, { credentials: 'omit', signal: AbortSignal.timeout(timeoutMs), ...(isPrivateHost(new URL(base).hostname) ? { targetAddressSpace: 'local' } : {}) });
    if (!res.ok || typeof (await res.json()).authRequired !== 'boolean') throw new Error('kein AI-Core-Server');
    return base;
  });
  try { detected = await Promise.any(tries); } catch { detected = ''; }
  return detected;
}

export function setServerBase(url) {
  try { url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY); } catch { /* egal */ }
}

// Verstecktes Betreiber-Werkzeug: ?server=… einmal öffnen
try {
  const q = new URLSearchParams(location.search).get('server');
  if (q) {
    if (q === 'reset') localStorage.removeItem(KEY); else { const u = normalizeServer(q); if (u) localStorage.setItem(KEY, u); }
    history.replaceState(null, '', location.pathname + location.hash);
  }
} catch { /* egal */ }
