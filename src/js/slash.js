// slash.js — Befehle im Eingabefeld: "/" öffnet eine Liste, Pfeiltasten und Enter wählen aus.

/** "/rolle coder" → { cmd, args } oder null, wenn kein bekannter Befehl. */
export function parseSlash(text, commands) {
  const m = /^\/([a-zäöüß]+)(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const cmd = commands.find(c => c.name === m[1].toLowerCase());
  return cmd ? { cmd, args: (m[2] || '').trim() } : null;
}

export function createSlashMenu({ textarea, menu, commands, onPick }) {
  let items = [];
  let index = 0;

  const isOpen = () => !menu.hidden;
  const close = () => { menu.hidden = true; menu.innerHTML = ''; items = []; };

  function render() {
    menu.innerHTML = '';
    items.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = `slash-item${i === index ? ' on' : ''}`;
      row.setAttribute('role', 'option');
      row.innerHTML = `<b>/${c.name}${c.args ? ' …' : ''}</b><span>${c.hint}</span>`;
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(c); });
      menu.appendChild(row);
    });
    menu.hidden = items.length === 0;
  }

  function refresh() {
    const v = textarea.value;
    const m = /^\/([a-zäöüß]*)$/i.exec(v);   // nur solange noch kein Leerzeichen getippt wurde
    if (!m) return close();
    items = commands.filter(c => c.name.startsWith(m[1].toLowerCase()));
    index = Math.min(index, Math.max(0, items.length - 1));
    render();
  }

  function pick(c) {
    close();
    onPick(c);
  }

  textarea.addEventListener('input', refresh);
  // Beim Verlassen des Feldes schließen — aber nur, wenn der Fokus wirklich weg ist
  // (sonst schließt ein alter Timer das Menü, nachdem man schon wieder tippt).
  textarea.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== textarea) close(); }, 120));
  textarea.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(items[index]);
    }
  }, true);

  return { close, isOpen };
}
