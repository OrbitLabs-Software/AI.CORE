// sharedView.js — geteilten Chat (Link mit #share=…) schreibgeschützt anzeigen.
import { api } from './api.js';
import { renderMessageEl } from '../components/chatMessage.js';
import { escapeHtml, showToast } from './ui.js';

export const shareIdFromHash = () => /^#share=([a-f0-9]{32})$/.exec(location.hash)?.[1] || null;

/** Zeigt den Chat; löst auf, sobald die Ansicht geschlossen wird. onImport(data) kopiert ihn in die eigenen Chats. */
export async function showShared(id, { onImport }) {
  let data;
  try { data = await api.getShare(id); }
  catch (e) { showToast(e?.network ? 'Der Server ist nicht erreichbar — geteilter Chat kann nicht geladen werden.' : (e.message || 'Link ungültig')); return; }
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sv-overlay';
    el.innerHTML = `<header class="sv-head"><div><b>${escapeHtml(data.title)}</b><small>Geteilter Chat · nur lesen</small></div>
      <div class="sv-actions"><button class="btn primary" data-import><b>In meine Chats kopieren</b></button><button class="btn" data-close>Zur App</button></div></header>
      <div class="sv-scroll"><div class="sv-list"></div></div>`;
    const list = el.querySelector('.sv-list');
    data.messages.forEach((m, i) => {
      const node = renderMessageEl({ id: `s${i}`, ...m, attachments: (m.files || []).map(name => ({ name })) }, { readonly: true });
      node.querySelectorAll('.message-actions, .message-stats').forEach(x => x.remove());
      list.appendChild(node);
    });
    const done = () => { el.remove(); resolve(); };
    el.querySelector('[data-close]').addEventListener('click', done);
    el.querySelector('[data-import]').addEventListener('click', () => { onImport(data); showToast('Chat kopiert'); done(); });
    document.body.appendChild(el);
  });
}
