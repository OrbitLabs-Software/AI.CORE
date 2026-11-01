// video.js — Videos über eine Sora-kompatible Schnittstelle (VIDEO_API_KEY gesetzt = an).
// Ablauf: Auftrag anlegen -> Status abfragen -> fertige Datei auf dem Server speichern (data/videos).
// Ein Video dauert Minuten und kostet beim Anbieter Geld; der Tiny selbst kann keine Videos berechnen.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'videos');
export const ID = /^[A-Za-z0-9_-]{3,80}$/;
export const videoEnabled = () => Boolean(process.env.VIDEO_API_KEY);
export const videoFile = (id) => ID.test(id) ? path.join(dir(), `${id}.mp4`) : null;

const base = () => (process.env.VIDEO_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${process.env.VIDEO_API_KEY}` });

async function fail(res, what) {
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch { /* egal */ }
  throw new Error(msg ? `Videoanbieter: ${msg}`.slice(0, 200) : `${what} (Fehler ${res.status})`);
}

export async function startVideo(prompt) {
  const res = await fetch(`${base()}/videos`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.VIDEO_MODEL || 'sora-2', prompt, seconds: String(process.env.VIDEO_SECONDS || 4), size: process.env.VIDEO_SIZE || '1280x720' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) await fail(res, 'Das Video konnte nicht gestartet werden');
  const id = (await res.json())?.id;
  if (!ID.test(String(id))) throw new Error('Der Videoanbieter hat keine gültige Auftrags-ID geliefert');
  return id;
}

/** @returns {{status:'working'|'done'|'failed', progress?:number, error?:string}} */
export async function videoStatus(id) {
  if (!ID.test(id)) return { status: 'failed', error: 'Ungültige ID' };
  const file = videoFile(id);
  if (fs.existsSync(file)) return { status: 'done' };
  const res = await fetch(`${base()}/videos/${id}`, { headers: headers(), signal: AbortSignal.timeout(30000) });
  if (!res.ok) await fail(res, 'Status nicht abrufbar');
  const j = await res.json();
  if (j.status === 'failed') return { status: 'failed', error: String(j.error?.message || 'Der Anbieter konnte das Video nicht erzeugen').slice(0, 200) };
  if (j.status !== 'completed') return { status: 'working', progress: Number(j.progress) || 0 };
  const dl = await fetch(`${base()}/videos/${id}/content`, { headers: headers(), signal: AbortSignal.timeout(180000) });
  if (!dl.ok) await fail(dl, 'Das fertige Video konnte nicht geladen werden');
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()), { mode: 0o600 });
  return { status: 'done' };
}
