import { storage } from './storage.js';
import { uid } from './ui.js';

export function createChatStore() {
  let chats = storage.getChats();
  let activeId = chats[0]?.id || null;

  function persist() {
    storage.saveChats(chats);
  }

  function all() {
    return chats.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
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

  function createChat(roleId = null) {
    const chat = {
      id: uid(),
      title: 'Neuer Chat',
      favorite: false,
      roleId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chats.push(chat);
    activeId = chat.id;
    persist();
    return chat;
  }

  function deleteChat(id) {
    chats = chats.filter(c => c.id !== id);
    if (activeId === id) activeId = chats[0]?.id || null;
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
    chat.updatedAt = Date.now();
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
    if (idx >= 0) { chat.messages = chat.messages.slice(0, idx); chat.updatedAt = Date.now(); persist(); }
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
    get activeId() { return activeId; },
  };
}
