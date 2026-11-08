// layout.js — aufgeräumte Oberfläche: Werkzeug-Menü am Eingabefeld, Chips für aktive Einstellungen, Menü „Mehr“ oben.
// Die bestehenden Auswahlfelder bleiben dieselben Elemente (mit ihren Handlern), sie ziehen nur um.

const $ = (id) => document.getElementById(id);
const ICON = {
  tools: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
};

function popover(anchor, el, { onOpen } = {}) {
  const close = () => { el.hidden = true; anchor.setAttribute('aria-expanded', 'false'); };
  anchor.setAttribute('aria-haspopup', 'true'); anchor.setAttribute('aria-expanded', 'false');
  anchor.addEventListener('click', (e) => { e.stopPropagation(); const open = el.hidden; document.dispatchEvent(new Event('aicore:close-popovers')); el.hidden = !open; anchor.setAttribute('aria-expanded', String(open)); if (open) onOpen?.(); });
  document.addEventListener('click', (e) => { if (!el.hidden && !el.contains(e.target) && !anchor.contains(e.target)) close(); });
  document.addEventListener('aicore:close-popovers', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) { close(); anchor.focus(); } });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return close;
}

/** Werkzeug-Menü: Rolle, Suche, Stil und Schnellaktionen. actions = [{ label, hint, run }] */
export function setupToolsMenu(actions = []) {
  const attach = $('attach-btn');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tools-btn'; btn.className = 'icon-btn';
  btn.title = 'Werkzeuge: Rolle, Suche, Stil'; btn.setAttribute('aria-label', 'Werkzeuge'); btn.innerHTML = ICON.tools;
  attach.after(btn);
  const pop = document.createElement('div');
  pop.className = 'tools-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Werkzeuge');
  pop.innerHTML = '<div class="tp-title">Für diese Unterhaltung</div><div class="tp-picks"></div><div class="tp-title">Schnell</div><div class="tp-actions"></div>';
  for (const id of ['pick-role', 'pick-search', 'pick-library', 'pick-style']) pop.querySelector('.tp-picks').appendChild(document.querySelector(`.${id}`));
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tp-action'; b.dataset.close = '';
    b.innerHTML = `<span>${a.label}</span><small>${a.hint || ''}</small>`;
    b.addEventListener('click', () => setTimeout(a.run, 0));
    pop.querySelector('.tp-actions').appendChild(b);
  }
  $('composer-form').before(pop);
  popover(btn, pop);
  return btn;
}

/** Chips über dem Eingabefeld für alles, was vom Normalfall abweicht. */
export function setupChips() {
  const row = document.createElement('div');
  row.className = 'mode-chips'; row.hidden = true;
  $('composer-form').before(row);
  const spec = [
    ['role-select', 'default', (t) => `Rolle: ${t}`],
    ['search-select', 'off', (t) => t],
    ['library-select', 'off', () => 'Bibliothek'],
    ['style-select', 'normal', (t) => `Stil: ${t}`],
  ];
  const render = () => {
    row.innerHTML = '';
    for (const [id, def, label] of spec) {
      const sel = $(id);
      if (!sel || !sel.value || sel.value === def) continue;
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'mode-chip'; chip.title = 'Zurücksetzen';
      chip.innerHTML = `<span>${label(sel.options[sel.selectedIndex]?.text || sel.value)}</span><b aria-hidden="true">✕</b>`;
      chip.addEventListener('click', () => { sel.value = def; sel.dispatchEvent(new Event('change', { bubbles: true })); });
      row.appendChild(chip);
    }
    row.hidden = !row.children.length;
  };
  for (const [id] of spec) $(id)?.addEventListener('change', () => setTimeout(render, 0));
  render();
  return render;
}

/** Menü „Mehr“: Export, Teilen und Design wandern aus der oberen Leiste in ein Menü. */
export function setupMoreMenu(extra = []) {
  const bar = document.querySelector('.topbar-actions');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'more-btn'; btn.className = 'icon-btn'; btn.title = 'Mehr'; btn.setAttribute('aria-label', 'Mehr'); btn.innerHTML = ICON.more;
  bar.appendChild(btn);
  const pop = document.createElement('div');
  pop.className = 'more-pop'; pop.hidden = true; pop.setAttribute('role', 'menu');
  const items = [
    ['export-btn', 'Chat als Markdown speichern'],
    ['share-btn', 'Chat als Link teilen'],
    ['theme-toggle', 'Hell oder dunkel wechseln'],
  ];
  for (const [id, label] of items) {
    const orig = $(id);
    if (!orig) continue;
    orig.classList.add('orig-hidden');
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.close = ''; b.textContent = label;
    b.addEventListener('click', () => orig.click());
    pop.appendChild(b);
  }
  for (const a of extra) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.close = ''; b.textContent = a.label;
    b.addEventListener('click', () => setTimeout(a.run, 0));
    pop.appendChild(b);
  }
  bar.appendChild(pop);
  popover(btn, pop);
}
