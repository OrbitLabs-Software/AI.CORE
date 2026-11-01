// preview.js — sichere Vorschau für Code von der KI (HTML, SVG).
// Die Seite wird kurz im Speicher gehalten und in einem iframe mit "sandbox" gezeigt:
// kein Zugriff auf Cookies, Sitzung oder die Oberfläche, kein Netzwerk (connect-src 'none').

import crypto from 'crypto';

const MAX_BYTES = 400 * 1024;
const MAX_ITEMS = 100;
const TTL_MS = 30 * 60 * 1000;
const store = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, v] of store) if (v.expires < now) store.delete(id);
  while (store.size > MAX_ITEMS) store.delete(store.keys().next().value);
}
setInterval(sweep, 5 * 60 * 1000).unref();

function wrap(kind, code) {
  const base = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">';
  if (kind === 'svg') {
    return `<!doctype html><html><head>${base}<style>html,body{height:100%;margin:0;display:grid;place-items:center;background:#fff}svg{max-width:96vw;max-height:96vh}</style></head><body>${code}</body></html>`;
  }
  if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)) {
    return /<head[\s>]/i.test(code) ? code.replace(/<head([^>]*)>/i, `<head$1>${base}`) : code;
  }
  return `<!doctype html><html><head>${base}<style>body{font-family:system-ui,sans-serif;margin:16px}</style></head><body>${code}</body></html>`;
}

export function createPreview(kind, code) {
  const html = wrap(kind === 'svg' ? 'svg' : 'html', String(code || ''));
  if (Buffer.byteLength(html) > MAX_BYTES) return { error: 'Code ist zu groß für die Vorschau', status: 413 };
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  store.set(id, { html, expires: Date.now() + TTL_MS });
  return { id, url: `/preview/${id}` };
}

export function previewHandler(req, res) {
  const item = store.get(req.params.id);
  if (!item || item.expires < Date.now()) return res.status(404).type('text/plain').send('Vorschau abgelaufen — bitte im Chat erneut öffnen.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // sandbox: eigener, leerer Ursprung. Skripte laufen, aber ohne Zugriff auf AI Core.
  res.setHeader('Content-Security-Policy', [
    'sandbox allow-scripts allow-forms allow-modals allow-popups',
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "img-src data: blob: https:",
    "font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.send(item.html);
}
