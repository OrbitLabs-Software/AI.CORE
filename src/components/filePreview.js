import { escapeHtml } from '../js/ui.js';

export function renderFilePreviewRow(container, files, { onRemove }) {
  container.innerHTML = '';
  container.hidden = files.length === 0;
  for (const f of files) {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    const icon = f.preview
      ? `<img src="${f.preview}" alt="">`
      : `<span aria-hidden="true">${f.status === 'uploading' ? '⏳' : '📄'}</span>`;
    chip.innerHTML = `${icon}<span class="fc-name">${escapeHtml(f.name)}</span>${f.status === 'ready' && !f.text && !f.preview ? '<span class="fc-warn" title="Kein Text gelesen">⚠</span>' : ''}<button type="button" class="fc-remove" aria-label="Entfernen">✕</button>`;
    chip.querySelector('.fc-remove').addEventListener('click', () => onRemove(f.id));
    container.appendChild(chip);
  }
}
