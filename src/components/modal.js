export function openModal({ title, tabs, initialTab, onClose }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `<h2>${title}</h2>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  header.appendChild(closeBtn);

  const tabBar = document.createElement('div');
  tabBar.className = 'modal-tabs';

  const body = document.createElement('div');
  body.className = 'modal-body';

  box.appendChild(header);

  let active = initialTab || Object.keys(tabs)[0];

  if (Object.keys(tabs).length > 1) {
    for (const key of Object.keys(tabs)) {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'modal-tab' + (key === active ? ' active' : '');
      tabBtn.textContent = tabs[key].label;
      tabBtn.addEventListener('click', () => {
        active = key;
        tabBar.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        tabBtn.classList.add('active');
        renderBody();
      });
      tabBar.appendChild(tabBtn);
    }
    box.appendChild(tabBar);
  }

  box.appendChild(body);

  function renderBody() {
    body.innerHTML = '';
    body.appendChild(tabs[active].render());
  }
  renderBody();

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('keydown', onKey, true);   // sonst bliebe der Handler nach dem Schließen hängen
    backdrop.remove();
    onClose?.();
  }

  closeBtn.setAttribute('aria-label', 'Schließen');
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);

  backdrop.appendChild(box);
  root.appendChild(backdrop);
  closeBtn.focus();
  return { close, body };
}

export function settingsRow({ label, sub, control }) {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const left = document.createElement('div');
  left.innerHTML = `<div class="settings-row-label">${label}</div>${sub ? `<div class="settings-row-sub">${sub}</div>` : ''}`;
  row.appendChild(left);
  row.appendChild(control);
  return row;
}

export function switchControl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'switch';
  label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}><span class="switch-track"></span>`;
  label.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
  return label;
}
