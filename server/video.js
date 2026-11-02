// video.js — Videos über einen Anbieter. Zwei Wege (VIDEO_BACKEND, sonst automatisch nach den Schlüsseln):
//   huggingface  HF_TOKEN gesetzt: Hugging Face Inference Providers (Paket @huggingface/inference)
//   openai       VIDEO_API_KEY gesetzt: Sora-kompatible Schnittstelle (Auftrag -> Status -> Datei)
// Das fertige Video liegt danach auf dem Server (data/videos). Ein Video dauert Minuten und kostet beim Anbieter Geld;
// der Tiny selbst kann keine Videos berechnen.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'videos');
export const ID = /^[A-Za-z0-9_-]{3,80}$/;
export const videoBackend = () => {
  const e = process.env, b = e.VIDEO_BACKEND;
  if (b === 'huggingface') return e.HF_TOKEN ? 'huggingface' : '';
  if (b === 'openai') return e.VIDEO_API_KEY ? 'openai' : '';
  return e.HF_TOKEN ? 'huggingface' : e.VIDEO_API_KEY ? 'openai' : '';
};
export const videoEnabled = () => Boolean(videoBackend());
export const videoFile = (id) => ID.test(id) ? path.join(dir(), `${id}.mp4`) : null;

const base = () => (process.env.VIDEO_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${process.env.VIDEO_API_KEY}` });

async function fail(res, what) {
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch { /* egal */ }
  throw new Error(msg ? `Videoanbieter: ${msg}`.slice(0, 200) : `${what} (Fehler ${res.status})`);
}

// ---------- Hugging Face ----------
const jobs = new Map();   // id -> { state: 'working' | 'failed', error }
let loadHf = () => import('@huggingface/inference');
export const _setHfLoader = (fn) => { loadHf = fn; };   // nur für Tests

const friendly = (e) => /402|credit|quota|payment|billing/i.test(e?.message || '')
  ? 'Das Guthaben beim Videoanbieter ist aufgebraucht.'
  : String(e?.message || 'Video fehlgeschlagen').slice(0, 200);

async function runHf(id, prompt, onFail) {
  try {
    const mod = await loadHf().catch(() => { throw new Error('Das Paket „@huggingface/inference“ fehlt. Auf dem Server „npm install @huggingface/inference“ ausführen.'); });
    const client = new mod.InferenceClient(process.env.HF_TOKEN);
    const provider = process.env.HF_VIDEO_PROVIDER;
    const blob = await client.textToVideo(
      { ...(provider && provider !== 'auto' ? { provider } : {}), model: process.env.HF_VIDEO_MODEL || 'Lightricks/LTX-Video', inputs: prompt },
      { signal: AbortSignal.timeout(20 * 60 * 1000) },
    );
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(videoFile(id), Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
    jobs.delete(id);
  } catch (e) {
    console.warn('[video]', e.message);
    jobs.set(id, { state: 'failed', error: friendly(e) });
    onFail?.();
  }
}

function startHf(prompt, onFail) {
  const running = [...jobs.values()].filter(j => j.state === 'working').length;
  if (running >= (Number(process.env.HF_MAX_PARALLEL) || 2)) throw new Error('Es werden gerade schon Videos erzeugt. Bitte in ein paar Minuten erneut.');
  const id = `hf_${crypto.randomBytes(8).toString('hex')}`;
  jobs.set(id, { state: 'working' });
  runHf(id, prompt, onFail);   // läuft im Hintergrund weiter
  return id;
}

/** onFail wird aufgerufen, wenn ein Hintergrund-Auftrag scheitert (zum Zurückgeben des Kontingents). */
export async function startVideo(prompt, { onFail } = {}) {
  if (videoBackend() === 'huggingface') return startHf(prompt, onFail);
  return startSora(prompt);
}

async function startSora(prompt) {
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
  if (id.startsWith('hf_')) {
    const j = jobs.get(id);
    if (!j) return { status: 'failed', error: 'Der Server wurde neu gestartet, bevor das Video fertig war.' };
    return j.state === 'failed' ? { status: 'failed', error: j.error } : { status: 'working' };
  }
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
