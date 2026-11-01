import { renderMarkdown, escapeHtml, extractCodeBlocks } from '../js/ui.js';

const I = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  redo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9A9 9 0 0 1 20 6.3M20.5 15A9 9 0 0 1 4 17.7"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  speak: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  zip: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/></svg>',
};

function statsLine(m) {
  const s = m.stats;
  const parts = [];
  if (s?.tps) parts.push(`${s.tps} Tokens/s`);
  if (s?.tokens) parts.push(`${s.tokens} Tokens`);
  if (s?.seconds) parts.push(`${s.seconds} s`);
  if (s?.model) parts.push(escapeHtml(s.model));
  if (m.usedMemory) parts.push('Erinnerungen genutzt');
  return parts.length ? `<div class="message-stats">${parts.join(' · ')}</div>` : '';
}

function filesRow(attachments) {
  if (!attachments?.length) return '';
  return `<div class="message-files">${attachments.map(a => a.preview
    ? `<span class="file-chip"><img src="${a.preview}" alt=""><span class="fc-name">${escapeHtml(a.name)}</span></span>`
    : `<span class="file-chip" ${a.text ? '' : 'title="Kein Text gelesen — die KI sieht nur den Dateinamen"'}>📄 <span class="fc-name">${escapeHtml(a.name)}</span>${a.text ? '' : '<span class="fc-warn">⚠</span>'}</span>`).join('')}</div>`;
}

const btn = (act, icon, label, title = label, cls = '') => `<button type="button" data-act="${act}" title="${title}" class="${cls}">${icon} ${label}</button>`;

/**
 * h: { onCopy, onRegenerate, onEdit, onSpeak, onZip, onCode, onSaveMemory, onDismissMemory, speakingId }
 */
export function renderMessageEl(message, h = {}) {
  const el = document.createElement('div');
  el.className = `message ${message.role}`;
  el.dataset.id = message.id;

  const body = document.createElement('div');
  body.className = 'message-body';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = filesRow(message.attachments) + (message.role === 'assistant'
    ? renderMarkdown(message.content || '')
    : escapeHtml(message.content || ''));
  body.appendChild(content);

  // Klicks auf Code-Knöpfe: ein Listener, der auch beim Streamen (neuer innerHTML) erhalten bleibt
  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-code-copy],[data-code-preview],[data-code-open],[data-code-download]');
    if (!b) return;
    const block = b.closest('.code-block');
    const type = ['copy', 'preview', 'open', 'download'].find(t => b.hasAttribute(`data-code-${t}`));
    h.onCode?.(type, { code: block.querySelector('code').textContent, lang: block.dataset.lang, file: block.dataset.file }, b);
  });

  if (message.notice === 'trimmed') {
    body.insertAdjacentHTML('beforeend', '<div class="message-notice">Ältere Nachrichten wurden für das Modell gekürzt, damit der Kontext reicht.</div>');
  }

  if (message.role === 'assistant') {
    if (message.content) {
      body.insertAdjacentHTML('beforeend', statsLine(message));
      const zipN = extractCodeBlocks(message.content).length;
      const speaking = h.speakingId === message.id;
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML =
        btn('copy', I.copy, 'Kopieren', 'Antwort kopieren') +
        btn('speak', speaking ? I.stop : I.speak, speaking ? 'Stopp' : 'Vorlesen', 'Antwort vorlesen', speaking ? 'on' : '') +
        btn('regenerate', I.redo, 'Neu', 'Antwort neu generieren') +
        (zipN >= 2 ? btn('zip', I.zip, `ZIP (${zipN})`, 'Alle Code-Dateien als ZIP laden') : '');
      actions.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'copy') h.onCopy?.(message);
        if (act === 'speak') h.onSpeak?.(message);
        if (act === 'regenerate') h.onRegenerate?.(message);
        if (act === 'zip') h.onZip?.(message);
      });
      body.appendChild(actions);
    }
  } else {
    if (h.onEdit) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML = btn('edit', I.edit, 'Bearbeiten', 'Nachricht bearbeiten und neu senden');
      actions.addEventListener('click', () => h.onEdit(message));
      body.appendChild(actions);
    }
    if (message.memoryHint) {
      const chip = document.createElement('div');
      chip.className = 'mem-chip';
      chip.innerHTML = `<span>💡 Merken: <b>${escapeHtml(message.memoryHint)}</b></span><button type="button" data-act="save">Merken</button><button type="button" class="x" data-act="dismiss" aria-label="Verwerfen">✕</button>`;
      chip.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'save') h.onSaveMemory?.(message);
        if (act === 'dismiss') h.onDismissMemory?.(message);
      });
      body.appendChild(chip);
    }
  }

  if (message.role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'AI';
    el.appendChild(avatar);
  }
  el.appendChild(body);
  return el;
}
