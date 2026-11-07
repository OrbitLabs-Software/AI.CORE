import test from 'node:test';
import assert from 'node:assert/strict';

// Browser-Speicher für die Tests nachbilden
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { createChatStore } = await import('../src/js/chat.js');
const { createProjectStore } = await import('../src/js/projects.js');
const { mergeIncoming, newerThanLocal, chunk, createSyncEngine } = await import('../src/js/sync.js');

const msg = (id, role, content) => ({ id, role, content, createdAt: 1 });

test('Papierkorb: löschen, wiederherstellen, endgültig löschen, nach 30 Tagen leeren', () => {
  mem.clear();
  const s = createChatStore();
  const a = s.createChat(), b = s.createChat();
  s.addMessage(a.id, msg('m1', 'user', 'Hallo')); s.addMessage(b.id, msg('m2', 'user', 'Welt'));
  s.deleteChat(b.id);
  assert.deepEqual(s.all().map(c => c.id), [a.id]);
  assert.equal(s.trash().length, 1);
  assert.equal(s.search('Welt').length, 0);                      // Papierkorb ist nicht durchsuchbar
  assert.ok(s.raw().some(c => c.id === b.id && c.deletedAt));      // Marker bleibt für den Abgleich
  assert.equal(s.restore(b.id), true);
  assert.equal(s.all().length, 2); assert.equal(s.trash().length, 0);
  s.deleteChat(b.id); s.purge(b.id);
  assert.equal(s.raw().length, 1);
  s.deleteChat(a.id);
  assert.equal(s.purgeOld(30, Date.now() + 29 * 86400000), 0);
  assert.equal(s.purgeOld(30, Date.now() + 31 * 86400000), 1);
  assert.equal(s.raw().length, 0);
});

test('Gelöschter aktiver Chat: nächster Chat wird aktiv', () => {
  mem.clear();
  const s = createChatStore();
  const a = s.createChat(); const b = s.createChat();
  s.setActive(b.id); s.deleteChat(b.id);
  assert.equal(s.activeId, a.id);
});

test('save() erkennt direkte Änderungen (Bewertung, Zusammenfassung) und setzt updatedAt neu', async () => {
  mem.clear();
  const s = createChatStore();
  const c = s.createChat(); s.addMessage(c.id, msg('m1', 'assistant', 'Antwort'));
  const before = c.updatedAt;
  await new Promise(r => setTimeout(r, 5));
  s.save();
  assert.equal(c.updatedAt, before);                              // nichts geändert
  c.messages[0].feedback = 'up'; s.save();
  assert.ok(c.updatedAt > before);
  const t = c.updatedAt; await new Promise(r => setTimeout(r, 5));
  c.summary = { text: 'Kurzfassung' }; s.save();
  assert.ok(c.updatedAt > t);
});

test('mergeIncoming behält lokale Bilder, newerThanLocal und chunk', () => {
  const local = { id: 'c', messages: [{ id: 'm1', role: 'assistant', content: 'x', images: ['data:image/png;base64,AAA'] }, { id: 'm2', role: 'user', content: 'y', attachments: [{ name: 'a', preview: 'data:image/jpeg;base64,BBB' }] }] };
  const remote = { id: 'c', updatedAt: 9, messages: [{ id: 'm1', role: 'assistant', content: 'neu' }, { id: 'm2', role: 'user', content: 'y', attachments: [{ name: 'a' }] }, { id: 'm3', role: 'user', content: 'z' }] };
  const m = mergeIncoming(local, remote);
  assert.equal(m.messages[0].images[0], 'data:image/png;base64,AAA'); assert.equal(m.messages[0].content, 'neu');
  assert.equal(m.messages[1].attachments[0].preview, 'data:image/jpeg;base64,BBB'); assert.equal(m.messages.length, 3);
  const loc = { a: { id: 'a', updatedAt: 5 }, b: { id: 'b', updatedAt: 9 } };
  assert.deepEqual(newerThanLocal([{ id: 'a', updatedAt: 6 }, { id: 'b', updatedAt: 9 }, { id: 'c', updatedAt: 1 }], (id) => loc[id]).map(x => x.id), ['a', 'c']);
  assert.deepEqual(chunk(Array.from({ length: 5 }, (_, i) => ({ i, pad: 'x'.repeat(100) })), 2).map(p => p.length), [2, 2, 1]);
  assert.equal(chunk([{ a: 'x'.repeat(600) }, { a: 'y'.repeat(600) }], 40, 1000).length, 2);
});

// Zwei „Geräte“ gleichen über einen gemeinsamen Fake-Server ab
function fakeServer() {
  const db = { chats: {}, projects: {} }; let t = 1000;
  return {
    async syncPull(since) { t += 10; return { chats: Object.values(db.chats).filter(c => c.syncedAt >= since), projects: Object.values(db.projects).filter(p => p.syncedAt >= since), now: t }; },
    async syncPush(body) { t += 10; let accepted = 0, skipped = 0; for (const [k, list] of [['chats', body.chats || []], ['projects', body.projects || []]]) for (const x of list) { const o = db[k][x.id]; if (o && o.updatedAt >= x.updatedAt) { skipped++; continue; } db[k][x.id] = { ...JSON.parse(JSON.stringify(x)), syncedAt: t }; accepted++; } return { accepted, skipped, rejected: 0, now: t }; },
    db,
  };
}
function device() {
  const mine = new Map();
  const storageImpl = { getItem: (k) => mine.get(k) ?? null, setItem: (k, v) => mine.set(k, v) };
  mem.clear();
  const store = createChatStore(), projects = createProjectStore();
  return { store, projects, storageImpl, snapshot: () => ({ chats: JSON.stringify(store.raw()), projects: JSON.stringify(projects.raw()) }) };
}

test('Zwei Geräte: Chats und Löschen wandern hin und her, die neuere Änderung gewinnt', async () => {
  const server = fakeServer();
  let clock = 5000; const now = () => (clock += 100);
  mem.clear(); const A = createChatStore(), AP = createProjectStore();
  const engA = createSyncEngine({ store: A, projects: AP, api: server, enabled: () => true, storageImpl: { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, v); } }, now });
  const chatA = A.createChat(); A.addMessage(chatA.id, msg('ma1', 'user', 'Von Gerät A')); A.addMessage(chatA.id, msg('ma2', 'assistant', 'Antwort A'));
  AP.upsert({ id: 'projA', name: 'Projekt A', instructions: '', files: [], createdAt: 1, updatedAt: now() });
  let r = await engA.run();
  assert.equal(r.state, 'ok'); assert.equal(Object.keys(server.db.chats).length, 1);

  // Gerät B (frischer Speicher) holt alles
  const bMem = new Map();
  mem.clear(); const B = createChatStore(), BP = createProjectStore();
  const engB = createSyncEngine({ store: B, projects: BP, api: server, enabled: () => true, storageImpl: { getItem: (k) => bMem.get(k) ?? null, setItem: (k, v) => bMem.set(k, v) }, now });
  r = await engB.run();
  assert.equal(B.all().length, 1); assert.equal(B.all()[0].messages[1].content, 'Antwort A');
  assert.equal(BP.all()[0].name, 'Projekt A');

  // B schreibt weiter, A holt es
  const cb = B.get(chatA.id); B.addMessage(cb.id, msg('mb1', 'user', 'Weiter von B'));
  await engB.run(); await engA.run();
  assert.equal(A.get(chatA.id).messages.length, 3);

  // A löscht, B bekommt den Papierkorb-Marker
  A.deleteChat(chatA.id); await engA.run(); await engB.run();
  assert.equal(B.all().length, 0); assert.equal(B.trash().length, 1);
  // B stellt wieder her, A sieht den Chat wieder
  B.restore(chatA.id); await engB.run(); await engA.run();
  assert.equal(A.all().length, 1);
});

test('Aus oder Serverfehler: nichts passiert bzw. Status „fehler“', async () => {
  mem.clear(); const S = createChatStore(), P = createProjectStore();
  const off = createSyncEngine({ store: S, projects: P, api: { syncPull: () => { throw new Error('darf nicht laufen'); } }, enabled: () => false, storageImpl: { getItem: () => null, setItem() {} } });
  assert.equal((await off.run()).state, 'aus');
  const bad = createSyncEngine({ store: S, projects: P, api: { syncPull: async () => { const e = new Error('x'); e.network = true; throw e; } }, enabled: () => true, storageImpl: { getItem: () => null, setItem() {} } });
  const st = await bad.run();
  assert.equal(st.state, 'fehler'); assert.match(st.message, /nicht erreichbar/);
});
