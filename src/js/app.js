import { storage } from './storage.js';
import { createChatStore } from './chat.js';
import { api, ApiError } from './api.js';
import { createFileManager } from './files.js';
import { uid, showToast, renderMarkdown, plainText, estimateTokens, downloadFile, extractCodeBlocks, isPreviewable, escapeHtml, EXT } from './ui.js';
import { allRoles, getRole } from './roles.js';
import { exportChatMarkdown } from './exporter.js';
import { makeZip } from './zip.js';
import { suggestMemory, parseRememberCommand } from './hints.js';
import { createSlashMenu, parseSlash } from './slash.js';
import { createArtifactPanel } from './artifacts.js';
import { renderMessageEl } from '../components/chatMessage.js';
import { renderChatList, renderGroupedChats } from '../components/sidebar.js';
import { renderFilePreviewRow } from '../components/filePreview.js';
import { initComposer } from '../components/composer.js';
import { openSettingsModal } from './settings.js';
import { mountLogin, mountConnect } from './login.js';
import { isCrossOrigin } from './config.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const appEl = $('app');
const chatScroll = $('chat-scroll');
const welcomeScreen = $('welcome-screen');
const messageList = $('message-list');
const typingIndicator = $('typing-indicator');
const titleEl = $('current-chat-title');
const modelSelect = $('model-select');
const roleSelect = $('role-select');
const statusDot = $('status-dot');
const composerInput = $('composer-input');
const searchInput = $('chat-search');

// ---------- Zustand ----------
const settings = storage.getSettings();
document.documentElement.setAttribute('data-theme', settings.theme);

const store = createChatStore();
let abortController = null;
let busy = false;
let userAborted = false;
let health = null;
let speakingId = null;
let appConfig = { authRequired: false, authenticated: true, methods: { password: false, firebase: null }, user: null };

const fileManager = createFileManager({
  onChange: (files) => renderFilePreviewRow($('file-preview-row'), files, { onRemove: (id) => fileManager.removeFile(id) }),
});
let sidebarAutoCollapsed = false;
const panel = createArtifactPanel({
  onToggle: (open) => {
    $('panel-toggle').classList.toggle('on', open);
    appEl.classList.toggle('panel-open', open);
    // Auf mittleren Bildschirmen weicht die Seitenleiste, damit Chat und Vorschau Platz haben.
    if (open && window.innerWidth > 1100 && window.innerWidth < 1700 && !appEl.classList.contains('sidebar-collapsed')) {
      appEl.classList.add('sidebar-collapsed'); sidebarAutoCollapsed = true;
    } else if (!open && sidebarAutoCollapsed) {
      appEl.classList.remove('sidebar-collapsed'); sidebarAutoCollapsed = false;
    }
  },
});

const SUGGESTIONS = {
  default: [
    { icon: '✍️', title: 'E-Mail entwerfen', sub: 'Formell, freundlich oder kurz', prompt: 'Schreibe eine freundliche E-Mail an ' },
    { icon: '💡', title: 'Idee ausarbeiten', sub: 'Von der Notiz zum Plan', prompt: 'Hilf mir, diese Idee auszuarbeiten: ' },
    { icon: '📄', title: 'Datei zusammenfassen', sub: 'PDF, Word oder Text anhängen', prompt: 'Fasse die angehängte Datei in fünf Stichpunkten zusammen.' },
    { icon: '🧠', title: 'Etwas erklären', sub: 'Einfach und Schritt für Schritt', prompt: 'Erkläre mir einfach: ' },
  ],
  coder: [
    { icon: '🌐', title: 'Webseite bauen', sub: 'Eine Datei, sofort in der Vorschau', prompt: 'Baue eine moderne Landingpage für ' },
    { icon: '🎮', title: 'Spiel entwickeln', sub: 'Läuft direkt im Browser', prompt: 'Programmiere ein kleines Browser-Spiel: ' },
    { icon: '🐞', title: 'Fehler finden', sub: 'Code einfügen, Ursache erklären lassen', prompt: 'Finde den Fehler in diesem Code und erkläre ihn:\n\n' },
    { icon: '🔍', title: 'Code erklären', sub: 'Zeile für Zeile verständlich', prompt: 'Erkläre mir diesen Code:\n\n' },
  ],
};

// ---------- Hilfen ----------
const currentModel = () => modelSelect.value || (health?.model && !health.model.startsWith('demo/') ? health.model : undefined);
const sourceOf = (id) => String(id || '').split('/')[0];
const userName = () => String(appConfig.user?.name || settings.username || '').trim();

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

function nearBottom() {
  return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 160;
}
function scrollToBottom(force = true) {
  if (!force && !nearBottom()) return;
  requestAnimationFrame(() => chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'auto' }));
}

function updateUserLabel() {
  const name = userName() || 'Nutzer';
  $('settings-btn').querySelector('.user-name').textContent = name;
  $('settings-btn').querySelector('.user-name').title = appConfig.user?.email || '';
  $('settings-btn').querySelector('.avatar').textContent = name.charAt(0).toUpperCase();
}

// ---------- Rendering ----------
function renderSidebar() {
  const handlers = { activeId: store.activeId, onSelect: selectChat, onDelete: onDeleteChat, onToggleFavorite: (id) => { store.toggleFavorite(id); renderSidebar(); } };
  const q = searchInput.value.trim();
  const favs = store.favorites();
  $('favorites-section').hidden = q !== '' || favs.length === 0;
  renderChatList($('favorites-list'), favs, handlers);
  if (q) renderChatList($('history-list'), store.search(q), { ...handlers, emptyText: 'Keine Treffer' });
  else renderGroupedChats($('history-list'), store.history(), { ...handlers, emptyText: 'Noch keine Chats' });
}

function renderWelcome(roleId) {
  const name = userName().split(/\s+/)[0];
  $('welcome-title').innerHTML = name
    ? `${greeting()}, <span class="grad">${escapeHtml(name)}</span>`
    : 'Woran arbeiten wir <span class="grad">heute</span>?';
  $('welcome-sub').textContent = roleId === 'coder'
    ? 'Beschreibe, was du bauen willst. HTML und SVG siehst du sofort in der Vorschau.'
    : 'Stelle eine Frage, hänge eine Datei an oder wähle einen Vorschlag.';
  const box = $('suggestion-cards');
  box.innerHTML = '';
  for (const s of SUGGESTIONS[roleId === 'coder' ? 'coder' : 'default']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggestion-card';
    b.innerHTML = `<span class="sc-icon" aria-hidden="true">${s.icon}</span><span><span class="sc-title">${escapeHtml(s.title)}</span><span class="sc-sub">${escapeHtml(s.sub)}</span></span>`;
    b.addEventListener('click', () => composer.setValue(s.prompt));
    box.appendChild(b);
  }
}

function messageHandlers(chat) {
  return {
    speakingId,
    onCopy: (m) => { navigator.clipboard?.writeText(m.content); showToast('Nachricht kopiert'); },
    onRegenerate: (m) => regenerate(chat.id, m),
    onEdit: (m) => editMessage(chat.id, m),
    onSpeak: speak,
    onZip: downloadZip,
    onCode: handleCodeAction,
    onSaveMemory: (m) => saveMemoryHint(m),
    onDismissMemory: (m) => { m.memoryHint = null; store.save(); renderMessages({ keepScroll: true }); },
  };
}

function renderMessages({ keepScroll = false } = {}) {
  const chat = store.getActive();
  messageList.innerHTML = '';
  renderRoleSelect();
  const roleId = chat?.roleId || settings.roleId;

  if (!chat || chat.messages.length === 0) {
    renderWelcome(roleId);
    welcomeScreen.hidden = false;
    messageList.hidden = true;
    titleEl.textContent = chat?.title && chat.title !== 'Neuer Chat' ? chat.title : (roleId === 'coder' ? 'Coder' : 'Neuer Chat');
    updateContextMeter();
    return;
  }
  welcomeScreen.hidden = true;
  messageList.hidden = false;
  titleEl.textContent = chat.title;
  const handlers = messageHandlers(chat);
  for (const message of chat.messages) messageList.appendChild(renderMessageEl(message, handlers));
  updateContextMeter();
  if (!keepScroll) scrollToBottom();
}

function renderRoleSelect() {
  const chat = store.getActive();
  roleSelect.innerHTML = '';
  for (const r of allRoles(settings)) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name;
    roleSelect.appendChild(o);
  }
  roleSelect.value = getRole(settings, chat?.roleId || settings.roleId).id;
}

// Markdown beim Streamen höchstens einmal pro Bildschirm-Frame neu zeichnen.
let renderQueued = null;
function scheduleMessageRender(chatId, message) {
  const first = !renderQueued;
  renderQueued = { chatId, message };
  if (!first) return;
  requestAnimationFrame(() => {
    const job = renderQueued;
    renderQueued = null;
    if (!job || store.activeId !== job.chatId) return;
    const stick = nearBottom();
    const contentEl = messageList.querySelector(`[data-id="${job.message.id}"] .message-content`);
    if (contentEl) contentEl.innerHTML = renderMarkdown(job.message.content);
    if (stick) chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'auto' });
  });
}

// ---------- Kontext-Anzeige ----------
function contextLimit() {
  const lim = health?.limits;
  if (!lim) return 4096;
  return sourceOf(currentModel()) === 'ollama' || !health.status?.cloud?.enabled ? lim.numCtx : lim.cloudContext;
}

function updateContextMeter() {
  const chat = store.getActive();
  const msgs = chat?.messages || [];
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const used = msgs.reduce((n, m) => n + estimateTokens(m.role === 'assistant' ? m.content.replace(/<think>[\s\S]*?<\/think>/g, '') : m.content), 0)
    + (lastUser?.attachments || []).reduce((n, a) => n + estimateTokens(a.text || ''), 0);
  const limit = contextLimit();
  const pct = Math.min(1, used / limit);
  const meter = $('ctx-meter');
  meter.querySelector('.ring').style.strokeDashoffset = String(75.4 * (1 - pct));
  $('ctx-pct').textContent = String(Math.round(pct * 100));
  meter.classList.toggle('warn', pct >= 0.75 && pct < 0.95);
  meter.classList.toggle('full', pct >= 0.95);
  meter.title = `Kontext: etwa ${used.toLocaleString('de-DE')} von ${limit.toLocaleString('de-DE')} Token belegt` +
    (pct >= 0.95 ? ' — die ältesten Nachrichten werden gekürzt' : pct >= 0.75 ? ' — bald voll, starte ggf. einen neuen Chat' : '');
}

// ---------- Aktionen ----------
function selectChat(id) {
  if (panel.isOpen()) panel.close();   // die Vorschau gehörte zum vorherigen Chat
  store.setActive(id);
  fileManager.clear();
  renderSidebar();
  renderMessages();
  closeDrawer();
}

function onDeleteChat(id) {
  if (busy && id === store.activeId) abortController?.abort();
  store.deleteChat(id);
  renderSidebar();
  renderMessages();
}

function newChat(roleId = null) {
  if (panel.isOpen()) panel.close();
  store.createChat(roleId ?? (settings.roleId !== 'default' ? settings.roleId : null));
  fileManager.clear();
  renderSidebar();
  renderMessages();
  composerInput.focus();
  closeDrawer();
}

function startCoder() {
  newChat('coder');
  showToast('Coder-Modus: Vorschau erscheint rechts, sobald HTML kommt');
}

function closeDrawer() { appEl.classList.remove('drawer-open'); }

// Cloud-Hinweis: Nachrichten verlassen den Tiny — einmal pro Quelle bestätigen.
function ensureCloudAck(id) {
  const src = sourceOf(id);
  if (src !== 'cloud' && src !== 'anthropic') return true;
  if (settings.cloudAck?.[src]) return true;
  const label = src === 'cloud' ? (health?.status?.cloud?.label || 'dem Cloud-Anbieter') : 'Anthropic';
  const ok = window.confirm(`Mit diesem Modell werden deine Nachrichten an ${label} gesendet (Cloud). Lokale Modelle bleiben auf dem Tiny.\n\nFortfahren?`);
  if (ok) { settings.cloudAck = { ...settings.cloudAck, [src]: true }; storage.saveSettings(settings); }
  return Boolean(ok);
}

function handleSubmit(text) {
  const slash = parseSlash(text, COMMANDS);
  if (slash) { slash.cmd.run(slash.args); return; }
  if (busy) { showToast('Bitte warten — oder mit Esc die Antwort stoppen'); return false; }
  if (fileManager.getAll().some(f => f.status === 'uploading')) { showToast('Die Datei wird noch gelesen …'); return false; }
  if (!ensureCloudAck(currentModel())) return false;
  sendMessage(text);
}

async function sendMessage(text) {
  let chat = store.getActive();
  if (!chat) chat = store.createChat(settings.roleId !== 'default' ? settings.roleId : null);

  const attachments = fileManager.getAll().map(f => ({
    id: f.id, name: f.name, type: f.type, preview: f.preview,
    text: f.text ? f.text.slice(0, 30000) : null, note: f.note || null,
  }));

  // „Merk dir …“ speichert direkt; sonst schlagen wir bei Sätzen wie „Ich heiße …“ ein Merken vor.
  let memoryHint = null;
  if (settings.useMemory) {
    const cmd = parseRememberCommand(text);
    if (cmd) { remember(cmd, { quiet: false }); }
    else if (settings.memoryHints) memoryHint = suggestMemory(text);
  }

  store.addMessage(chat.id, { id: uid(), role: 'user', content: text, attachments, memoryHint, createdAt: Date.now() });
  fileManager.clear();
  renderSidebar();
  renderMessages();
  await runAssistantTurn(chat.id);
}

function buildHistory(chat) {
  const lastIdx = chat.messages.length - 1;
  return chat.messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    ...(m.role === 'user' && m.attachments?.length ? {
      attachments: m.attachments.map(a => ({
        name: a.name,
        text: a.text || undefined,
        image: i === lastIdx && a.preview?.startsWith('data:image/') ? a.preview : undefined,
      })),
    } : {}),
  }));
}

async function runAssistantTurn(chatId) {
  const chat = store.get(chatId);
  if (!chat) return;

  busy = true;
  userAborted = false;
  composer.setBusy(true);
  typingIndicator.hidden = store.activeId !== chatId;
  scrollToBottom();

  const assistant = { id: uid(), role: 'assistant', content: '', createdAt: Date.now() };
  const startedAt = Date.now();
  let started = false, stats = null, notice = null, usedMemory = false, failure = null, lastSave = 0;

  abortController = new AbortController();
  try {
    const role = getRole(settings, chat.roleId || settings.roleId);
    const stream = api.streamChat({
      messages: buildHistory(chat),
      model: currentModel(),
      system: role.prompt || undefined,
      temperature: settings.temperature ?? undefined,
      memory: settings.useMemory,
      signal: abortController.signal,
    });

    for await (const ev of stream) {
      if (ev.notice === 'trimmed') notice = 'trimmed';
      if (ev.notice === 'memory') usedMemory = true;
      if (ev.notice === 'images_ignored') showToast('Dieses Modell kann keine Bilder ansehen — wähle ein Modell mit Bild-Unterstützung.');
      if (ev.meta) stats = ev.meta;
      if (!ev.delta) continue;

      if (!started) {
        started = true;
        typingIndicator.hidden = true;
        store.addMessage(chatId, assistant);
        if (store.activeId === chatId) renderMessages();
      }
      assistant.content += ev.delta;
      scheduleMessageRender(chatId, assistant);
      if (Date.now() - lastSave > 700) { store.save(); lastSave = Date.now(); }
    }
  } catch (e) {
    if (e.name !== 'AbortError' && !(e instanceof ApiError && e.status === 401)) {
      failure = e instanceof ApiError ? e.message : 'Verbindung unterbrochen';
    }
  } finally {
    busy = false;
    composer.setBusy(false);
    typingIndicator.hidden = true;
    abortController = null;

    if (started) {
      if (stats) assistant.stats = { ...stats, seconds: Math.round((Date.now() - startedAt) / 100) / 10 };
      if (notice) assistant.notice = notice;
      if (usedMemory) assistant.usedMemory = true;
      store.save();
    } else if (failure) {
      showToast(failure);
    } else if (!userAborted) {
      assistant.content = 'Es konnte keine Antwort erzeugt werden. Bitte versuche es erneut.';
      store.addMessage(chatId, assistant);
    }
    renderSidebar();
    if (store.activeId === chatId) {
      renderMessages({ keepScroll: !nearBottom() });
      if (started) maybeAutoPreview(assistant);
    }
  }
}

function stopGeneration() {
  if (!busy) return;
  userAborted = true;
  abortController?.abort();
}

async function regenerate(chatId, message) {
  if (busy) return showToast('Bitte warten — oder mit Esc die Antwort stoppen');
  store.truncateFrom(chatId, message.id);
  renderMessages();
  await runAssistantTurn(chatId);
}

function editMessage(chatId, message) {
  if (busy) return showToast('Bitte warten — oder mit Esc die Antwort stoppen');
  store.truncateFrom(chatId, message.id);
  renderMessages();
  composer.setValue(message.content);
}

// ---------- Code: Vorschau, Download, ZIP ----------
function handleCodeAction(type, { code, lang, file }) {
  if (type === 'copy') { navigator.clipboard?.writeText(code); showToast('Code kopiert'); }
  else if (type === 'download') downloadFile(file || `code.${EXT[lang] || lang || 'txt'}`, code, lang === 'html' ? 'text/html' : 'text/plain');
  else if (type === 'preview') panel.open({ code, lang, file });
  else if (type === 'open') panel.open({ code, lang, file, mode: 'code' });
}

function downloadZip(message) {
  const blocks = extractCodeBlocks(message.content);
  if (!blocks.length) return showToast('Keine Code-Blöcke in dieser Antwort');
  const used = new Set();
  const files = blocks.map((b, i) => {
    let name = b.file || `datei-${i + 1}.${EXT[b.lang] || b.lang || 'txt'}`;
    while (used.has(name)) name = `${i + 1}-${name}`;
    used.add(name);
    return { name, content: b.code };
  });
  downloadFile('aicore-code.zip', new Blob([makeZip(files)], { type: 'application/zip' }));
  showToast(`${files.length} Dateien als ZIP gespeichert`);
}

function maybeAutoPreview(message) {
  if (!settings.autoPreview || window.innerWidth <= 1100) return;
  const blocks = extractCodeBlocks(message.content).filter(b => isPreviewable(b.lang) && b.code.split('\n').length >= 6);
  if (blocks.length) panel.open(blocks[blocks.length - 1]);
}

function togglePanel() {
  if (panel.isOpen()) return panel.close();
  const blocks = (store.getActive()?.messages || []).filter(m => m.role === 'assistant').flatMap(m => extractCodeBlocks(m.content));
  const last = [...blocks].reverse().find(b => isPreviewable(b.lang)) || blocks[blocks.length - 1];
  if (last) panel.open(last); else panel.showEmpty();
}

// ---------- Vorlesen ----------
function speak(message) {
  if (!('speechSynthesis' in window)) return showToast('Vorlesen wird von diesem Browser nicht unterstützt');
  const synth = window.speechSynthesis;
  if (speakingId === message.id) { synth.cancel(); speakingId = null; return renderMessages({ keepScroll: true }); }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(plainText(message.content).slice(0, 5000));
  u.lang = 'de-DE';
  const done = () => { if (speakingId === message.id) { speakingId = null; renderMessages({ keepScroll: true }); } };
  u.onend = done; u.onerror = done;
  speakingId = message.id;
  synth.speak(u);
  renderMessages({ keepScroll: true });
}

// ---------- Erinnerungen ----------
function setMemoryCount(n) { $('memory-count').textContent = n ? String(n) : ''; }
async function refreshMemoryCount() {
  try { const m = await api.memories(); setMemoryCount(m.enabled ? m.items.length : 0); } catch { /* ohne Server egal */ }
}

async function remember(text, { quiet = false } = {}) {
  if (!text) return showToast('Was soll ich mir merken? Zum Beispiel: /merken Ich bin Vegetarier');
  try {
    const item = await api.addMemory(text);
    if (!quiet) showToast(`Gemerkt: ${item.text}`);
    refreshMemoryCount();
    return true;
  } catch (e) {
    showToast(e.status === 409 ? 'Das weiß ich schon.' : e.message);
    return false;
  }
}

async function saveMemoryHint(message) {
  const ok = await remember(message.memoryHint);
  if (ok || ok === false) { message.memoryHint = null; store.save(); renderMessages({ keepScroll: true }); }
}

// ---------- Befehle ----------
function setRoleByName(arg) {
  const roles = allRoles(settings);
  const q = arg.toLowerCase();
  const hit = roles.find(r => r.id === q || r.name.toLowerCase() === q) || roles.find(r => r.name.toLowerCase().startsWith(q) && q);
  if (!hit) return showToast(`Rollen: ${roles.map(r => r.name).join(', ')}`);
  settings.roleId = hit.id;
  storage.saveSettings(settings);
  const chat = store.getActive();
  if (chat) store.setRole(chat.id, hit.id);
  renderMessages({ keepScroll: true });
  showToast(`Rolle: ${hit.name}`);
}

function exportCurrent() {
  const chat = store.getActive();
  if (!chat || !chat.messages.length) return showToast('Dieser Chat ist noch leer');
  exportChatMarkdown(chat);
}

const COMMANDS = [
  { name: 'neu', hint: 'Neuer Chat', run: () => newChat() },
  { name: 'coder', hint: 'Coder-Modus mit Vorschau starten', run: startCoder },
  { name: 'rolle', args: true, hint: 'Rolle wählen, z. B. /rolle coder', run: setRoleByName },
  { name: 'merken', args: true, hint: 'Etwas merken, z. B. /merken Ich bin Vegetarier', run: (a) => remember(a) },
  { name: 'vergessen', hint: 'Erinnerungen ansehen und löschen', run: () => openSettings('memory') },
  { name: 'export', hint: 'Chat als Markdown speichern', run: exportCurrent },
  { name: 'modell', hint: 'Modell auswählen', run: () => modelSelect.focus() },
  { name: 'hilfe', hint: 'Tastenkürzel und Befehle', run: () => openSettings('about') },
];

// ---------- Modelle, Status, Anmeldung ----------
function statusFor(id) {
  const src = sourceOf(id);
  if (!health) return { cls: 'bad', title: 'Server nicht erreichbar' };
  if (!health.models.length && health.status?.ollama?.reachable !== false) return { cls: 'idle', title: 'Demo-Modus — kein Modell eingerichtet' };
  if (src === 'cloud' || src === 'anthropic') return { cls: 'ok', title: 'Cloud-Modell bereit' };
  if (src === 'ollama' || !id) {
    const o = health.status?.ollama;
    if (!o?.enabled) return { cls: 'idle', title: 'Demo-Modus — kein Modell eingerichtet' };
    if (!o.reachable) return { cls: 'bad', title: 'Ollama nicht erreichbar — Demo-Modus' };
    const loaded = health.models.find(m => m.id === id)?.loaded;
    return loaded ? { cls: 'ok', title: 'Bereit — das Modell ist im Speicher' } : { cls: 'idle', title: 'Verbunden — das Modell wird bei der ersten Nachricht geladen' };
  }
  return { cls: 'idle', title: 'Status unbekannt' };
}

function updateStatus() {
  const s = statusFor(currentModel());
  statusDot.className = `status-dot ${s.cls}`;
  statusDot.title = s.title;
}

async function refreshHealth() {
  try { health = await api.health(); }
  catch (e) { health = null; if (!(e instanceof ApiError)) health = null; }
  syncModelSelect();
  updateStatus();
  updateContextMeter();
}

function syncModelSelect() {
  const models = health?.models || [];
  const sig = `${health ? 'h' : 'x'}:${models.map(m => `${m.id}${m.loaded ? '*' : ''}`).join('|')}`;
  if (modelSelect.dataset.sig !== sig) {
    modelSelect.dataset.sig = sig;
    modelSelect.innerHTML = '';
    if (!models.length) {
      modelSelect.innerHTML = `<option value="">${health ? 'Demo-Modus (kein Modell)' : 'Server nicht erreichbar'}</option>`;
    } else {
      const groups = new Map();
      for (const m of models) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push(m); }
      for (const [name, list] of groups) {
        const og = document.createElement('optgroup');
        og.label = name;
        for (const m of list) {
          const o = document.createElement('option');
          o.value = m.id;
          o.textContent = `${m.loaded ? '● ' : ''}${m.label}`;
          og.appendChild(o);
        }
        modelSelect.appendChild(og);
      }
      const saved = settings.model;
      const pick = models.find(m => m.id === saved) || models.find(m => m.id === `ollama/${saved}`) || models.find(m => m.id === health.model) || models[0];
      modelSelect.value = pick.id;
      if (settings.model !== pick.id) { settings.model = pick.id; storage.saveSettings(settings); }
    }
  }
}

let loginShown = false;
function showLogin() {
  if (loginShown) return;
  loginShown = true;
  mountLogin({
    methods: appConfig.methods || { password: true, firebase: null },
    onSuccess: ({ user }) => {
      loginShown = false;
      appConfig.authenticated = true;
      if (user) appConfig.user = user;
      updateUserLabel();
      renderMessages({ keepScroll: true });
      afterLogin();
    },
  });
}

function afterLogin() {
  refreshHealth();
  refreshMemoryCount();
}

window.addEventListener('aicore:unauthorized', () => { appConfig.authenticated = false; showLogin(); });
window.addEventListener('aicore:storage-full', () => showToast('Browser-Speicher voll — sichere und lösche alte Chats (Einstellungen → Daten).'));

async function logout() {
  await api.logout();
  location.reload();
}

function openSettings(tab) {
  Object.assign(settings, storage.getSettings());
  openSettingsModal({
    store, initialTab: tab,
    authRequired: appConfig.authRequired,
    user: appConfig.user,
    onThemeChange: (theme) => document.documentElement.setAttribute('data-theme', theme),
    onRolesChange: () => { Object.assign(settings, storage.getSettings()); renderRoleSelect(); renderMessages({ keepScroll: true }); },
    onSettingsChange: () => { Object.assign(settings, storage.getSettings()); updateUserLabel(); },
    onModelsChange: () => { modelSelect.dataset.sig = ''; refreshHealth(); },
    onDataChange: () => { renderSidebar(); renderMessages(); },
    onMemoryChange: setMemoryCount,
    onLogout: logout,
  });
}

// ---------- Umbenennen ----------
function startRename() {
  const chat = store.getActive();
  if (!chat || !chat.messages.length) return;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  document.getSelection()?.selectAllChildren(titleEl);
  const finish = (saveIt) => {
    titleEl.contentEditable = 'false';
    titleEl.removeEventListener('blur', onBlur);
    titleEl.removeEventListener('keydown', onKey);
    if (saveIt) store.rename(chat.id, titleEl.textContent);
    titleEl.textContent = store.get(chat.id)?.title || chat.title;
    renderSidebar();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  };
  titleEl.addEventListener('blur', onBlur);
  titleEl.addEventListener('keydown', onKey);
}

// ---------- Ereignisse ----------
$('new-chat-btn').addEventListener('click', () => newChat());
$('coder-btn').addEventListener('click', startCoder);
$('sidebar-collapse').addEventListener('click', () => appEl.classList.add('sidebar-collapsed'));
$('sidebar-expand').addEventListener('click', () => appEl.classList.remove('sidebar-collapsed'));
$('drawer-toggle').addEventListener('click', () => appEl.classList.toggle('drawer-open'));
$('drawer-overlay').addEventListener('click', closeDrawer);
$('panel-toggle').addEventListener('click', togglePanel);
$('export-btn').addEventListener('click', exportCurrent);
$('settings-btn').addEventListener('click', () => openSettings());
$('memory-btn').addEventListener('click', () => openSettings('memory'));
$('ctx-meter').addEventListener('click', () => showToast($('ctx-meter').title));
searchInput.addEventListener('input', renderSidebar);
titleEl.addEventListener('dblclick', startRename);

$('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  settings.theme = next;
  storage.saveSettings(settings);
});

let previousModel = '';
modelSelect.addEventListener('focus', () => { previousModel = modelSelect.value; });
modelSelect.addEventListener('change', () => {
  if (!ensureCloudAck(modelSelect.value)) { modelSelect.value = previousModel; return; }
  settings.model = modelSelect.value;
  storage.saveSettings(settings);
  if (sourceOf(modelSelect.value) === 'ollama') api.warmup(modelSelect.value);
  updateStatus();
  updateContextMeter();
});

roleSelect.addEventListener('change', () => {
  const chat = store.getActive();
  settings.roleId = roleSelect.value;
  storage.saveSettings(settings);
  if (chat) store.setRole(chat.id, roleSelect.value);
  if (!chat || !chat.messages.length) renderMessages({ keepScroll: true });
});

$('attach-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => { fileManager.addFiles(e.target.files); e.target.value = ''; });

const composerWrap = document.querySelector('.composer-wrap');
['dragover', 'dragenter'].forEach(evt => composerWrap.addEventListener(evt, (e) => { e.preventDefault(); composerWrap.style.opacity = '0.85'; }));
['dragleave', 'drop'].forEach(evt => composerWrap.addEventListener(evt, (e) => { e.preventDefault(); composerWrap.style.opacity = '1'; }));
composerWrap.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) fileManager.addFiles(e.dataTransfer.files); });
composerInput.addEventListener('paste', (e) => {
  const files = e.clipboardData?.files;
  if (files?.length) { e.preventDefault(); fileManager.addFiles(files); }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
    if (busy) stopGeneration();
    else if (panel.isOpen()) panel.close();
  }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); appEl.classList.remove('sidebar-collapsed'); searchInput.focus(); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
  if (e.key === '?' && !typing && !document.querySelector('.modal-backdrop')) { e.preventDefault(); openSettings('about'); }
});

const composer = initComposer({ textarea: composerInput, sendBtn: $('send-btn'), form: $('composer-form'), onSubmit: handleSubmit, onStop: stopGeneration });
createSlashMenu({
  textarea: composerInput, menu: $('slash-menu'), commands: COMMANDS,
  onPick: (c) => { if (c.args) composer.setValue(`/${c.name} `); else { composer.setValue(''); c.run(''); } },
});

// ---------- Start ----------
updateUserLabel();
renderSidebar();
renderMessages();
syncModelSelect();

function applyConfig(cfg) {
  appConfig = cfg;
  updateUserLabel();
  renderMessages({ keepScroll: true });
  if (appConfig.authRequired && !appConfig.authenticated) showLogin();
  else afterLogin();
}
window.addEventListener('aicore:reconnected', (e) => applyConfig(e.detail));

(async function boot() {
  try {
    applyConfig(await api.config());
  } catch (e) {
    health = null;
    syncModelSelect();
    updateStatus();
    // Seite liegt außerhalb (GitHub): klare Meldung mit Adressfeld statt stillem Demo-Modus.
    if (isCrossOrigin()) mountConnect({ error: e?.message || 'Der Server ist nicht erreichbar.', onConnected: applyConfig });
  }
  setInterval(() => { if (!document.hidden && appConfig.authenticated) refreshHealth(); }, 30000);
})();
