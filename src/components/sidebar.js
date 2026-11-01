import { escapeHtml, dateGroup } from '../js/ui.js';

function chatItem(chat, { activeId, onSelect, onDelete, onToggleFavorite }) {
  const el = document.createElement('div');
  el.className = `chat-item${chat.id === activeId ? ' active' : ''}`;
  el.dataset.id = chat.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.innerHTML = `
    <span class="chat-item-label" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
    <button class="mini-btn" data-act="fav" title="${chat.favorite ? 'Nicht mehr anpinnen' : 'Anpinnen'}" aria-label="Anpinnen">${chat.favorite ? '★' : '☆'}</button>
    <button class="mini-btn" data-act="del" title="Chat löschen" aria-label="Chat löschen">✕</button>`;
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') { e.stopPropagation(); onToggleFavorite(chat.id); }
    else if (act === 'del') { e.stopPropagation(); if (confirm(`Chat „${chat.title}“ löschen?`)) onDelete(chat.id); }
    else onSelect(chat.id);
  });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); onSelect(chat.id); } });
  return el;
}

/** Flache Liste (Angepinnt, Suchergebnisse). */
export function renderChatList(container, chats, handlers) {
  container.innerHTML = '';
  if (!chats.length) {
    if (handlers.emptyText) container.innerHTML = `<div class="chat-item-empty">${escapeHtml(handlers.emptyText)}</div>`;
    return;
  }
  for (const c of chats) container.appendChild(chatItem(c, handlers));
}

/** Nach Datum gruppiert: Heute, Gestern, Letzte 7 Tage … */
export function renderGroupedChats(container, chats, handlers) {
  container.innerHTML = '';
  if (!chats.length) {
    container.innerHTML = `<div class="chat-item-empty">${escapeHtml(handlers.emptyText || 'Noch keine Chats')}</div>`;
    return;
  }
  const groups = new Map();
  for (const c of chats) {
    const g = dateGroup(c.updatedAt || c.createdAt);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  for (const [title, list] of groups) {
    const head = document.createElement('div');
    head.className = 'sidebar-section-title';
    head.textContent = title;
    const body = document.createElement('div');
    body.className = 'chat-list';
    for (const c of list) body.appendChild(chatItem(c, handlers));
    container.append(head, body);
  }
}
