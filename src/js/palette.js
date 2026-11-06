// palette.js — Befehlspalette (Strg+/): Aktionen, Einstellungen und Chats per Tastatur finden.
import { escapeHtml } from './ui.js';

/** getItems(query) liefert [{ label, hint, run }] */
export function openPalette(getItems) {
  document.querySelector('.pal-overlay')?.remove();
  const el = document.createElement('div');
  el.className = 'pal-overlay';
  el.innerHTML = '<div class="pal" role="dialog" aria-label="Befehlspalette"><input class="pal-input" placeholder="Befehl oder Chat suchen …" aria-label="Suchen" autocomplete="off" spellcheck="false"><div class="pal-list" role="listbox"></div></div>';
  const input = el.querySelector('input'), list = el.querySelector('.pal-list');
  let items = [], sel = 0;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const draw = () => {
    items = getItems(input.value.trim().toLowerCase()).slice(0, 12);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items.map((it, i) => `<button type="button" role="option" class="pal-item${i === sel ? ' on' : ''}" data-i="${i}"><span>${escapeHtml(it.label)}</span><small>${escapeHtml(it.hint || '')}</small></button>`).join('')
      : '<div class="pal-empty">Nichts gefunden</div>';
    list.querySelectorAll('.pal-item').forEach(b => b.addEventListener('click', () => run(Number(b.dataset.i))));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const it = items[i]; if (!it) return; close(); setTimeout(() => it.run(), 0); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  draw();
  input.focus();
}
