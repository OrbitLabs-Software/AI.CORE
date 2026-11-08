// library.js — Bibliothek: Dokumente einmal hochladen, in jedem Chat durchsuchen. Liegt pro Konto auf dem Server
// (data/library/<konto>.json); die Suche ist eine Stichwortsuche (BM25) und läuft ohne Modell.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildIndex, searchIndex } from '../src/js/rag.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'library');
export const libraryEnabled = () => process.env.LIBRARY !== 'false';
export const LIMITS = {
  docs: Number(process.env.LIBRARY_MAX_DOCS) || 100,
  docChars: 400_000,
  totalChars: Number(process.env.LIBRARY_MAX_CHARS) || 20_000_000,
};
const fileFor = (key) => path.join(dir(), `${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32)}.json`);

const cache = new Map();   // Konto -> { docs: {id: doc}, index: null | Index }
function load(key) {
  const f = fileFor(key);
  if (cache.has(f)) return cache.get(f);
  let docs = {};
  try { docs = JSON.parse(fs.readFileSync(f, 'utf-8')).docs || {}; } catch { /* neues Konto */ }
  const entry = { docs, index: null };
  cache.set(f, entry);
  return entry;
}
function save(key) {
  const f = fileFor(key), e = cache.get(f);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ docs: e.docs }), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  } catch (err) { console.warn('[library] Speichern fehlgeschlagen:', err.message); return false; }
}
export const _reset = () => { cache.clear(); fs.rmSync(dir(), { recursive: true, force: true }); };   // nur für Tests

export const list = (key) => Object.values(load(key).docs).sort((a, b) => b.addedAt - a.addedAt).map(({ id, name, chars, addedAt }) => ({ id, name, chars, addedAt }));
export const stats = (key) => { const d = Object.values(load(key).docs); return { count: d.length, chars: d.reduce((n, x) => n + x.chars, 0), maxDocs: LIMITS.docs, maxChars: LIMITS.totalChars }; };

export function add(key, name, text) {
  const e = load(key);
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  const label = String(name || 'Dokument').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Dokument';
  if (clean.length < 20) return { error: 'In dem Dokument wurde kaum Text gefunden.', status: 400 };
  if (Object.keys(e.docs).length >= LIMITS.docs) return { error: `Die Bibliothek ist voll (${LIMITS.docs} Dokumente). Lösche zuerst eines.`, status: 413 };
  const body = clean.slice(0, LIMITS.docChars);
  if (stats(key).chars + body.length > LIMITS.totalChars) return { error: 'Die Bibliothek ist voll. Lösche zuerst Dokumente.', status: 413 };
  const old = Object.values(e.docs).find(d => d.name === label);
  if (old) delete e.docs[old.id];          // gleicher Name = neue Fassung ersetzt die alte
  const id = crypto.randomBytes(8).toString('hex');
  e.docs[id] = { id, name: label, text: body, chars: body.length, addedAt: Date.now() };
  e.index = null;
  return save(key) ? { id, name: label, chars: body.length, truncated: clean.length > body.length } : { error: 'Speichern fehlgeschlagen', status: 500 };
}

export function remove(key, id) {
  const e = load(key);
  if (!e.docs[id]) return false;
  delete e.docs[id]; e.index = null; save(key);
  return true;
}

/** Beste Abschnitte zur Frage, höchstens `budget` Zeichen. Gibt Abschnitte mit Dokumentname zurück. */
export function search(key, query, budget = 4000, max = 6) {
  const e = load(key), docs = Object.values(e.docs);
  if (!docs.length || String(query || '').trim().length < 2) return { passages: [] };
  e.index ||= { idx: buildIndex(docs.map(d => ({ name: d.name, text: d.text }))), ids: docs.map(d => d.id) };
  const out = [];
  let used = 0;
  for (const c of searchIndex(e.index.idx, query)) {
    if (c.score !== undefined && out.length >= max) break;
    if (used + c.t.length > budget) continue;
    out.push({ docId: e.index.ids[c.fi], name: c.name, part: c.i + 1, text: c.t, score: Math.round(c.score * 100) / 100 });
    used += c.t.length;
  }
  return { passages: out };
}
