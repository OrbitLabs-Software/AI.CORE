// sync.js — Geräte-Abgleich: Chats und Projekte eines Kontos liegen zusätzlich auf dem Server (data/sync/<konto>.json),
// damit Handy und Computer denselben Stand haben. Opt-in pro Konto. Es gilt „die neuere Änderung gewinnt“ (updatedAt).
// Bilder und Dateivorschauen werden nicht abgeglichen; gelöschte Elemente bleiben als Marker (deletedAt) erhalten.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'sync');
export const syncEnabled = () => process.env.SYNC !== 'false';

export const LIMITS = { chatBytes: 1_500_000, projectBytes: 450_000, accountBytes: 40_000_000, chats: 2000, projects: 200, perPush: 40 };
const ID = /^[A-Za-z0-9_-]{4,64}$/;
const fileFor = (key) => path.join(dir(), `${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32)}.json`);

const cache = new Map();   // Konto -> { chats: {id: chat}, projects: {id: project} }
function load(key) {
  const f = fileFor(key);
  const hit = cache.get(f);
  if (hit) return hit;
  let data = { chats: {}, projects: {} };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(f, 'utf-8')) }; } catch { /* neues Konto */ }
  cache.set(f, data);
  return data;
}
function save(key) {
  const f = fileFor(key);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache.get(f)), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  } catch (e) { console.warn('[sync] Speichern fehlgeschlagen:', e.message); return false; }
}
export const _reset = () => { cache.clear(); fs.rmSync(dir(), { recursive: true, force: true }); };   // nur für Tests

const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function cleanMessage(m) {
  if (!m || typeof m !== 'object' || !ID.test(String(m.id))) return null;
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  const out = { id: String(m.id), role: m.role, content: str(m.content, 60000), createdAt: num(m.createdAt) };
  for (const k of ['stats', 'sources', 'video', 'feedback', 'media', 'kind', 'no', 'vIdx', 'memoryHint']) if (m[k] !== undefined) out[k] = m[k];
  if (Array.isArray(m.attachments)) out.attachments = m.attachments.slice(0, 10).map(a => ({ name: str(a?.name, 160), type: str(a?.type, 80), text: a?.text ? str(a.text, 30000) : undefined }));
  if (Array.isArray(m.versions)) out.versions = m.versions.slice(0, 20).map(v => ({ content: str(v?.content, 60000), stats: v?.stats ?? null }));
  if (Array.isArray(m.alts)) out.alts = m.alts.slice(0, 20).map(a => ({ no: num(a?.no), content: str(a?.content, 60000), attachments: [], tail: Array.isArray(a?.tail) ? a.tail.map(cleanMessage).filter(Boolean) : [] }));
  return out;
}

export function cleanChat(c) {
  if (!c || typeof c !== 'object' || !ID.test(String(c.id))) return null;
  const out = {
    id: String(c.id), title: str(c.title || 'Chat', 120), favorite: Boolean(c.favorite), roleId: c.roleId ? str(c.roleId, 60) : null,
    projectId: c.projectId ? str(c.projectId, 64) : null, createdAt: num(c.createdAt), updatedAt: num(c.updatedAt),
    messages: (Array.isArray(c.messages) ? c.messages : []).slice(-1000).map(cleanMessage).filter(Boolean),
  };
  if (c.deletedAt) out.deletedAt = num(c.deletedAt);
  if (c.summary?.text) out.summary = { text: str(c.summary.text, 3000) };
  if (c.shared) out.shared = str(c.shared, 64);
  return JSON.stringify(out).length <= LIMITS.chatBytes ? out : null;
}

export function cleanProject(p) {
  if (!p || typeof p !== 'object' || !ID.test(String(p.id))) return null;
  const out = {
    id: String(p.id), name: str(p.name || 'Projekt', 60), instructions: str(p.instructions, 3000), createdAt: num(p.createdAt), updatedAt: num(p.updatedAt),
    files: (Array.isArray(p.files) ? p.files : []).slice(0, 30).map(f => ({ id: str(f?.id || f?.name, 64), name: str(f?.name, 160), text: str(f?.text, 60000) })),
  };
  if (p.deletedAt) out.deletedAt = num(p.deletedAt);
  return JSON.stringify(out).length <= LIMITS.projectBytes ? out : null;
}

/** Alles, was seit `since` (Millisekunden) geändert wurde, samt Server-Zeit für den nächsten Abruf. */
export function pull(key, since = 0) {
  const d = load(key), s = Number(since) || 0;
  const newer = (o) => (o.syncedAt || o.updatedAt) >= s;   // Eingangszeit auf dem Server: unabhängig von falschen Gerätezeiten
  return { chats: Object.values(d.chats).filter(newer), projects: Object.values(d.projects).filter(newer), now: Date.now() };
}

/** Nimmt geänderte Chats und Projekte an. Ältere Fassungen als die gespeicherten werden ignoriert. */
export function push(key, body) {
  const d = load(key);
  const res = { accepted: 0, skipped: 0, rejected: 0, now: Date.now() };
  const take = (list, store, clean, max) => {
    for (const item of (Array.isArray(list) ? list : []).slice(0, LIMITS.perPush)) {
      const c = clean(item);
      if (!c) { res.rejected++; continue; }
      const old = store[c.id];
      if (old && old.updatedAt >= c.updatedAt) { res.skipped++; continue; }
      if (!old && Object.keys(store).length >= max) { res.rejected++; continue; }
      c.syncedAt = res.now; store[c.id] = c; res.accepted++;
    }
  };
  take(body?.chats, d.chats, cleanChat, LIMITS.chats);
  take(body?.projects, d.projects, cleanProject, LIMITS.projects);
  if (JSON.stringify(d).length > LIMITS.accountBytes) { cache.delete(fileFor(key)); return { error: 'Der Speicher für deinen Abgleich ist voll (40 MB). Lösche alte Chats.', status: 413 }; }
  if (res.accepted && !save(key)) return { error: 'Speichern auf dem Server fehlgeschlagen', status: 500 };
  return res;
}

/** Marker älter als `days` Tage endgültig entfernen (hält die Datei klein). */
export function prune(key, days = 45, now = Date.now()) {
  const d = load(key), cut = now - days * 86400000;
  let n = 0;
  for (const store of [d.chats, d.projects]) for (const [id, o] of Object.entries(store)) if (o.deletedAt && o.deletedAt < cut) { delete store[id]; n++; }
  if (n) save(key);
  return n;
}

/** Löscht alle abgeglichenen Daten eines Kontos vom Server. */
export function wipe(key) {
  cache.delete(fileFor(key));
  try { fs.rmSync(fileFor(key), { force: true }); return true; } catch { return false; }
}
