// rag.js — Wissenssuche für große Projektdateien: Texte in Abschnitte teilen und die passendsten zur Frage auswählen (BM25).
// Läuft im Browser, ohne Modell und ohne Server: Es werden nur die Abschnitte mitgeschickt, die zur Frage passen.

const STOP = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber ist sind war waren wird werden wurde wurden nicht mit von zu zum zur im in am an auf für aus bei nach über unter auch als wie was wer wo wann warum wieso ich du er sie es wir ihr dass sich so nur noch schon kann können hat haben mir mich dir dich uns the and of to is').split(' '));
const stem = (w) => (w.length > 5 ? w.replace(/(ungen|ung|keit|heit|lich|isch|ern|en|er|es|em|e|n|s)$/, '') : w);
export const tokenize = (s) => (String(s).toLowerCase().match(/[a-zäöüß0-9]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);

/** Teilt Text in Abschnitte von ca. `size` Zeichen, bevorzugt an Absatz- oder Satzgrenzen. */
export function chunkText(text, size = 900, overlap = 120) {
  const t = String(text).replace(/\r/g, '').trim();
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      const win = t.slice(i + Math.floor(size * 0.6), end);
      const cut = Math.max(win.lastIndexOf('\n\n'), win.lastIndexOf('\n'), win.lastIndexOf('. '));
      if (cut > 0) end = i + Math.floor(size * 0.6) + cut + 1;
    }
    const piece = t.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

/** Index einmal bauen (Abschnitte, Wörter, Häufigkeiten), danach beliebig oft durchsuchen. files = [{ name, text }] */
export function buildIndex(files) {
  const chunks = [];
  files.forEach((f, fi) => chunkText(f.text).forEach((t, i) => chunks.push({ fi, i, name: f.name, t, tok: tokenize(t) })));
  const df = new Map();
  for (const c of chunks) for (const w of new Set(c.tok)) df.set(w, (df.get(w) || 0) + 1);
  for (const c of chunks) { c.tf = new Map(); c.tok.forEach(w => c.tf.set(w, (c.tf.get(w) || 0) + 1)); }
  const avg = chunks.reduce((a, c) => a + c.tok.length, 0) / (chunks.length || 1) || 1;
  return { chunks, df, avg, N: chunks.length || 1 };
}

/** Abschnitte nach Treffer (BM25) sortiert; ohne Treffer der Anfang jeder Datei. */
export function searchIndex(index, query) {
  const q = [...new Set(tokenize(query))];
  const { chunks, df, avg, N } = index;
  const scored = chunks.map((c) => ({
    ...c, score: q.reduce((s, w) => {
      const f = c.tf.get(w) || 0;
      if (!f) return s;
      const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
      return s + idf * (f * 2.5) / (f + 1.5 * (0.25 + 0.75 * c.tok.length / avg));
    }, 0),
  }));
  const hits = scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  return hits.length ? hits : scored.filter(c => c.i === 0);
}

/** Wählt die besten Abschnitte (höchstens `budget` Zeichen) und gibt sie in Dateireihenfolge als Text zurück. */
export function retrieve(files, query, budget) {
  const picked = [];
  let used = 0;
  for (const c of searchIndex(buildIndex(files), query)) {
    if (used + c.t.length + 40 > budget) continue;
    picked.push(c); used += c.t.length + 40;
  }
  picked.sort((a, b) => a.fi - b.fi || a.i - b.i);
  return picked.map(c => `### ${c.name} (Abschnitt ${c.i + 1})\n${c.t}`).join('\n\n');
}
