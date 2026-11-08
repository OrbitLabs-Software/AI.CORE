// config.js — wo läuft der AI-Core-Server?
// Die Seite kann auf GitHub Pages liegen; der Server steht im Heimnetz. Ändere nur diese Zeile,
// wenn sich die Adresse des Servers ändert (oder trage sie im Anmeldefenster unter „ändern“ ein).

export const DEFAULT_SERVER = 'https://obitlabs.tailc8dd2c.ts.net';   // Tailscale Funnel; im Heimnetz geht auch http://192.168.1.190:3000

// Adressen, die beim Start automatisch ausprobiert werden (zuerst die schnelle im Heimnetz, dann die von unterwegs).
export const SERVER_CANDIDATES = ['http://192.168.1.190:3000', DEFAULT_SERVER];
let detected = '';

const KEY = 'aicore_server';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?(::1|f[cd][0-9a-f]{2}:|fe80:))|\.local$|\.lan$/i;
export const isPrivateHost = (host = location.hostname) => PRIVATE_HOST.test(host);

/** Kommt die Seite selbst vom AI-Core-Server (Heimnetz-Adresse oder Port 3000)? Dann gilt derselbe Ursprung. */
// Nur GitHub Pages (und lokale Dateien) liegen außerhalb des Servers; jede andere Adresse, auch ein Tunnel, ist der Server selbst.
const servedByServer = () => location.protocol !== 'file:' && !/\.github\.io$/i.test(location.hostname);

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
