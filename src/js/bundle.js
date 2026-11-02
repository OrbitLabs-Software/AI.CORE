// bundle.js — mehrere Dateien einer Antwort (index.html + style.css + app.js) zu EINER Vorschau-Seite bündeln.
// Die Vorschau läuft in einer Sandbox ohne Netzwerk; deshalb werden <link rel="stylesheet"> und <script src> eingebettet.

const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '').split(/[?#]/)[0].toLowerCase();
const base = (p) => norm(p).split('/').pop();
const isRemote = (u) => /^(?:https?:)?\/\//i.test(u) || /^data:/i.test(u) || /^blob:/i.test(u);
const JS_LANGS = ['js', 'javascript', 'mjs', 'jsx'];

/**
 * @param {string} html
 * @param {{file?:string, lang?:string, code:string}[]} files  Code-Blöcke derselben Antwort
 * @returns {{ html:string, inlined:string[], missing:string[] }}
 */
export function bundleHtml(html, files = []) {
  const byName = new Map();
  for (const f of files) {
    if (!f.file) continue;
    byName.set(norm(f.file), f);
    if (!byName.has(base(f.file))) byName.set(base(f.file), f);
  }
  const used = new Set();
  const find = (ref, kind) => {
    const hit = byName.get(norm(ref)) || byName.get(base(ref));
    if (hit) return hit;
    // Fallback: genau ein Block dieser Art ohne passenden Namen (kleine Modelle benennen Dateien gern anders)
    const pool = files.filter(f => (kind === 'css' ? f.lang === 'css' : JS_LANGS.includes(f.lang)) && !used.has(f));
    return pool.length === 1 ? pool[0] : null;
  };
  const inlined = [];
  const missing = [];

  let out = String(html);
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const m = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!m || isRemote(m[1])) return tag;
    const f = find(m[1], 'css');
    if (!f) { missing.push(m[1]); return tag; }
    used.add(f); inlined.push(m[1]);
    return `<style>\n${f.code.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });
  out = out.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    if (isRemote(src)) return tag;
    const f = find(src, 'js');
    if (!f) { missing.push(src); return tag; }
    used.add(f); inlined.push(src);
    const attrs = `${a} ${b}`.replace(/\s+/g, ' ').trim();
    return `<script${attrs ? ` ${attrs}` : ''}>\n${f.code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  return { html: out, inlined, missing };
}

/** Gibt es in der Antwort außer dem HTML noch CSS/JS-Blöcke, die gebündelt werden könnten? */
export const hasCompanions = (blocks) => blocks.some(b => b.lang === 'css' || JS_LANGS.includes(b.lang));
