import { openModal, settingsRow, switchControl } from '../components/modal.js';
import { storage } from './storage.js';
import { showToast, escapeHtml, formatBytes } from './ui.js';
import { api, ApiError } from './api.js';
import { allRoles, BUILTIN_ROLES } from './roles.js';
import { exportAllJSON, parseImport } from './exporter.js';

const el = (tag, props = {}, html = '') => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (html) n.innerHTML = html;
  return n;
};
const note = (html, cls = '') => el('div', { className: `note ${cls}`.trim() }, html);
const badge = (txt, cls = '') => `<span class="badge ${cls}">${txt}</span>`;

export function openSettingsModal({ store, initialTab, authRequired, user, onThemeChange, onRolesChange, onModelsChange, onDataChange, onMemoryChange, onSettingsChange, onLogout }) {
  const settings = storage.getSettings();
  const save = () => { storage.saveSettings(settings); onSettingsChange?.(); };

  openModal({
    title: 'Einstellungen',
    initialTab,
    tabs: {
      general: { label: 'Allgemein', render: renderGeneral },
      models: { label: 'Modelle', render: renderModels },
      memory: { label: 'Erinnerungen', render: renderMemory },
      roles: { label: 'Rollen', render: renderRoles },
      data: { label: 'Daten', render: renderData },
      about: { label: 'Über', render: renderAbout },
    },
  });

  // ---------- Allgemein ----------
  function renderGeneral() {
    const wrap = el('div');

    const nameInput = el('input', { className: 'text-input', value: user?.name || settings.username, disabled: Boolean(user) });
    nameInput.addEventListener('change', () => {
      settings.username = nameInput.value.trim() || 'Nutzer';
      save();
    });
    wrap.appendChild(settingsRow({ label: 'Anzeigename', sub: user ? `Angemeldet als ${escapeHtml(user.email)}` : 'Wird in der Seitenleiste gezeigt', control: nameInput }));

    wrap.appendChild(settingsRow({
      label: 'Dunkles Design', sub: 'Hell (Standard) oder dunkel',
      control: switchControl(settings.theme === 'dark', (on) => { settings.theme = on ? 'dark' : 'light'; save(); onThemeChange(settings.theme); }),
    }));

    const roleSelect = el('select', { className: 'set-select' });
    for (const r of allRoles(settings)) roleSelect.appendChild(el('option', { value: r.id, textContent: r.name }));
    roleSelect.value = settings.roleId;
    roleSelect.addEventListener('change', () => { settings.roleId = roleSelect.value; save(); onRolesChange(); });
    wrap.appendChild(settingsRow({ label: 'Standard-Rolle', sub: 'Für neue Chats; pro Chat oben änderbar', control: roleSelect }));

    const ins = el('textarea', { className: 'text-input', rows: 4, maxLength: 1500, placeholder: 'z. B. „Duze mich“, „Antworte kurz“, „Ich programmiere in Python“', value: settings.instructions || '' });
    ins.addEventListener('change', () => { settings.instructions = ins.value.trim(); save(); });
    const insRow = settingsRow({ label: 'Eigene Anweisungen', sub: 'Gelten in jedem Chat (wie die „Präferenzen“ bei Claude)', control: ins });
    insRow.style.flexDirection = 'column'; insRow.style.alignItems = 'stretch';
    wrap.appendChild(insRow);

    const temp = el('select', { className: 'set-select' });
    [['', 'Server-Standard'], ['0.2', 'Präzise (0,2)'], ['0.6', 'Ausgewogen (0,6)'], ['1', 'Kreativ (1,0)']]
      .forEach(([v, t]) => temp.appendChild(el('option', { value: v, textContent: t })));
    temp.value = settings.temperature == null ? '' : String(settings.temperature);
    temp.addEventListener('change', () => { settings.temperature = temp.value === '' ? null : Number(temp.value); save(); });
    wrap.appendChild(settingsRow({ label: 'Kreativität', sub: 'Niedrig = sachlicher, hoch = abwechslungsreicher', control: temp }));

    wrap.appendChild(settingsRow({ label: 'Erinnerungen nutzen', sub: 'AI Core bezieht gemerkte Fakten in jedes Gespräch ein',
      control: switchControl(settings.useMemory, (on) => { settings.useMemory = on; save(); }) }));
    wrap.appendChild(settingsRow({ label: 'Vorschläge zum Merken', sub: 'Zeigt „Merken?“ unter Sätzen wie „Ich heiße …“',
      control: switchControl(settings.memoryHints, (on) => { settings.memoryHints = on; save(); }) }));
    wrap.appendChild(settingsRow({ label: 'Vorschau automatisch öffnen', sub: 'Bei HTML/SVG-Code, nur auf breiten Bildschirmen',
      control: switchControl(settings.autoPreview, (on) => { settings.autoPreview = on; save(); }) }));

    if (authRequired) {
      const out = el('button', { className: 'btn', type: 'button', textContent: 'Abmelden' });
      out.style.marginTop = '14px';
      out.addEventListener('click', onLogout);
      wrap.appendChild(out);
    }
    return wrap;
  }

  // ---------- Modelle ----------
  function renderModels() {
    const wrap = el('div');
    const body = el('div');
    body.appendChild(note('Lade …'));
    wrap.appendChild(body);

    async function load() {
      let info;
      try { info = await api.models(); }
      catch (e) { body.innerHTML = ''; body.appendChild(note(e instanceof ApiError && e.status === 401 ? 'Bitte anmelden.' : 'Server nicht erreichbar (Demo-Modus).')); return; }
      body.innerHTML = '';
      const { status, models } = info;

      // --- Lokal ---
      body.appendChild(el('div', { className: 'group-title', textContent: 'Lokal auf dem Tiny' }));
      if (!status.ollama.enabled) body.appendChild(note('Ollama ist nicht eingerichtet (<code>OLLAMA_URL</code> in der <code>.env</code>).'));
      else if (!status.ollama.reachable) body.appendChild(note(`Ollama nicht erreichbar ${badge('aus')}<br>Prüfe <code>OLLAMA_URL</code> und ob Ollama läuft.${status.ollama.error ? `<br><small>${escapeHtml(status.ollama.error)}</small>` : ''}`, 'warn'));
      else {
        const list = el('div', { className: 'row-list' });
        const local = models.filter(m => m.provider === 'ollama');
        if (!local.length) list.appendChild(note('Noch kein Modell installiert. Lade unten eines herunter.'));
        for (const m of local) {
          const row = el('div', { className: 'item-row' }, `<span class="status-dot ${m.loaded ? 'ok' : 'idle'}" title="${m.loaded ? 'im Speicher' : 'nicht geladen'}"></span><span class="grow mono">${escapeHtml(m.label)}</span><span class="dim">${formatBytes(m.size)}</span>`);
          const warm = el('button', { className: 'mini-btn', type: 'button', textContent: m.loaded ? 'bereit' : 'Vorladen', disabled: m.loaded });
          warm.addEventListener('click', async () => { warm.textContent = 'lädt …'; warm.disabled = true; await api.warmup(m.id); setTimeout(load, 4000); });
          row.appendChild(warm);
          list.appendChild(row);
        }
        body.appendChild(list);
        if (info.admin) body.appendChild(pullForm());
      }

      // --- Cloud ---
      body.appendChild(el('div', { className: 'group-title', textContent: 'Cloud' }));
      if (status.cloud.enabled) {
        const cloud = models.filter(m => m.provider === 'cloud');
        body.appendChild(note(`${escapeHtml(status.cloud.label)} ist eingerichtet ${badge('Cloud', 'cloud')}<br>${cloud.map(m => `<code>${escapeHtml(m.label)}</code>`).join(' · ')}<br>Mit Cloud-Modellen werden deine Nachrichten an den Anbieter gesendet. Lokale Modelle bleiben auf dem Tiny.`));
      } else {
        body.appendChild(note('<b>Stärkeres Modell einrichten: DeepSeek V4.1 Flash</b><br>1. Im DeepSeek-Konto einen API-Schlüssel erzeugen (Doku: api-docs.deepseek.com).<br>2. Am Server in die <code>.env</code> eintragen: <code>CLOUD_API_KEY=sk-…</code><br>3. <code>sudo systemctl restart ai-core</code><br>Danach erscheint das Modell oben in der Auswahl, auch mit „Denkmodus“. Nachrichten gehen dann an DeepSeek, lokale Modelle bleiben privat.'));
      }
      if (status.anthropic.enabled) body.appendChild(note(`Anthropic ist eingerichtet ${badge('Cloud', 'cloud')}`));
    }

    function pullForm() {
      const form = el('div', { className: 'stack' });
      const input = el('input', { className: 'text-input', placeholder: 'Neues lokales Modell, z. B. qwen2.5:3b' });
      const btn = el('button', { className: 'btn', type: 'button', textContent: 'Herunterladen' });
      const bar = el('div', { className: 'progress' }, '<div class="progress-fill"></div>'); bar.hidden = true;
      const msg = el('div', { className: 'settings-row-sub' });
      btn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return;
        btn.disabled = true; bar.hidden = false; msg.textContent = 'Starte …';
        try {
          for await (const ev of api.pullModel(name)) {
            if (ev.error) throw new Error(ev.error);
            if (ev.percent != null) bar.firstChild.style.width = `${ev.percent}%`;
            msg.textContent = `${ev.status || ''}${ev.percent != null ? ` ${ev.percent} %` : ''}`;
          }
          showToast(`Modell ${name} installiert`);
          onModelsChange();
          load();
        } catch (e) { msg.textContent = `Fehler: ${e.message}`; }
        finally { btn.disabled = false; }
      });
      form.append(input, btn, bar, msg);
      return form;
    }

    load();
    return wrap;
  }

  // ---------- Erinnerungen ----------
  function renderMemory() {
    const wrap = el('div');
    const intro = note('Erinnerungen sind kurze Fakten über dich, die AI Core in jedes Gespräch mitnimmt, zum Beispiel „Ich programmiere am liebsten in JavaScript“. Sie liegen auf dem Server und gelten auf allen Geräten. Sag im Chat einfach <b>„Merk dir, dass …“</b> oder nutze <kbd>/merken</kbd>.');
    const list = el('div', { className: 'row-list' });
    const msg = el('div', { className: 'settings-row-sub' });
    wrap.append(intro, list);

    async function load() {
      let data;
      try { data = await api.memories(); }
      catch { list.innerHTML = ''; list.appendChild(note('Erinnerungen konnten nicht geladen werden.')); return; }
      onMemoryChange(data.items.length);
      list.innerHTML = '';
      if (!data.enabled) { list.appendChild(note('Erinnerungen sind am Server ausgeschaltet (<code>MEMORY=false</code>).', 'warn')); return; }
      if (!data.items.length) list.appendChild(note('Noch nichts gemerkt.'));
      for (const m of data.items) {
        const row = el('div', { className: 'item-row' }, `<span class="grow">${escapeHtml(m.text)}</span><span class="dim">${new Date(m.createdAt).toLocaleDateString('de-DE')}</span>`);
        const del = el('button', { className: 'mini-btn', type: 'button', textContent: 'Vergessen', title: 'Diese Erinnerung löschen' });
        del.addEventListener('click', async () => { await api.deleteMemory(m.id); load(); });
        row.appendChild(del);
        list.appendChild(row);
      }
      if (data.items.length) {
        const clear = el('button', { className: 'btn danger', type: 'button', textContent: 'Alles vergessen' });
        clear.style.marginTop = '14px';
        clear.addEventListener('click', async () => { if (confirm('Wirklich ALLE Erinnerungen löschen?')) { await api.clearMemories(); load(); } });
        list.appendChild(clear);
      }
      wrap.querySelector('.add-form')?.toggleAttribute('hidden', !data.enabled);
    }

    const form = el('div', { className: 'stack add-form' });
    const input = el('input', { className: 'text-input', placeholder: 'Neue Erinnerung, z. B. „Ich bin Vegetarier“', maxLength: 300 });
    const add = el('button', { className: 'btn primary', type: 'button', textContent: 'Merken' });
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      try { await api.addMemory(text); input.value = ''; msg.textContent = ''; load(); }
      catch (e) { msg.textContent = e.message; }
    };
    add.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    form.append(input, add, msg);
    wrap.appendChild(form);
    load();
    return wrap;
  }

  // ---------- Rollen ----------
  function renderRoles() {
    const wrap = el('div');
    wrap.appendChild(note('Eine Rolle ist eine vorbereitete Anweisung an die KI. Du wählst sie pro Chat oben neben dem Modell.'));
    const customList = el('div', { className: 'row-list' });
    function drawCustom() {
      customList.innerHTML = '';
      const custom = settings.customRoles || [];
      if (!custom.length) customList.appendChild(el('div', { className: 'settings-row-sub', textContent: 'Noch keine eigenen Rollen.' }));
      for (const r of custom) {
        const row = el('div', { className: 'item-row' }, `<span class="grow">${escapeHtml(r.name)}</span>`);
        const del = el('button', { className: 'mini-btn', type: 'button', textContent: 'Löschen' });
        del.addEventListener('click', () => {
          settings.customRoles = custom.filter(x => x.id !== r.id);
          if (settings.roleId === r.id) settings.roleId = 'default';
          save(); drawCustom(); onRolesChange();
        });
        row.appendChild(del);
        customList.appendChild(row);
      }
    }
    drawCustom();
    wrap.append(el('div', { className: 'group-title', textContent: 'Eigene Rollen' }), customList);

    const name = el('input', { className: 'text-input', placeholder: 'Name, z. B. Steuerberater', maxLength: 30 });
    const prompt = el('textarea', { className: 'text-input', placeholder: 'Anweisung, z. B. „Du erklärst Steuerthemen in einfachen Worten …“', rows: 4, maxLength: 2000 });
    const add = el('button', { className: 'btn primary', type: 'button', textContent: 'Rolle speichern' });
    add.addEventListener('click', () => {
      if (!name.value.trim() || !prompt.value.trim()) return showToast('Name und Anweisung ausfüllen');
      settings.customRoles = [...(settings.customRoles || []), { id: `c-${Date.now().toString(36)}`, name: name.value.trim(), prompt: prompt.value.trim() }];
      save(); name.value = ''; prompt.value = ''; drawCustom(); onRolesChange(); showToast('Rolle gespeichert');
    });
    const form = el('div', { className: 'stack' });
    form.append(name, prompt, add);
    wrap.appendChild(form);
    wrap.appendChild(el('div', { className: 'group-title', textContent: 'Mitgelieferte Rollen' }));
    wrap.appendChild(el('div', { className: 'settings-row-sub', textContent: BUILTIN_ROLES.map(r => r.name).join(' · ') }));
    return wrap;
  }

  // ---------- Daten ----------
  function renderData() {
    const wrap = el('div');
    const info = note('');
    const refresh = () => { info.textContent = `${store.all().length} Chats · ca. ${formatBytes(storage.usageBytes())} im Browser. Chats liegen nur in diesem Browser, Erinnerungen auf dem Server.`; };
    refresh();
    wrap.appendChild(info);

    const exp = el('button', { className: 'btn', type: 'button', textContent: 'Alle Chats sichern (JSON)' });
    exp.addEventListener('click', () => exportAllJSON(store.raw()));
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    const imp = el('button', { className: 'btn', type: 'button', textContent: 'Sicherung einlesen' });
    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      try {
        const added = store.importChats(parseImport(await file.files[0].text()));
        showToast(added ? `${added} Chat(s) importiert` : 'Keine neuen Chats in der Datei');
        refresh(); onDataChange();
      } catch (e) { showToast(`Import fehlgeschlagen: ${e.message}`); }
      file.value = '';
    });
    const wipe = el('button', { className: 'btn danger', type: 'button', textContent: 'Alle Chats löschen' });
    wipe.addEventListener('click', () => {
      if (!confirm('Wirklich ALLE Chats in diesem Browser löschen? Das lässt sich nicht rückgängig machen.')) return;
      store.clearAll(); refresh(); onDataChange(); showToast('Alle Chats gelöscht');
    });
    const row = el('div', { className: 'btn-row' });
    row.append(exp, imp, wipe, file);
    wrap.appendChild(row);
    return wrap;
  }

  // ---------- Über ----------
  function renderAbout() {
    const wrap = el('div');
    wrap.innerHTML = `
      <div class="note"><b>AI Core 3.0</b> · deine eigene AI-Chat-Plattform von OrbitLabs.<br>Lokale Modelle über Ollama, optional DeepSeek V4.1 Flash in der Cloud.</div>
      <div class="group-title">Tastenkürzel</div>
      <div class="settings-row-sub" style="line-height:2">
        <kbd>Enter</kbd> senden · <kbd>Shift</kbd>+<kbd>Enter</kbd> neue Zeile<br>
        <kbd>/</kbd> Befehle (<kbd>/neu</kbd> <kbd>/coder</kbd> <kbd>/merken</kbd> <kbd>/rolle</kbd> <kbd>/export</kbd> <kbd>/hilfe</kbd>)<br>
        <kbd>Esc</kbd> Antwort stoppen oder Panel schließen<br>
        <kbd>Strg</kbd>+<kbd>K</kbd> Chats durchsuchen · <kbd>Strg</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> neuer Chat<br>
        <kbd>?</kbd> diese Hilfe
      </div>`;
    return wrap;
  }
}
