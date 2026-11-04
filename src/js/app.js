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
import { STYLES, buildSystem } from './styles.js';
import { createProjectStore, openProjectDialog } from './projects.js';
import { bundleHtml } from './bundle.js';
import { shareIdFromHash, showShared } from './sharedView.js';
import { buildSearchContext } from './websearch.js';
import { runJs } from './runner.js';
import { openTemplateDialog, insertTemplate } from './templates.js';

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
  files: [
    { icon: '📊', title: 'Excel-Tabelle', sub: 'Mit Summen und Formeln', prompt: 'Erstelle eine Excel-Tabelle für ' },
    { icon: '📽️', title: 'Präsentation', sub: 'PowerPoint mit Titelfolie', prompt: 'Erstelle eine Präsentation mit 6 Folien über ' },
    { icon: '📝', title: 'Word oder PDF', sub: 'Brief, Bericht, Anleitung', prompt: 'Schreibe als Word-Dokument: ' },
    { icon: '🗂️', title: 'ZIP mit Dateien', sub: 'Mehrere Dateien in einem Paket', prompt: 'Erstelle ein ZIP mit den Dateien für ' },
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
function renderProjects() {
  const q = searchInput.value.trim();
  $('projects-section').hidden = q !== '';
  const list = $('projects-list');
  list.innerHTML = '';
  const all = projects.all();
  if (!all.length) list.innerHTML = '<div class="chat-item-empty">Noch keine Projekte</div>';
  for (const p of all) {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.tabIndex = 0; item.setAttribute('role', 'button');
    item.innerHTML = `<span class="chat-item-label" title="${p.name.replace(/"/g, '&quot;')}">📁 ${p.name.replace(/[<>&]/g, '')}</span>`;
    const open = () => openProject(p.id);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    list.appendChild(item);
  }
}

function openProject(id) {
  const project = projects.get(id);
  if (!project) return;
  openProjectDialog({
    project,
    chats: store.all().filter(c => c.projectId === id),
    onChange: (patch) => { projects.update(id, patch); renderProjects(); },
    onNewChat: () => { newChat(); const c = store.getActive(); c.projectId = id; store.save(); renderSidebar(); renderMessages(); },
    onOpenChat: selectChat,
    onDelete: () => { projects.remove(id); renderProjects(); renderMessages(); },
  });
}

$('new-project-btn').addEventListener('click', () => {
  const name = prompt('Name des Projekts:');
  if (name?.trim()) { const p = projects.create(name); renderProjects(); openProject(p.id); }
});

function renderSidebar() {
  renderProjects();
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
    : roleId === 'files'
      ? 'Sag, welche Datei du brauchst. Unter der Antwort erscheint ein Knopf, der sie erzeugt.'
      : 'Stelle eine Frage, hänge eine Datei an oder wähle einen Vorschlag.';
  const box = $('suggestion-cards');
  box.innerHTML = '';
  for (const s of SUGGESTIONS[SUGGESTIONS[roleId] ? roleId : 'default']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggestion-card';
    b.innerHTML = `<span class="sc-icon" aria-hidden="true">${s.icon}</span><span><span class="sc-title">${escapeHtml(s.title)}</span><span class="sc-sub">${escapeHtml(s.sub)}</span></span>`;
    b.addEventListener('click', () => composer.setValue(s.prompt));
    box.appendChild(b);
  }
}

const projects = createProjectStore();

function messageHandlers(chat) {
  return {
    speakingId,
    onCopy: (m) => { navigator.clipboard?.writeText(m.content); showToast('Nachricht kopiert'); },
    onRegenerate: (m) => regenerate(chat.id, m),
    onEdit: (m) => editMessage(chat.id, m),
    onSpeak: speak,
    onFeedback: (m, v) => { m.feedback = m.feedback === v ? null : v; store.save(); renderMessages({ keepScroll: true }); },
    onZip: downloadZip,
    onExport: (m, fmt) => exportAnswer(m, fmt, chat),
    onVersion: (m, d) => {
      const i = (m.vIdx ?? m.versions.length - 1) + d, v = m.versions[i];
      if (!v) return;
      m.content = v.content; m.stats = v.stats; m.vIdx = i;
      store.save(); renderMessages({ keepScroll: true });
    },
    videoUrl: (id) => { ensureVideoUrl(id); return videoUrls.get(id); },
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
    titleEl.textContent = (chat?.title && chat.title !== 'Neuer Chat' ? chat.title : (roleId === 'coder' ? 'Coder' : 'Neuer Chat'));
    if (projects.get(chat?.projectId)) $('welcome-sub').textContent = `Projekt „${projects.get(chat.projectId).name}“ — Anweisungen und Dateien gelten in diesem Chat.`;
    updateContextMeter();
    return;
  }
  welcomeScreen.hidden = true;
  messageList.hidden = false;
  titleEl.textContent = (projects.get(chat.projectId) ? '📁 ' : '') + chat.title;
  const handlers = messageHandlers(chat);
  if (chat.summary?.text) {
    const note = document.createElement('div');
    note.className = 'summary-note';
    note.innerHTML = '<b>Frühere Nachrichten wurden zusammengefasst</b><details><summary>Zusammenfassung anzeigen</summary><pre></pre></details>';
    note.querySelector('pre').textContent = chat.summary.text;
    messageList.appendChild(note);
  }
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

function startFiles(args) {
  newChat('files');
  showToast('Dateien-Modus: Excel, PowerPoint, Word, PDF, ZIP …');
  if (args) handleSubmit(args);
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
  const lastIdx = chat.messages.filter(m => !m.media).length - 1;
  return chat.messages.filter(m => !m.media).map((m, i, arr) => ({
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

let searchAck = false;
/** Platz für Systemprompt-Zusätze (Suche, Projektdateien) in Zeichen, nach dem Kontextfenster des Modells. */
const ctxChars = () => Math.max(2500, Math.min(20000, Math.round((health?.limits?.numCtx || 8192) * 1.5)));
const userTexts = (chat) => chat.messages.filter(m => m.role === 'user' && !m.media).map(m => m.content);
const lastUserText = (chat) => (userTexts(chat).at(-1) || '').replace(/\s+/g, ' ').trim();
const recentUserText = (chat) => userTexts(chat).slice(-2).join(' ');

async function runAssistantTurn(chatId, carry = null) {
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
    let searchCtx = null;
    const q = lastUserText(chat);
    if ((settings.search || 'off') !== 'off' && appConfig.features?.search !== false && q.length >= 4) {
      if (searchAck || confirm('Deine Frage wird für die Suche an einen Suchanbieter im Internet geschickt. Fortfahren?')) {
        searchAck = true;
        try { searchCtx = buildSearchContext((await api.search(q.slice(0, 200), settings.search === 'deep')).results, Math.round(ctxChars() * 0.5)); }
        catch (e) { showToast(e.message || 'Die Websuche hat nicht geklappt'); }
      }
    }
    if (searchCtx) assistant.sources = searchCtx.sources;
    const stream = api.streamChat({
      messages: buildHistory(chat),
      model: currentModel(),
      system: buildSystem(role.prompt, settings, projects.get(chat.projectId), { query: recentUserText(chat), budget: ctxChars(), search: searchCtx?.block, summary: chat.summary?.text }),
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

    window.dispatchEvent(new CustomEvent('aicore:turn-done', { detail: { text: started ? assistant.content : '' } }));
    const restoreVersions = () => {   // Abbruch oder Fehler beim Neu-Generieren: die alte Antwort bleibt erhalten
      if (!carry) return;
      const last = carry[carry.length - 1];
      store.addMessage(chatId, { id: uid(), role: 'assistant', content: last.content, stats: last.stats, versions: carry, vIdx: carry.length - 1, createdAt: Date.now() });
    };
    if (started) {
      if (carry) { assistant.versions = [...carry, { content: assistant.content, stats: null }]; assistant.vIdx = assistant.versions.length - 1; }
      if (stats) assistant.stats = { ...stats, seconds: Math.round((Date.now() - startedAt) / 100) / 10 };
      if (notice) assistant.notice = notice;
      if (usedMemory) assistant.usedMemory = true;
      if (assistant.versions) assistant.versions[assistant.vIdx].stats = assistant.stats || null;
      store.save();
    } else if (failure) {
      showToast(failure); restoreVersions();
    } else if (userAborted) {
      restoreVersions();
    } else {
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
  const carry = message.versions?.length ? message.versions : [{ content: message.content, stats: message.stats }];
  store.truncateFrom(chatId, message.id);
  renderMessages();
  await runAssistantTurn(chatId, carry);
}

function editMessage(chatId, message) {
  if (busy) return showToast('Bitte warten — oder mit Esc die Antwort stoppen');
  store.truncateFrom(chatId, message.id);
  renderMessages();
  composer.setValue(message.content);
}

// ---------- Code: Vorschau, Download, ZIP ----------
/** HTML mit zugehörigen CSS/JS-Blöcken derselben Antwort zu einer Vorschau-Seite bündeln. */
function withBundle(block, message) {
  if (block.lang !== 'html' || !message) return block;
  const siblings = extractCodeBlocks(message.content).filter(b => b.code !== block.code);
  const r = bundleHtml(block.code, siblings);
  if (r.missing.length) showToast(`In der Vorschau fehlen: ${[...new Set(r.missing)].join(', ')}`);
  return r.inlined.length ? { ...block, previewCode: r.html } : block;
}

async function saveFile(run) {
  try {
    const r = await run();
    if (r) showToast(`Gespeichert: ${r.name || r}`);
  } catch (e) { showToast(`Datei konnte nicht erstellt werden: ${e.message}`); }
}

function handleCodeAction(type, block, btn, message) {
  const { code, lang, file } = block;
  if (type === 'copy') { navigator.clipboard?.writeText(code); showToast('Code kopiert'); }
  else if (type === 'download') saveFile(async () => (await import('./formats.js')).saveBlock(block));
  else if (type === 'export') saveFile(async () => (await import('./formats.js')).saveBlock(block, btn?.dataset.fmt));
  else if (type === 'preview') panel.open(withBundle(block, message));
  else if (type === 'open') panel.open({ code, lang, file, mode: 'code' });
  else if (type === 'run') runCodeBlock(code, btn);
}

async function runCodeBlock(code, btn) {
  const block = btn.closest('.code-block') || btn.closest('pre')?.parentElement;
  if (!block) return;
  block.nextElementSibling?.classList.contains('run-out') && block.nextElementSibling.remove();
  const out = document.createElement('div');
  out.className = 'run-out';
  out.innerHTML = '<div class="run-head"><span>Ausgabe</span><small>läuft …</small></div><pre></pre>';
  block.after(out);
  btn.disabled = true;
  try {
    const r = await runJs(code);
    const pre = out.querySelector('pre');
    if (!r.logs.length) pre.textContent = '(keine Ausgabe, nutze console.log)';
    for (const l of r.logs) {
      const line = document.createElement('div');
      line.className = `run-${l.type}`;
      line.textContent = l.text;
      pre.appendChild(line);
    }
    out.querySelector('small').textContent = r.timedOut ? 'nach 8 Sekunden abgebrochen' : `fertig in ${r.ms} ms`;
  } catch (e) { out.querySelector('pre').textContent = e.message || 'Ausführen fehlgeschlagen'; out.querySelector('small').textContent = ''; }
  finally { btn.disabled = false; }
}

function exportAnswer(message, fmt, chat) {
  saveFile(async () => {
    const { exportMessage } = await import('./formats.js');
    const r = exportMessage(message.content, fmt, chat?.title || 'antwort');
    if (!r) throw new Error('Format nicht verfügbar');
    downloadFile(r.name, r.blob);
    return r;
  });
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
  if (blocks.length) panel.open(withBundle(blocks[blocks.length - 1], message));
}

function togglePanel() {
  if (panel.isOpen()) return panel.close();
  const blocks = (store.getActive()?.messages || []).filter(m => m.role === 'assistant').flatMap(m => extractCodeBlocks(m.content));
  const last = [...blocks].reverse().find(b => isPreviewable(b.lang)) || blocks[blocks.length - 1];
  const owner = (store.getActive()?.messages || []).filter(m => m.role === 'assistant').reverse().find(m => last && m.content.includes(last.code));
  if (last) panel.open(withBundle(last, owner)); else panel.showEmpty();
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

// ---------- Modell ohne Chat-Anzeige fragen (für Zusammenfassungen) ----------
async function askModel(prompt, system) {
  let text = '';
  for await (const ev of api.streamChat({ messages: [{ role: 'user', content: prompt }], model: currentModel(), system, temperature: 0.2, memory: false, signal: abortController?.signal })) {
    if (ev.delta) text += ev.delta;
  }
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

/** Älteren Verlauf zusammenfassen und aus dem Chat nehmen; die Zusammenfassung geht in jede weitere Anfrage. */
async function compressChat() {
  const chat = store.getActive();
  if (!chat) return showToast('Es gibt noch keinen Chat.');
  if (busy) return showToast('Bitte warten, die KI antwortet gerade.');
  const msgs = chat.messages.filter(m => !m.media);
  if (msgs.length < 6) return showToast('Der Chat ist noch kurz genug.');
  let keep = 4;
  while (keep < msgs.length && msgs[msgs.length - keep].role !== 'user') keep++;
  const old = msgs.slice(0, msgs.length - keep);
  if (old.length < 2) return showToast('Der Chat ist noch kurz genug.');
  const transcript = [chat.summary?.text && `Bisherige Zusammenfassung:\n${chat.summary.text}`,
    ...old.map(m => `${m.role === 'user' ? 'Nutzer' : 'KI'}: ${m.content.replace(/<think>[\s\S]*?<\/think>/g, '').slice(0, 1500)}`)].filter(Boolean).join('\n\n').slice(-9000);
  busy = true; composer.setBusy(true); typingIndicator.hidden = false;
  abortController = new AbortController();
  try {
    const text = await askModel(`Fasse das folgende Gespräch in höchstens 8 Stichpunkten zusammen. Behalte Fakten, Entscheidungen, Namen, Zahlen und offene Fragen. Keine Einleitung.\n\n${transcript}`, 'Du fasst Gespräche knapp und genau auf Deutsch zusammen.');
    if (text.length < 20) throw new Error('Die Zusammenfassung war leer.');
    chat.summary = { text: text.slice(0, 3000) };
    chat.messages = chat.messages.filter(m => !old.includes(m));
    store.save();
    showToast(`${old.length} ältere Nachrichten zusammengefasst`);
  } catch (e) { if (e.name !== 'AbortError') showToast(e.message || 'Zusammenfassen hat nicht geklappt'); }
  finally { busy = false; composer.setBusy(false); typingIndicator.hidden = true; renderSidebar(); renderMessages(); }
}

// ---------- Vorlagen ----------
function openTemplates() {
  openTemplateDialog({
    settings, saveSettings: () => storage.saveSettings(settings), currentText: () => composerInput.value,
    onUse: (text) => { insertTemplate(composerInput, (v) => composer.setValue(v), text); },
  });
}

// ---------- Websuche-Schalter ----------
const searchSelect = $('search-select');
searchSelect.value = settings.search || 'off';
searchSelect.addEventListener('change', () => {
  settings.search = searchSelect.value; storage.saveSettings(settings);
  if (settings.search !== 'off') showToast(settings.search === 'deep' ? 'Tiefe Recherche: die ersten Seiten werden gelesen (dauert länger).' : 'Websuche an: die Frage geht an einen Suchanbieter.');
});

// ---------- Sprachmodus ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceBtn = $('voice-btn');
let voice = null;
if (SpeechRec && 'speechSynthesis' in window) { voiceBtn.hidden = false; voiceBtn.addEventListener('click', () => startVoice()); }

function spokenText(content) {
  return content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/```[\s\S]*?```/g, ' Den Code siehst du auf dem Bildschirm. ')
    .replace(/\[(\d+)\]/g, '').replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1800);
}

function startVoice() {
  if (voice) return stopVoice();
  if (!SpeechRec || !('speechSynthesis' in window)) return showToast('Dein Browser kann keine Sprache. Chrome, Edge oder Safari gehen.');
  if (busy) return showToast('Bitte warten, die KI antwortet gerade.');
  const el = document.createElement('div');
  el.className = 'vm-overlay';
  el.innerHTML = '<div class="vm-orb" aria-hidden="true"></div><p class="vm-state" aria-live="polite"></p><p class="vm-text"></p><button type="button" class="btn">Beenden</button>';
  document.body.appendChild(el);
  voice = { el, rec: null, silent: 0, active: true };
  el.querySelector('button').addEventListener('click', stopVoice);
  voiceListen();
}

function voiceState(state, text = '') {
  if (!voice) return;
  voice.el.dataset.state = state;
  voice.el.querySelector('.vm-state').textContent = { listen: 'Ich höre zu …', think: 'Ich denke nach …', speak: 'Ich spreche …' }[state] || '';
  voice.el.querySelector('.vm-text').textContent = text;
}

function voiceListen() {
  if (!voice?.active) return;
  const rec = new SpeechRec();
  voice.rec = rec;
  rec.lang = 'de-AT'; rec.interimResults = true; rec.continuous = false;
  let heard = '';
  voiceState('listen');
  rec.onresult = (e) => { heard = [...e.results].map(r => r[0].transcript).join(''); voiceState('listen', heard); };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { showToast('Mikrofon nicht erlaubt'); stopVoice(); } };
  rec.onend = async () => {
    if (!voice?.active || voice.rec !== rec) return;
    if (heard.trim().length < 2) { if (++voice.silent >= 3) { showToast('Ich habe nichts gehört. Sprachmodus beendet.'); return stopVoice(); } return voiceListen(); }
    voice.silent = 0;
    voiceState('think', heard);
    const done = new Promise(res => window.addEventListener('aicore:turn-done', (ev) => res(ev.detail.text), { once: true }));
    await sendMessage(heard.trim());
    const reply = await Promise.race([done, sleep(180000).then(() => '')]);
    if (!voice?.active) return;
    const text = spokenText(reply || '');
    if (!text) return voiceListen();
    voiceState('speak', text.slice(0, 160));
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-AT';
    u.onend = u.onerror = () => voiceListen();
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  try { rec.start(); } catch { stopVoice(); }
}

function stopVoice() {
  if (!voice) return;
  voice.active = false;
  try { voice.rec?.abort(); } catch { /* egal */ }
  speechSynthesis.cancel();
  voice.el.remove();
  voice = null;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && voice) stopVoice(); });

// ---------- Bilder, Videos, Teilen ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const videoUrls = new Map(), videoLoading = new Set(), videoTracking = new Set();
let mediaAck = false;

function shrinkImage(src, max = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(src.length < 1_500_000 ? src : null);
    img.src = src;
  });
}

async function ensureVideoUrl(id) {
  if (videoUrls.has(id) || videoLoading.has(id)) return;
  videoLoading.add(id);
  try { videoUrls.set(id, await api.videoBlobUrl(id)); renderMessages({ keepScroll: true }); }
  catch { /* Datei fehlt: bleibt beim Wartezustand */ }
  finally { videoLoading.delete(id); }
}

async function trackVideo(chatId, msg) {
  const v = msg.video;
  if (!v || v.state !== 'working' || videoTracking.has(v.id)) return;
  videoTracking.add(v.id);
  let errors = 0;
  try {
    while (v.state === 'working') {
      await sleep(5000);
      try {
        const s = await api.videoStatus(v.id);
        errors = 0;
        v.progress = s.progress || v.progress;
        if (s.status === 'failed') { v.state = 'failed'; v.error = s.error; }
        if (s.status === 'done') v.state = 'done';
      } catch (e) { if (e.status === 401 || ++errors >= 6) { if (e.status !== 401) { v.state = 'failed'; v.error = e.message; } break; } }
      store.save();
      if (store.activeId === chatId) renderMessages({ keepScroll: true });
    }
  } finally { videoTracking.delete(v.id); store.save(); if (store.activeId === chatId) renderMessages({ keepScroll: true }); }
}

function resumeVideos() {
  for (const c of store.raw()) for (const m of c.messages) if (m.video?.state === 'working') trackVideo(c.id, m);
}

async function makeMedia(kind, prompt) {
  const word = kind === 'image' ? 'Bild' : 'Video';
  if (!prompt) return showToast(`Beschreibe das ${word}, z. B. /${word.toLowerCase()} ein Fuchs im Schnee`);
  if (busy) return showToast('Bitte warten — oder mit Esc stoppen');
  const chat = store.getActive() || store.createChat(settings.roleId !== 'default' ? settings.roleId : null);
  const say = (content, extra = {}) => { store.addMessage(chat.id, { id: uid(), role: 'assistant', media: true, content, createdAt: Date.now(), ...extra }); };
  store.addMessage(chat.id, { id: uid(), role: 'user', media: true, content: `/${word.toLowerCase()} ${prompt}`, createdAt: Date.now() });
  const finish = () => { busy = false; composer.setBusy(false); typingIndicator.hidden = true; renderSidebar(); renderMessages(); };
  if (!appConfig.features?.[kind]) {
    say(`${kind === 'image' ? 'Die Bilderzeugung' : 'Die Videoerstellung'} ist noch nicht eingerichtet. Der Tiny hat keine Grafikkarte, deshalb läuft das über einen Anbieter: Trage in der .env auf dem Server ${kind === 'image' ? 'IMAGE_API_KEY' : 'VIDEO_API_KEY'} ein (siehe README) und starte den Dienst neu.`);
    return finish();
  }
  if (!mediaAck && !confirm(`Deine Beschreibung wird an den ${word}-Anbieter geschickt (Internet). Fortfahren?`)) { store.removeMessage(chat.id, chat.messages.at(-1).id); return finish(); }
  mediaAck = true;
  busy = true; composer.setBusy(true); typingIndicator.hidden = false; renderMessages();
  try {
    if (kind === 'image') {
      const img = await shrinkImage(await api.image(prompt));
      if (!img) throw new Error('Das Bild konnte nicht verarbeitet werden');
      say('Hier ist dein Bild.', { images: [img] });
    } else {
      const id = await api.videoStart(prompt);
      const msg = { id: uid(), role: 'assistant', media: true, content: 'Ich erzeuge dein Video …', video: { id, state: 'working', progress: 0 }, createdAt: Date.now() };
      store.addMessage(chat.id, msg);
      trackVideo(chat.id, msg);
    }
  } catch (e) { if (!(e instanceof ApiError && e.status === 401)) say(e.status === 402 || e.status === 503 ? e.message : `Das hat nicht geklappt: ${e.message}`); }
  finish();
}

async function shareCurrent() {
  const chat = store.getActive();
  if (!chat?.messages.some(m => !m.media)) return showToast('Nichts zu teilen — der Chat ist leer');
  if (appConfig.features && !appConfig.features.share) return showToast('Teilen ist auf dem Server abgeschaltet');
  if (!confirm('Eine Nur-Lesen-Kopie dieses Chats auf deinem Server ablegen und einen Link erzeugen? Wer den Link hat, kann sie lesen (Dateiinhalte und Bilder werden nicht geteilt).')) return;
  try {
    const id = await api.share(chat);
    chat.shared = id; store.save();
    const link = `${location.origin}${location.pathname}#share=${id}`;
    try { await navigator.clipboard.writeText(link); showToast('Link kopiert — er funktioniert für alle, die deinen Server erreichen'); }
    catch { prompt('Link zum Teilen (nur für Geräte, die deinen Server erreichen):', link); }
  } catch (e) { showToast(e.message || 'Teilen fehlgeschlagen'); }
}

async function unshareCurrent() {
  const chat = store.getActive();
  if (!chat?.shared) return showToast('Dieser Chat ist nicht geteilt');
  await api.unshare(chat.shared).catch(() => {});
  chat.shared = null; store.save();
  showToast('Teilen beendet — der Link funktioniert nicht mehr');
}

function importShared(data) {
  const id = uid(), now = Date.now();
  store.importChats([{ id, title: data.title, favorite: false, roleId: null, createdAt: now, updatedAt: now, messages: data.messages.map(m => ({ id: uid(), role: m.role, content: m.content, createdAt: now })) }]);
  store.setActive(id);
  renderSidebar(); renderMessages();
}

$('share-btn').addEventListener('click', shareCurrent);

const COMMANDS = [
  { name: 'vorlage', hint: 'Vorlagen für häufige Aufgaben', run: openTemplates },
  { name: 'komprimieren', hint: 'Älteren Verlauf zusammenfassen, damit der Chat weiterläuft', run: compressChat },
  { name: 'sprache', hint: 'Sprachmodus: sprechen und zuhören', run: () => startVoice() },
  { name: 'bild', args: true, hint: 'Bild erzeugen, z. B. /bild ein Fuchs im Schnee', run: (a) => makeMedia('image', a) },
  { name: 'video', args: true, hint: 'Video erzeugen, z. B. /video Wellen am Strand', run: (a) => makeMedia('video', a) },
  { name: 'teilen', hint: 'Chat als Nur-Lesen-Link teilen', run: shareCurrent },
  { name: 'teilenaus', hint: 'Teilen dieses Chats beenden', run: unshareCurrent },
  { name: 'neu', hint: 'Neuer Chat', run: () => newChat() },
  { name: 'coder', hint: 'Coder-Modus mit Vorschau starten', run: startCoder },
  { name: 'datei', args: true, hint: 'Dateien erstellen, z. B. /datei Excel mit Haushaltsbudget', run: startFiles },
  { name: 'rolle', args: true, hint: 'Rolle wählen, z. B. /rolle coder', run: setRoleByName },
  { name: 'merken', args: true, hint: 'Etwas merken, z. B. /merken Ich bin Vegetarier', run: (a) => remember(a) },
  { name: 'vergessen', hint: 'Erinnerungen ansehen und löschen', run: () => openSettings('memory') },
  { name: 'export', hint: 'Chat als Markdown speichern', run: exportCurrent },
  { name: 'modell', hint: 'Modell auswählen', run: () => modelSelect.focus() },
  { name: 'pro', hint: 'AI Core Pro: Kontingent und Kauf', run: () => openSettings('pro') },
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
  confirmProReturn();
  resumeVideos();
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

// ---------- Stil und Diktieren ----------
const styleSelect = $('style-select');
for (const s of STYLES) styleSelect.appendChild(Object.assign(document.createElement('option'), { value: s.id, textContent: s.name }));
styleSelect.value = settings.style || 'normal';
styleSelect.addEventListener('change', () => { settings.style = styleSelect.value; storage.saveSettings(settings); });

const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('mic-btn');
if (Speech) {
  micBtn.hidden = false;
  let rec = null, base = '';
  micBtn.addEventListener('click', () => {
    if (rec) return rec.stop();
    rec = new Speech();
    rec.lang = 'de-AT'; rec.interimResults = true; rec.continuous = true;
    base = composerInput.value ? composerInput.value.replace(/\s*$/, ' ') : '';
    rec.onresult = (e) => { composer.setValue(base + [...e.results].map(r => r[0].transcript).join('')); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') showToast('Mikrofon nicht erlaubt'); };
    rec.onend = () => { rec = null; micBtn.classList.remove('on'); composerInput.focus(); };
    micBtn.classList.add('on');
    rec.start();
  });
}

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

// Rückkehr vom Bezahlen (Stripe): #pro=success&session_id=… wird nach der Anmeldung bestätigt
const proReturn = /^#pro=success&session_id=(cs_[A-Za-z0-9_]+)$/.exec(location.hash)?.[1] || null;
if (proReturn || location.hash === '#pro=cancel') {
  if (!proReturn) showToast('Kauf abgebrochen — es wurde nichts berechnet.');
  history.replaceState(null, '', location.pathname + location.search);
}
function confirmProReturn() {
  if (!proReturn) return;
  api.proConfirm(proReturn).then(() => { showToast('AI Core Pro ist aktiv. Danke!'); openSettings('pro'); }).catch(e => showToast(e.message || 'Zahlung konnte nicht bestätigt werden'));
}

(async function boot() {
  const sid = shareIdFromHash();
  if (sid) {
    await showShared(sid, { onImport: importShared });
    history.replaceState(null, '', location.pathname + location.search);
  }
  try {
    applyConfig(await api.config());
  } catch (e) {
    health = null;
    syncModelSelect();
    updateStatus();
    // Seite liegt außerhalb (GitHub): klare Meldung mit Adressfeld statt stillem Demo-Modus.
    if (e?.network) mountConnect({ error: e?.message || 'Der Server ist nicht erreichbar.', onConnected: applyConfig });
  }
  setInterval(() => { if (!document.hidden && appConfig.authenticated) refreshHealth(); }, 30000);
})();
