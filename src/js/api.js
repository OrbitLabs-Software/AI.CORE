// api.js — die einzige Verbindung zwischen Oberfläche und Server.
// Streaming-Antworten, Anmeldung, Modellverwaltung. Ist gar kein Server erreichbar
// (z. B. statische Vorschau), antwortet ein klar gekennzeichneter Demo-Modus.

import { apiUrl, serverBase, isCrossOrigin, isPrivateHost } from './config.js';
import { buildPreviewHtml } from './previewHtml.js';

export class ApiError extends Error {
  constructor(message, status, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// ---------- Sitzung: Token im Browser (Cookies gehen zwischen GitHub-Seite und Server nicht zuverlässig) ----------
const TOKEN_KEY = 'aicore_token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* egal */ } };

/** fetch mit Server-Adresse, Token und verständlichem Fehler, wenn der Server nicht erreichbar ist. */
async function send(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const local = isCrossOrigin() && isPrivateHost(new URL(serverBase()).hostname);
  try {
    return await fetch(apiUrl(path), {
      credentials: isCrossOrigin() ? 'omit' : 'same-origin',
      ...(local ? { targetAddressSpace: 'local' } : {}), // Chrome: Zugriff aufs Heimnetz (fragt einmal nach)
      ...options, headers,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Der Server ist nicht erreichbar.', 0, { network: true });
  }
}

async function request(path, options = {}) {
  const res = await send(path, options);
  if (res.status === 401) {
    setToken('');
    window.dispatchEvent(new CustomEvent('aicore:unauthorized'));
    throw new ApiError('Anmeldung erforderlich', 401);
  }
  return res;
}

async function errorMessage(res) {
  try { return (await res.json()).error || `Fehler ${res.status}`; } catch { return `Fehler ${res.status}`; }
}

const jsonPost = (url, body, extra = {}) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });

/** Liest Server-Sent-Events und gibt jedes JSON-Objekt zurück. */
async function* readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    for (const block of blocks) {
      const line = block.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload); } catch { /* defekten Block ignorieren */ }
    }
  }
}

export const api = {
  demoMode: false, // wird true, sobald der Server nur den Demo-Modus liefert

  async config() {
    const res = await send('/api/config');
    if (!res.ok) throw new ApiError('Server antwortet nicht richtig (Fehler ' + res.status + ').', res.status, { network: true });
    try { return await res.json(); } catch { throw new ApiError('Das ist kein AI-Core-Server.', 0, { network: true }); }
  },

  async login(password) {
    const res = await send('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    setToken((await res.json()).token);
  },

  /** Tauscht ein Firebase-ID-Token gegen die Sitzung des Servers. */
  async firebaseLogin(idToken) {
    const res = await send('/api/auth/firebase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    const data = await res.json();
    setToken(data.token);
    return data;
  },

  async logout() {
    await send('/api/logout', { method: 'POST' }).catch(() => {});
    setToken('');
  },

  async health() {
    const res = await request('/api/health');
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  warmup(model) {
    return jsonPost('/api/warmup', { model }).catch(() => {});
  },

  async models() {
    const res = await request('/api/models');
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  /** Lädt ein Modell herunter; gibt {status, percent} zurück. */
  async *pullModel(name) {
    const res = await jsonPost('/api/models/pull', { name });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    yield* readSse(res);
  },

  async memories() {
    const res = await request('/api/memories');
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },
  async addMemory(text) {
    const res = await jsonPost('/api/memories', { text });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).item;
  },
  async deleteMemory(id) {
    const res = await request(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  },
  async clearMemories() {
    const res = await request('/api/memories', { method: 'DELETE' });
    return res.ok;
  },

  // ---------- Links, Bibliothek, Modelle, Meldungen ----------
  async readUrl(url) { const res = await jsonPost('/api/read', { url }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async libraryList() { const res = await request('/api/library'); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async libraryAdd(name, text) { const res = await jsonPost('/api/library', { name, text }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async libraryRemove(id) { const res = await request(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); },
  async librarySearch(query, budget) { const res = await jsonPost('/api/library/search', { query, budget }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async adminModels() { const res = await request('/api/admin/models'); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async adminPull(name) { const res = await jsonPost('/api/admin/models/pull', { name }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async adminPullCancel() { await request('/api/admin/models/pull', { method: 'DELETE' }); },
  async adminDeleteModel(name) { const res = await jsonPost('/api/admin/models/delete', { name }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); },
  async adminLogs(level = 'all') { const res = await request(`/api/admin/logs?level=${encodeURIComponent(level)}&limit=120`); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return (await res.json()).logs; },

  // ---------- Geräte-Abgleich ----------
  async syncPull(since = 0) { const res = await request(`/api/sync?since=${encodeURIComponent(since)}`); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async syncPush(body) { const res = await jsonPost('/api/sync', body); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async syncWipe() { const res = await request('/api/sync', { method: 'DELETE' }); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); },

  async adminStatus() { const res = await request('/api/admin/status'); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },

  /** Websuche über den Server. deep = die ersten Seiten werden gelesen. */
  async search(query, deep = false) {
    const res = await jsonPost('/api/search', { query, deep });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  // ---------- Tarif ----------
  async plan() { const res = await request('/api/plan'); if (!res.ok) throw new ApiError(await errorMessage(res), res.status); return res.json(); },
  async proCheckout(returnUrl) {
    const res = await jsonPost('/api/pro/checkout', { returnUrl });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).url;
  },
  async proConfirm(sessionId) {
    const res = await jsonPost('/api/pro/confirm', { sessionId });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },
  async proPortal(returnUrl) {
    const res = await jsonPost('/api/pro/portal', { returnUrl });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).url;
  },
  async proRedeem(code) {
    const res = await jsonPost('/api/pro/redeem', { code });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  /** Chat als Nur-Lesen-Link teilen; gibt die ID zurück. */
  async share(chat) {
    const res = await jsonPost('/api/share', { chat: { title: chat.title, messages: chat.messages.filter(m => !m.media).map(m => ({ role: m.role, content: m.content, attachments: (m.attachments || []).map(a => ({ name: a.name })) })) } });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).id;
  },
  async unshare(id) { await request(`/api/share/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async getShare(id) {
    const res = await send(`/api/share/${encodeURIComponent(id)}`);
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  async image(prompt) {
    const res = await jsonPost('/api/image', { prompt });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).image;
  },
  async videoStart(prompt) {
    const res = await jsonPost('/api/video', { prompt });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return (await res.json()).id;
  },
  async videoStatus(id) {
    const res = await request(`/api/video/${encodeURIComponent(id)}`);
    return res.json();
  },
  /** Das Video braucht die Anmeldung, daher als Datei laden und lokal abspielen. */
  async videoBlobUrl(id) {
    const res = await request(`/api/video/${encodeURIComponent(id)}/file`);
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return URL.createObjectURL(await res.blob());
  },

  /** Vorschau für HTML/SVG: {url} (Server, gleicher Ursprung) oder {srcdoc} (Seite liegt woanders, z. B. GitHub). */
  async preview(kind, code) {
    if (isCrossOrigin()) return { srcdoc: buildPreviewHtml(kind, code) };
    const res = await jsonPost('/api/preview', { kind, code });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return { url: (await res.json()).url };
  },

  async upload(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await request('/api/upload', { method: 'POST', body: form });
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    return res.json();
  },

  /**
   * Streamt eine Antwort. Liefert Objekte: {delta} | {meta} | {notice}.
   * Serverfehler (z. B. Rate-Limit) werden als ApiError geworfen.
   */
  async *streamChat({ messages, model, system, temperature, memory, signal }) {
    let res;
    try {
      res = await jsonPost('/api/chat/stream', { messages, model, system, temperature, memory }, { signal });
    } catch (e) {
      if (e.name === 'AbortError' || (e instanceof ApiError && !e.network)) throw e;
      if (isCrossOrigin()) throw e;        // GitHub-Seite: klare Fehlermeldung statt Demo
      this.demoMode = true;                // gar kein Server: Demo
      yield* demoStream(messages);
      return;
    }
    if (!res.ok || !res.body) throw new ApiError(await errorMessage(res), res.status);
    for await (const event of readSse(res)) {
      if (event.demo) this.demoMode = true;
      yield event;
    }
  },
};

// ---------- Demo ohne Server ----------
async function* demoStream(messages) {
  const last = messages[messages.length - 1]?.content || '';
  const reply = last.trim()
    ? `**Demo-Modus** — der Server ist nicht erreichbar.\n\nDu hast geschrieben:\n\n> ${last.trim().slice(0, 300)}\n\nStarte AI Core mit \`npm start\` und prüfe, ob Ollama läuft.`
    : 'Ich bin bereit, sobald du mir eine Frage stellst.';
  for (const w of reply.split(/(\s+)/)) {
    await new Promise(r => setTimeout(r, 14 + Math.random() * 18));
    yield { delta: w, demo: true };
  }
}
