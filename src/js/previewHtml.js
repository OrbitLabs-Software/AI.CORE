// previewHtml.js — baut die Vorschau-Seite im Browser (wenn die Seite nicht vom Server kommt, z. B. GitHub Pages).
// Läuft per srcdoc in einem iframe mit sandbox (leerer Ursprung, kein Zugriff auf AI Core) und eigener CSP.

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  'img-src data: blob: https:',
  "font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  'media-src data: blob:',
  "connect-src 'none'",
].join('; ');

export function buildPreviewHtml(kind, code) {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">`;
  const src = String(code || '');
  if (kind === 'svg') {
    return `<!doctype html><html><head>${head}<style>html,body{height:100%;margin:0;display:grid;place-items:center;background:#fff}svg{max-width:96vw;max-height:96vh}</style></head><body>${src}</body></html>`;
  }
  if (/<html[\s>]/i.test(src) || /<!doctype/i.test(src)) {
    return /<head[\s>]/i.test(src) ? src.replace(/<head([^>]*)>/i, `<head$1>${head}`) : `${head}${src}`;
  }
  return `<!doctype html><html><head>${head}<style>body{font-family:system-ui,sans-serif;margin:16px}</style></head><body>${src}</body></html>`;
}
