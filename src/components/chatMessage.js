import { branchInfo } from '../js/branches.js';
import { renderMarkdown, escapeHtml, extractCodeBlocks } from '../js/ui.js';
import { messageExports } from '../js/formatsMeta.js';

// Datei-Menü unter einer Antwort schließen, wenn man daneben klickt (einmal für die ganze Seite).
if (typeof document !== 'undefined' && !globalThis.__aicoreExportClose) {
  globalThis.__aicoreExportClose = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.export-wrap')) return;
    document.querySelectorAll('.export-menu:not([hidden])').forEach(m => { m.hidden = true; });
  });
}

const I = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  redo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9A9 9 0 0 1 20 6.3M20.5 15A9 9 0 0 1 4 17.7"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  speak: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  up: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11v9H3v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-1.500 7a2 2 0 0 1-2 1.500H7"/></svg>',
  down: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 13V4h4v9zM17 13l-4 8a2 2 0 0 1-2-2v-4H5a2 2 0 0 1-2-2l1.500-7A2 2 0 0 1 6.500 4H17"/></svg>',
  doc: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6"/></svg>',
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

const sourcesRow = (m) => {
  const list = (m.sources || []).filter(s => /^https?:\/\//.test(s.url));
  if (!list.length) return '';
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return `<div class="sources"><span>Quellen</span>${list.map(s => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title)}">[${s.n}] ${escapeHtml(host(s.url))}</a>`).join('')}</div>`;
};
const versionSwitch = (m) => {
  const n = m.versions?.length || 0;
  if (n < 2) return '';
  const i = m.vIdx ?? n - 1;
  return `<span class="vsw"><button type="button" data-act="vprev" aria-label="Vorherige Version" ${i <= 0 ? 'disabled' : ''}>‹</button><span>${i + 1}/${n}</span><button type="button" data-act="vnext" aria-label="Nächste Version" ${i >= n - 1 ? 'disabled' : ''}>›</button></span>`;
};
const btn = (act, icon, label, title = label, cls = '') => `<button type="button" data-act="${act}" title="${title}" class="${cls}">${icon} ${label}</button>`;

/**
 * h: { onCopy, onRegenerate, onEdit, onSpeak, onZip, onCode, onSaveMemory, onDismissMemory, speakingId }
 */
const safeImg = (s) => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

/** Erzeugte Bilder und Videos (Befehle /bild und /video). */
function mediaBlock(message, h) {
  let out = '';
  (message.images || []).filter(safeImg).forEach((src, i) => {
    out += `<figure class="gen-image"><img src="${src}" alt="Erzeugtes Bild" loading="lazy"><a class="btn" href="${src}" download="bild-${i + 1}.jpg">Laden</a></figure>`;
  });
  const v = message.video;
  if (v) {
    const url = v.state === 'done' ? h.videoUrl?.(v.id) : null;
    out += v.state === 'failed' ? `<div class="gen-video fail">Das Video hat nicht geklappt${v.error ? `: ${escapeHtml(v.error)}` : '.'}</div>`
      : url ? `<video class="gen-video" controls playsinline src="${url}"></video><a class="btn" href="${url}" download="video.mp4">Laden</a>`
        : `<div class="gen-video wait"><i class="gen-spin"></i><span>Video wird erzeugt${v.progress ? ` · ${Math.round(v.progress)} %` : ' …'}</span><small>Das dauert einige Minuten. Du kannst weiterarbeiten.</small></div>`;
  }
  return out;
}

export function renderMessageEl(message, h = {}) {
  const el = document.createElement('div');
  el.className = `message ${message.role}`;
  el.dataset.id = message.id;

  const body = document.createElement('div');
  body.className = 'message-body';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = filesRow(message.attachments) + mediaBlock(message, h) + (message.role === 'assistant'
    ? renderMarkdown(message.content || '')
    : escapeHtml(message.content || ''));
  body.appendChild(content);
  if (message.sources?.length) body.insertAdjacentHTML('beforeend', sourcesRow(message));

  // Klicks auf Code-Knöpfe: ein Listener, der auch beim Streamen (neuer innerHTML) erhalten bleibt
  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-code-copy],[data-code-preview],[data-code-open],[data-code-download],[data-code-export],[data-code-run]');
    if (!b) return;
    const block = b.closest('.code-block');
    const type = ['copy', 'preview', 'open', 'download', 'export', 'run'].find(t => b.hasAttribute(`data-code-${t}`));
    h.onCode?.(type, { code: block.querySelector('code').textContent, lang: block.dataset.lang, file: block.dataset.file }, b, message);
  });

  if (message.notice === 'trimmed') {
    body.insertAdjacentHTML('beforeend', '<div class="message-notice">Ältere Nachrichten wurden für das Modell gekürzt, damit der Kontext reicht. Mit /komprimieren fasst die KI den Anfang zusammen.</div>');
  }

  if (message.role === 'assistant') {
    if (message.content && !message.media) {
      body.insertAdjacentHTML('beforeend', statsLine(message));
      const zipN = extractCodeBlocks(message.content).length;
      const speaking = h.speakingId === message.id;
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML =
        btn('copy', I.copy, 'Kopieren', 'Antwort kopieren') +
        btn('speak', speaking ? I.stop : I.speak, speaking ? 'Stopp' : 'Vorlesen', 'Antwort vorlesen', speaking ? 'on' : '') +
        btn('regenerate', I.redo, 'Neu', 'Antwort neu generieren') +
        btn('up', I.up, '', 'Hilfreiche Antwort', message.feedback === 'up' ? 'on' : '') +
        btn('down', I.down, '', 'Nicht hilfreich', message.feedback === 'down' ? 'on' : '') +
        `<span class="export-wrap">${btn('export', I.doc, 'Datei ▾', 'Antwort als Datei speichern (Word, PDF, Excel, PowerPoint …)')}<div class="export-menu" role="menu" hidden>${messageExports(message.content).map(x => `<button type="button" role="menuitem" data-fmt="${x.fmt}">${x.label}</button>`).join('')}</div></span>` +
        versionSwitch(message) +
        (zipN >= 2 ? btn('zip', I.zip, `ZIP (${zipN})`, 'Alle Code-Dateien als ZIP laden') : '');
      actions.addEventListener('click', (e) => {
        const fmtBtn = e.target.closest('.export-menu [data-fmt]');
        if (fmtBtn) { fmtBtn.closest('.export-menu').hidden = true; h.onExport?.(message, fmtBtn.dataset.fmt); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'export') {
          const menu = actions.querySelector('.export-menu');
          document.querySelectorAll('.export-menu').forEach(m => { if (m !== menu) m.hidden = true; });
          menu.hidden = !menu.hidden;
        }
        if (act === 'copy') h.onCopy?.(message);
        if (act === 'speak') h.onSpeak?.(message);
        if (act === 'regenerate') h.onRegenerate?.(message);
        if (act === 'zip') h.onZip?.(message);
        if (act === 'vprev') h.onVersion?.(message, -1);
        if (act === 'vnext') h.onVersion?.(message, 1);
        if (act === 'up' || act === 'down') h.onFeedback?.(message, act);
      });
      body.appendChild(actions);
    }
  } else {
    if (h.onEdit) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const bi = branchInfo(message);
      actions.innerHTML = btn('edit', I.edit, 'Bearbeiten', 'Nachricht bearbeiten und neu senden') + (bi
        ? `<span class="vsw"><button type="button" data-act="bprev" aria-label="Vorheriger Zweig" ${bi.index <= 1 ? 'disabled' : ''}>‹</button><span>${bi.index}/${bi.total}</span><button type="button" data-act="bnext" aria-label="Nächster Zweig" ${bi.index >= bi.total ? 'disabled' : ''}>›</button></span>` : '');
      actions.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'edit') h.onEdit(message);
        else if (act === 'bprev') h.onBranch?.(message, -1);
        else if (act === 'bnext') h.onBranch?.(message, 1);
      });
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
