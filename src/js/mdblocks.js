// mdblocks.js — Markdown in Blöcke zerlegen. Gemeinsame Grundlage für Word, PDF, PowerPoint und Excel (Tabellen).
// Ohne Bibliothek, ohne Zugriff auf den Browser (läuft auch in Node-Tests).

/** Denkprozess (<think>…</think>) entfernen; nur die Antwort wird exportiert. */
export const answerOnly = (content) => String(content ?? '').replace(/^\s*<think>[\s\S]*?(?:<\/think>|$)/, '').trim();

/** Zeilentext → Abschnitte { t, b (fett), i (kursiv), c (Code) }. Links werden zu „Text (Adresse)“. */
export function spans(text) {
  const src = String(text ?? '').replace(/~~(.+?)~~/g, '$1');
  const out = [];
  const re = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|(?<![*\w])\*[^*\s][^*\n]*?\*(?![*\w])|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: src.slice(last, m.index) });
    const s = m[0];
    if (s.startsWith('**')) out.push({ t: s.slice(2, -2), b: true });
    else if (s.startsWith('`')) out.push({ t: s.slice(1, -1), c: true });
    else if (s.startsWith('[')) { const k = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s); out.push({ t: `${k[1]} (${k[2]})` }); }
    else out.push({ t: s.slice(1, -1), i: true });
    last = m.index + s.length;
  }
  if (last < src.length) out.push({ t: src.slice(last) });
  return out.length ? out : [{ t: '' }];
}

export const plainInline = (text) => spans(text).map(s => s.t).join('');

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/**
 * Blöcke: { type: 'h', level, text } · { type: 'p', lines[] } · { type: 'li', level, ordered, marker, text }
 *         { type: 'code', lang, lines[] } · { type: 'table', rows[][], header } · { type: 'quote', lines[] } · { type: 'hr' }
 */
export function blocks(markdown) {
  const out = [];
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let para = null;
  const flush = () => { if (para) { out.push({ type: 'p', lines: para }); para = null; } };

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push({ type: 'code', lang: fence[1].trim(), lines: code });
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flush(); out.push({ type: 'h', level: Math.min(h[1].length, 4), text: h[2] }); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ type: 'hr' }); i++; continue; }
    if (/^\s*\|/.test(line)) {
      flush();
      const rows = [];
      let header = false;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const l = lines[i];
        if (/^[\s|:-]+$/.test(l) && /-/.test(l)) { if (rows.length === 1) header = true; } else rows.push(cells(l));
        i++;
      }
      out.push({ type: 'table', rows, header });
      continue;
    }
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const indent = li[1].replace(/\t/g, '  ').length;
      out.push({ type: 'li', level: Math.min(3, Math.floor(indent / 2)), ordered: /\d/.test(li[2]), marker: li[2], text: li[3] });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ type: 'quote', lines: q });
      continue;
    }
    (para ||= []).push(line.trim());
    i++;
  }
  flush();
  return out;
}

/** Alle Markdown-Tabellen eines Textes: [{ name, rows, header }] — der Name kommt von der Überschrift davor. */
export function tablesOf(markdown) {
  const res = [];
  let heading = '';
  for (const b of blocks(markdown)) {
    if (b.type === 'h') heading = plainInline(b.text);
    else if (b.type === 'table' && b.rows.length) { res.push({ name: heading, rows: b.rows, header: b.header }); heading = ''; }
  }
  return res;
}
