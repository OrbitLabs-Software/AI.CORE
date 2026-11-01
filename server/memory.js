// memory.js — Erinnerungen: kurze Fakten über die Nutzerin oder den Nutzer, die AI Core
// in jedes Gespräch mitnimmt (wie bei Claude). Gespeichert wird pro Konto in data/memories.json,
// also auf dem Server und damit auf allen Geräten gleich. Ohne Login gibt es genau einen Speicher.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data');
const file = () => path.join(dataDir(), 'memories.json');

export const MAX_ITEMS = 200;
export const MAX_CHARS = 300;
export const memoryEnabled = () => process.env.MEMORY !== 'false';

let cache = null;
let cachePath = null;

function load() {
  if (cache && cachePath === file()) return cache;
  cachePath = file();
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); }
  catch { cache = {}; }
  if (typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  return cache;
}

function save() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmp, file());   // atomar: nie eine halbe Datei
  } catch (e) {
    console.warn('[memory] Speichern fehlgeschlagen:', e.message);
  }
}

/** Kontoschlüssel: nicht die Rohdaten, sondern ein Hash der Benutzer-ID. */
export const keyFor = (identity) =>
  crypto.createHash('sha256').update(String(identity?.sub || 'local')).digest('hex').slice(0, 20);

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);

export function listMemories(key) {
  return (load()[key] || []).slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function addMemory(key, text) {
  const value = clean(text);
  if (value.length < 3) return { error: 'Erinnerung ist zu kurz', status: 400 };
  const all = load();
  const list = (all[key] ||= []);
  if (list.some(m => m.text.toLowerCase() === value.toLowerCase())) return { error: 'Das weiß ich schon', status: 409 };
  if (list.length >= MAX_ITEMS) return { error: `Maximal ${MAX_ITEMS} Erinnerungen — bitte alte löschen`, status: 413 };
  const item = { id: crypto.randomBytes(6).toString('hex'), text: value, createdAt: Date.now() };
  list.push(item);
  save();
  return { item };
}

export function deleteMemory(key, id) {
  const all = load();
  const before = (all[key] || []).length;
  all[key] = (all[key] || []).filter(m => m.id !== id);
  if (all[key].length === before) return false;
  save();
  return true;
}

export function clearMemories(key) {
  const all = load();
  const n = (all[key] || []).length;
  delete all[key];
  save();
  return n;
}

/** Text für den Systemprompt (neueste zuerst, auf maxChars begrenzt). */
export function memoryPrompt(key, maxChars = 1200) {
  const items = listMemories(key);
  if (!items.length) return '';
  const lines = [];
  let used = 0;
  for (const m of items) {
    if (used + m.text.length + 3 > maxChars) break;
    lines.push(`- ${m.text}`);
    used += m.text.length + 3;
  }
  return `Das weißt du über die Person, mit der du sprichst (nutze es nur, wenn es passt, und erwähne die Liste nicht von dir aus):\n${lines.join('\n')}`;
}

export const _resetForTests = () => { cache = null; cachePath = null; };
