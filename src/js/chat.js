import { storage } from './storage.js';
import { uid } from './ui.js';

export function createChatStore() {
  let chats = storage.getChats();
  let activeId = chats[0]?.id || null;

  // Änderungen erkennen: Wer direkt an einem Chat schreibt (Bewertung, Version, Zusammenfassung …) und dann save() ruft,
  // bekommt automatisch ein neues updatedAt. Das braucht der Geräte-Abgleich.
  // Zeitstempel pro Chat streng aufsteigend: zwei Änderungen in derselben Millisekunde dürfen nicht gleich aussehen,
  // sonst hält der Abgleich die zweite für „nicht neuer“ und verliert sie.
  const bump = (c) => { c.updatedAt = Math.max(Date.now(), (c.updatedAt || 0) + 1); return c.updatedAt; };
  const sigs = new WeakMap();
  function signature(c) {
    let fb = 0, no = 0, alts = 0, vs = 0;
    for (const m of c.messages) { if (m.feedback) fb++; no += (m.no || 0) + (m.vIdx || 0); alts += m.alts?.length || 0; vs += m.versions?.length || 0; }
    const last = c.messages.at(-1);
    return [c.title, c.favorite, c.deletedAt, c.summary?.text?.length, c.shared, c.projectId, c.roleId, c.messages.length, last?.id, last?.content?.length, last?.video?.state, fb, no, alts, vs].join('|');
  }

  function persist() {
    for (const c of chats) {
      const sig = signature(c);
      if (sigs.has(c) && sigs.get(c) !== sig) bump(c);
      sigs.set(c, sig);
    }
    storage.saveChats(chats);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('aicore:store-changed'));
  }

  /** Sichtbare Chats (ohne Papierkorb), neueste zuerst. */
  function all() {
    return chats.filter(c => !c.deletedAt).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }

  function favorites() {
    return all().filter(c => c.favorite);
  }

  function history() {
    return all().filter(c => !c.favorite);
  }

  function get(id) {
    return chats.find(c => c.id === id) || null;
  }

  function getActive() {
    return chats.find(c => c.id === activeId) || null;
  }

  function setActive(id) {
    activeId = id;
  }

  function createChat(roleId = null, projectId = null) {
    const chat = {
      id: uid(),
      title: 'Neuer Chat',
      favorite: false,
      roleId,
      projectId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chats.push(chat);
    activeId = chat.id;
    persist();
    return chat;
  }

  /** Löschen = in den Papierkorb (30 Tage), von dort lässt sich der Chat wiederherstellen. */
  function deleteChat(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    chat.deletedAt = bump(chat); chat.favorite = false;
    if (activeId === id) activeId = all()[0]?.id || null;
    persist();
  }
  const trash = () => chats.filter(c => c.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  function restore(id) {
    const chat = chats.find(c => c.id === id && c.deletedAt);
    if (!chat) return false;
    delete chat.deletedAt; bump(chat);
    persist();
    return true;
  }
  function purge(id) { chats = chats.filter(c => !(c.id === id && c.deletedAt)); persist(); }
  function emptyTrash() { const n = trash().length; chats = chats.filter(c => !c.deletedAt); persist(); return n; }
  /** Papierkorb nach `days` Tagen leeren (ohne Abgleich sofort, sonst bleibt der Marker beim Server). */
  function purgeOld(days = 30, now = Date.now()) {
    const keep = chats.filter(c => !c.deletedAt || c.deletedAt > now - days * 86400000);
    const n = chats.length - keep.length;
    if (n) { chats = keep; persist(); }
    return n;
  }
  /** Ersetzt oder ergänzt einen Chat (Abgleich). */
  function upsert(chat) {
    const i = chats.findIndex(c => c.id === chat.id);
    if (i >= 0) chats[i] = chat; else chats.push(chat);
    sigs.delete(chat);
    if (activeId === chat.id && chat.deletedAt) activeId = all()[0]?.id || null;
    persist();
  }

  function toggleFavorite(id) {
    const chat = chats.find(c => c.id === id);
    if (chat) {
      chat.favorite = !chat.favorite;
      persist();
    }
  }

  function addMessage(chatId, message) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.messages.push(message);
    bump(chat);
    if (chat.title === 'Neuer Chat' && message.role === 'user') {
      chat.title = message.content.slice(0, 48) + (message.content.length > 48 ? '…' : '');
    }
    persist();
  }

  function updateMessage(chatId, messageId, patch) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const msg = chat.messages.find(m => m.id === messageId);
    if (!msg) return;
    Object.assign(msg, patch);
    persist();
  }

  function removeMessage(chatId, messageId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.messages = chat.messages.filter(m => m.id !== messageId);
    persist();
  }

  function setRole(chatId, roleId) {
    const chat = get(chatId);
    if (chat) { chat.roleId = roleId; persist(); }
  }

  function rename(chatId, title) {
    const chat = get(chatId);
    const clean = String(title || '').trim().slice(0, 80);
    if (chat && clean) { chat.title = clean; persist(); }
  }

  /** Entfernt die Nachricht und alles danach (für Bearbeiten und Neu generieren). */
  function truncateFrom(chatId, messageId) {
    const chat = get(chatId);
    if (!chat) return;
    const idx = chat.messages.findIndex(m => m.id === messageId);
    if (idx >= 0) { chat.messages = chat.messages.slice(0, idx); bump(chat); persist(); }
  }

  /** Fügt importierte Chats hinzu; vorhandene IDs werden übersprungen. Gibt die Anzahl zurück. */
  function importChats(list) {
    const known = new Set(chats.map(c => c.id));
    const fresh = list.filter(c => !known.has(c.id));
    chats.push(...fresh);
    if (!activeId && chats.length) activeId = all()[0].id;
    persist();
    return fresh.length;
  }

  function clearAll() {
    chats = [];
    activeId = null;
    persist();
  }

  function raw() { return chats; }

  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return all();
    return all().filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some(m => m.content?.toLowerCase().includes(q))
    );
  }

  return {
    all, favorites, history, get, getActive, setActive, createChat, deleteChat,
    toggleFavorite, addMessage, updateMessage, removeMessage, search,
    setRole, rename, truncateFrom, importChats, clearAll, raw, save: persist,
    trash, restore, purge, emptyTrash, purgeOld, upsert,
    get activeId() { return activeId; },
  };
}
