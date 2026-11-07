// sync.js — Geräte-Abgleich im Browser: holt Änderungen vom Server, schickt eigene hin, die neuere Änderung gewinnt.
// Die Entscheidung („wer ist neuer“) steckt in reinen Funktionen und ist getestet; die Engine verbindet sie mit Speicher und Server.

const KEY = 'aicore_sync';
const MAX_CHUNK_BYTES = 2_500_000;

/** Eingehenden Chat übernehmen und lokale Bilder und Vorschauen behalten, die der Server nie bekommt. */
export function mergeIncoming(local, remote) {
  if (!local) return remote;
  const byId = new Map(local.messages.map(m => [m.id, m]));
  remote.messages = remote.messages.map((m) => {
    const l = byId.get(m.id);
    if (!l) return m;
    const out = { ...m };
    if (l.images && !out.images) out.images = l.images;
    if (l.attachments && out.attachments) out.attachments = out.attachments.map((a, i) => (l.attachments[i]?.preview ? { ...a, preview: l.attachments[i].preview } : a));
    return out;
  });
  return remote;
}

/** Welche eingehenden Elemente sind neuer als die lokalen? */
export const newerThanLocal = (incoming, getLocal) => incoming.filter(r => { const l = getLocal(r.id); return !l || (r.updatedAt || 0) > (l.updatedAt || 0); });

/** Pakete bilden: höchstens 40 Elemente und ca. 2,5 MB pro Aufruf. */
export function chunk(items, maxItems = 40, maxBytes = MAX_CHUNK_BYTES) {
  const out = []; let cur = [], size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (cur.length && (cur.length >= maxItems || size + n > maxBytes)) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function createSyncEngine({ store, projects, api, enabled, onApplied, onStatus, storageImpl = globalThis.localStorage, now = () => Date.now() }) {
  let running = false, timer = null, interval = null;
  let status = { state: 'aus', at: 0, message: '' };
  const read = () => { try { return JSON.parse(storageImpl?.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = (s) => { try { storageImpl?.setItem(KEY, JSON.stringify(s)); } catch { /* egal */ } };
  const set = (patch) => { status = { ...status, ...patch }; onStatus?.(status); };

  async function run() {
    if (!enabled() || running) return status;
    running = true; set({ state: 'läuft', message: '' });
    try {
      const st = read(), startedLocal = now();
      const r = await api.syncPull(st.since || 0);
      const chats = newerThanLocal(r.chats, (id) => store.get(id));
      for (const c of chats) store.upsert(mergeIncoming(store.get(c.id), c));
      const projs = newerThanLocal(r.projects, (id) => projects.raw().find(p => p.id === id));
      for (const p of projs) projects.upsert(p);

      const since = st.lastPush || 0;
      let sent = 0, rejected = 0;
      for (const part of chunk(store.raw().filter(c => (c.updatedAt || 0) > since))) { const res = await api.syncPush({ chats: part }); sent += res.accepted; rejected += res.rejected; }
      for (const part of chunk(projects.raw().filter(p => (p.updatedAt || 0) > since))) { const res = await api.syncPush({ projects: part }); sent += res.accepted; rejected += res.rejected; }
      write({ since: r.now, lastPush: startedLocal });
      set({ state: 'ok', at: now(), message: `${chats.length + projs.length} geholt, ${sent} gesendet${rejected ? `, ${rejected} zu groß oder ungültig` : ''}`, pulled: chats.length + projs.length, sent, rejected });
      if (chats.length || projs.length) onApplied?.();
    } catch (e) {
      if (e?.status === 401) set({ state: 'aus', message: '' });
      else set({ state: 'fehler', message: e?.network ? 'Server nicht erreichbar' : (e?.message || 'Abgleich fehlgeschlagen') });
    } finally { running = false; }
    return status;
  }

  /** Nach Änderungen kurz warten und dann abgleichen. */
  const soon = (ms = 6000) => { if (!enabled()) return; clearTimeout(timer); timer = setTimeout(run, ms); };
  function start() { stop(); if (!enabled()) return; run(); interval = setInterval(run, 60000); }
  function stop() { clearInterval(interval); clearTimeout(timer); interval = timer = null; }
  const reset = () => write({});
  return { run, soon, start, stop, reset, status: () => status };
}
