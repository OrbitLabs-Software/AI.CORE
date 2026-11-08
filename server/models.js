// models.js — Ollama-Modelle von der Weboberfläche aus laden und löschen (nur für den Besitzer).
import fs from 'fs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const validName = (n) => typeof n === 'string' && NAME.test(n) && !n.includes('..');

export const SUGGESTED = [
  { name: 'llama3.2:3b', note: 'kleiner Allrounder, etwa 2 GB' },
  { name: 'qwen2.5:3b', note: 'Allrounder, etwa 2 GB' },
  { name: 'gemma3:4b', note: 'kann auch Bilder ansehen, etwa 3 GB' },
  { name: 'deepseek-r1:1.5b', note: 'denkt vor dem Antworten nach, etwa 1 GB' },
  { name: 'moondream', note: 'beschreibt Bilder, sehr klein' },
  { name: 'llama3.2:1b', note: 'sehr schnell und sehr klein, etwa 1 GB' },
];

let job = null;
export const pullStatus = () => (job ? { name: job.name, status: job.status, percent: job.percent, error: job.error, done: job.done } : null);
export const _resetJob = () => { job = null; };
export function cancelPull() { if (job && !job.done) { job.ac.abort(); return true; } return false; }

export function startPull(name, cfg) {
  if (!validName(name)) throw new Error('Das ist kein gültiger Modellname.');
  if (job && !job.done) throw new Error(`Es wird gerade „${job.name}“ geladen. Bitte warten oder abbrechen.`);
  const j = { name, status: 'startet …', percent: 0, error: null, done: false, ac: new AbortController() };
  job = j;
  (async () => {
    try {
      const res = await fetch(`${cfg.ollamaUrl}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, name, stream: true }), signal: j.ac.signal });
      if (!res.ok) throw new Error(res.status === 404 ? 'Dieses Modell gibt es bei Ollama nicht.' : `Ollama antwortet mit Fehler ${res.status}`);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.error) throw new Error(String(m.error).slice(0, 200));
          if (m.status) j.status = String(m.status).slice(0, 80);
          if (m.total > 0 && m.completed >= 0) j.percent = Math.min(100, Math.round(m.completed / m.total * 100));
          if (m.status === 'success') j.percent = 100;
        }
      }
      if (j.status !== 'success') throw new Error('Das Laden wurde unvollständig beendet.');
    } catch (e) {
      j.error = j.ac.signal.aborted ? 'Abgebrochen.' : (e.cause?.code === 'ECONNREFUSED' ? 'Ollama ist nicht erreichbar.' : e.message);
    } finally { j.done = true; }
  })();
  return pullStatus();
}

export async function deleteModel(name, cfg) {
  if (!validName(name)) throw new Error('Das ist kein gültiger Modellname.');
  const res = await fetch(`${cfg.ollamaUrl}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, name }), signal: AbortSignal.timeout(20000) });
  if (res.status === 404) throw new Error('Dieses Modell ist nicht installiert.');
  if (!res.ok) throw new Error(`Ollama antwortet mit Fehler ${res.status}`);
}

export function diskFree(target = '/') {
  try { const s = fs.statfsSync(target); return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; } catch { return null; }
}
