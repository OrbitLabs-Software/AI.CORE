import { openModal, settingsRow, switchControl } from '../components/modal.js';
import { storage } from './storage.js';
import { showToast, escapeHtml, formatBytes } from './ui.js';
import { serverBase } from './config.js';
import { api, ApiError } from './api.js';
import { allRoles, BUILTIN_ROLES } from './roles.js';
import { exportAllJSON, exportBackupJSON, parseImport, parseBackup } from './exporter.js';

const el = (tag, props = {}, html = '') => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (html) n.innerHTML = html;
  return n;
};
const note = (html, cls = '') => el('div', { className: `note ${cls}`.trim() }, html);
const badge = (txt, cls = '') => `<span class="badge ${cls}">${txt}</span>`;

export function openSettingsModal({ store, sync = null, initialTab, authRequired, user, owner = false, legal = {}, onThemeChange, onRolesChange, onModelsChange, onDataChange, onMemoryChange, onSettingsChange, onLogout }) {
  const settings = storage.getSettings();
  const save = () => { storage.saveSettings(settings); onSettingsChange?.(); };

  const GROUPS = { general: 'Persönlich', memory: 'Persönlich', roles: 'Persönlich', models: 'KI', pro: 'Konto und Daten', sync: 'Konto und Daten', data: 'Konto und Daten', trash: 'Konto und Daten', stats: 'Übersicht', server: 'Übersicht', about: 'Übersicht' };
  const defs = {
    general: { label: 'Allgemein', render: renderGeneral },
    memory: { label: 'Erinnerungen', render: renderMemory },
    roles: { label: 'Rollen', render: renderRoles },
    models: { label: 'Modelle', render: renderModels },
    pro: { label: 'Pro', render: renderPro },
    sync: { label: 'Abgleich', render: renderSync },
    data: { label: 'Daten', render: renderData },
    trash: { label: 'Papierkorb', render: renderTrash },
    stats: { label: 'Nutzung', render: renderStats },
    ...(owner ? { server: { label: 'Server', render: renderServer } } : {}),
    about: { label: 'Über', render: renderAbout },
  };
  openModal({
    title: 'Einstellungen',
    initialTab,
    tabs: Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { ...v, group: GROUPS[k] }])),
  });

  // ---------- Papierkorb ----------
  function renderTrash() {
    const wrap = el('div');
    const draw = () => {
      const items = store.trash();
      wrap.innerHTML = `<div class="note">Gelöschte Chats bleiben <b>30 Tage</b> hier und lassen sich zurückholen. Danach sind sie endgültig weg.</div>
        ${items.length ? items.map(c => `<div class="trash-row" data-id="${c.id}"><div><b>${escapeHtml(c.title)}</b><small>gelöscht am ${new Date(c.deletedAt).toLocaleDateString('de-AT')} · ${c.messages.length} Nachrichten</small></div><div><button class="btn" data-restore>Zurückholen</button><button class="btn" data-purge>Endgültig löschen</button></div></div>`).join('')
          : '<div class="settings-row-sub">Der Papierkorb ist leer.</div>'}
        ${items.length ? '<button class="btn" id="trash-empty">Papierkorb leeren</button>' : ''}`;
      wrap.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => { store.restore(b.closest('.trash-row').dataset.id); onDataChange(); draw(); showToast('Chat zurückgeholt'); }));
      wrap.querySelectorAll('[data-purge]').forEach(b => b.addEventListener('click', () => { store.purge(b.closest('.trash-row').dataset.id); onDataChange(); draw(); }));
      wrap.querySelector('#trash-empty')?.addEventListener('click', () => { if (confirm(`${items.length} Chats endgültig löschen?`)) { store.emptyTrash(); onDataChange(); draw(); } });
    };
    draw();
    return wrap;
  }

  // ---------- Abgleich zwischen Geräten ----------
  function renderSync() {
    const wrap = el('div');
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min` : `vor ${Math.round(m / 60)} Std`; };
    const draw = () => {
      if (!sync) { wrap.innerHTML = '<div class="note warn">Der Abgleich ist auf diesem Server abgeschaltet.</div>'; return; }
      const st = sync.engine.status();
      const label = st.state === 'ok' ? `Zuletzt ${ago(st.at)}: ${st.message}` : st.state === 'läuft' ? 'Gleicht ab …' : st.state === 'fehler' ? `Fehler: ${st.message}` : 'Aus';
      wrap.innerHTML = `<div class="note"><b>Chats und Projekte zwischen Geräten abgleichen.</b> Handy und Computer zeigen dann denselben Stand. Die neuere Änderung gewinnt, gelöschte Chats wandern in den Papierkorb aller Geräte.</div>
        <div class="settings-row"><div><div class="settings-row-label">Abgleich einschalten</div><div class="settings-row-sub">${escapeHtml(label)}</div></div><div id="sync-switch"></div></div>
        <div class="settings-row-sub">Abgeglichen werden Texte, Projekte mit Dateien, Zusammenfassungen und Zweige. Bilder und Dateivorschauen bleiben auf dem Gerät. Die Daten liegen auf deinem Server (<code>data/sync</code>), der Betreiber des Servers kann sie lesen.</div>
        <div class="pro-actions"><button class="btn" id="sync-now" ${settings.sync ? '' : 'disabled'}>Jetzt abgleichen</button><button class="btn" id="sync-wipe">Abgleich-Daten vom Server löschen</button></div>`;
      wrap.querySelector('#sync-switch').appendChild(switchControl(Boolean(settings.sync), async (on) => {
        if (on && !confirm('Deine Chats und Projekte (ohne Bilder) werden auf deinem Server gespeichert, damit andere Geräte sie sehen. Der Betreiber des Servers kann sie lesen. Einschalten?')) { draw(); return; }
        settings.sync = on; save();
        if (on) { sync.engine.start(); await sync.engine.run(); } else sync.engine.stop();
        draw();
      }));
      wrap.querySelector('#sync-now').addEventListener('click', async () => { await sync.engine.run(); onDataChange(); draw(); });
      wrap.querySelector('#sync-wipe').addEventListener('click', async () => {
        if (!confirm('Alle abgeglichenen Daten dieses Kontos vom Server löschen? Auf deinen Geräten bleiben die Chats erhalten.')) return;
        try { await api.syncWipe(); settings.sync = false; save(); sync.engine.stop(); sync.engine.reset(); showToast('Abgleich-Daten gelöscht'); } catch (e) { showToast(e.message); }
        draw();
      });
    };
    draw();
    return wrap;
  }

  // ---------- Allgemein ----------
  function renderGeneral() {
    const wrap = el('div');

    const nameInput = el('input', { className: 'text-input', value: user?.name || settings.username, disabled: Boolean(user) });
    nameInput.addEventListener('change', () => {
      settings.username = nameInput.value.trim() || 'Nutzer';
      save();
    });
    wrap.appendChild(settingsRow({ label: 'Anzeigename', sub: user ? `Angemeldet als ${escapeHtml(user.email)}` : 'Wird in der Seitenleiste gezeigt', control: nameInput }));

    const choice = (key, options, fallback) => {
      const s = el('select', { className: 'set-select' });
      for (const [v, t] of options) s.appendChild(el('option', { value: v, textContent: t }));
      s.value = settings[key] || fallback;
      s.addEventListener('change', () => { settings[key] = s.value; save(); onThemeChange(settings.theme); });
      return s;
    };
    wrap.appendChild(settingsRow({ label: 'Design', sub: '„System“ folgt dem Gerät', control: choice('theme', [['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'System']], 'light') }));
    wrap.appendChild(settingsRow({ label: 'Textgröße', sub: 'Für Antworten und Nachrichten', control: choice('fontSize', [['s', 'Klein'], ['m', 'Normal'], ['l', 'Groß'], ['xl', 'Sehr groß']], 'm') }));
    wrap.appendChild(settingsRow({ label: 'Dichte', sub: 'Kompakt zeigt mehr auf einmal', control: choice('density', [['normal', 'Normal'], ['compact', 'Kompakt']], 'normal') }));
    wrap.appendChild(settingsRow({ label: 'Breite des Chats', control: choice('width', [['narrow', 'Schmal'], ['normal', 'Normal'], ['wide', 'Breit']], 'normal') }));

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

    const full = el('button', { className: 'btn primary', type: 'button', innerHTML: '<b>Alles sichern</b> (Chats, Projekte, Einstellungen)' });
    full.addEventListener('click', () => exportBackupJSON({ chats: store.raw(), projects: storage.getProjects(), settings: storage.getSettings() }));
    wrap.appendChild(full);
    const exp = el('button', { className: 'btn', type: 'button', textContent: 'Nur Chats sichern (JSON)' });
    exp.addEventListener('click', () => exportAllJSON(store.raw()));
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    const imp = el('button', { className: 'btn', type: 'button', textContent: 'Sicherung einlesen' });
    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      try {
        const backup = parseBackup(await file.files[0].text());
        const added = store.importChats(backup.chats);
        if (backup.projects.length) {
          const have = new Set(storage.getProjects().map(p => p.id));
          storage.saveProjects([...storage.getProjects(), ...backup.projects.filter(p => !have.has(p.id))]);
        }
        if (Object.keys(backup.settings).length) storage.saveSettings({ ...storage.getSettings(), ...backup.settings });
        if (backup.projects.length || Object.keys(backup.settings).length) setTimeout(() => location.reload(), 900);
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
  const legalLinks = (l) => {
    const items = [['imprint', 'Impressum'], ['privacy', 'Datenschutz'], ['terms', 'AGB']].filter(([k]) => l?.[k]);
    return items.length ? `<div class="group-title">Rechtliches</div><div class="settings-row-sub">${items.map(([k, t]) => `<a href="${escapeHtml(l[k])}" target="_blank" rel="noopener noreferrer">${t}</a>`).join(' · ')}</div>` : '';
  };

  // ---------- Nutzung (aus den Chats in diesem Browser) ----------
  function renderStats() {
    const wrap = el('div');
    const chats = store.all();
    const msgs = chats.flatMap(c => c.messages.map(m => ({ ...m, chat: c })));
    const ai = msgs.filter(m => m.role === 'assistant' && !m.media);
    const tokens = ai.reduce((n, m) => n + (m.stats?.tokens || 0), 0);
    const tps = ai.map(m => m.stats?.tps).filter(Boolean);
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const days = Array.from({ length: 14 }, (_, i) => day(Date.now() - (13 - i) * 86400000));
    const perDay = Object.fromEntries(days.map(d => [d, 0]));
    msgs.filter(m => m.role === 'user' && m.createdAt).forEach(m => { const d = day(m.createdAt); if (d in perDay) perDay[d]++; });
    const max = Math.max(1, ...Object.values(perDay));
    const models = {};
    ai.forEach(m => { if (m.stats?.model) models[m.stats.model] = (models[m.stats.model] || 0) + 1; });
    const top = Object.entries(models).sort((a, b) => b[1] - a[1]).slice(0, 4);
    wrap.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${chats.length}</b><span>Chats</span></div>
        <div class="stat"><b>${msgs.filter(m => m.role === 'user').length}</b><span>Fragen</span></div>
        <div class="stat"><b>${tokens.toLocaleString('de-AT')}</b><span>Tokens gelesen</span></div>
        <div class="stat"><b>${tps.length ? Math.round(tps.reduce((a, b) => a + b, 0) / tps.length * 10) / 10 : '–'}</b><span>Tokens pro Sekunde</span></div>
      </div>
      <div class="group-title">Fragen pro Tag (14 Tage)</div>
      <div class="bars">${days.map(d => `<div class="bar-col" title="${d}: ${perDay[d]}"><i style="height:${Math.round(perDay[d] / max * 100)}%"></i><small>${d.slice(8)}</small></div>`).join('')}</div>
      ${top.length ? `<div class="group-title">Modelle</div>${top.map(([m, n]) => `<div class="pro-use"><div class="pro-use-head"><span>${escapeHtml(m)}</span><b>${n}×</b></div><div class="pro-bar"><i style="width:${Math.round(n / top[0][1] * 100)}%"></i></div></div>`).join('')}` : ''}
      <div class="settings-row-sub">Die Zahlen stammen aus den Chats in diesem Browser. Gelöschte Chats zählen nicht mit.</div>`;
    return wrap;
  }

  // ---------- Server (nur Besitzer) ----------
  function renderServer() {
    const wrap = el('div');
    wrap.innerHTML = '<div class="note">Lade …</div>';
    const fmtB = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
    const up = (s) => (s > 86400 ? `${Math.floor(s / 86400)} T ${Math.floor(s % 86400 / 3600)} Std` : `${Math.floor(s / 3600)} Std ${Math.floor(s % 3600 / 60)} Min`);
    const chart = (rows, key, label) => { const m = Math.max(1, ...rows.map(r => r[key])); return `<div class="group-title">${label}</div><div class="bars">${rows.map(r => `<div class="bar-col" title="${r.date}: ${r[key]}"><i style="height:${Math.round(r[key] / m * 100)}%"></i><small>${r.date.slice(8)}</small></div>`).join('')}</div>`; };
    const draw = (s) => {
      const f = s.features, t = s.metrics.totals;
      const base = (serverBase() || location.origin).replace(/\/$/, '');
      wrap.innerHTML = `
        ${s.auth === 'AUS' ? '<div class="note warn"><b>Anmeldung ist aus.</b> Der Server darf so nie öffentlich erreichbar sein.</div>' : ''}
        <div class="stat-grid">
          <div class="stat"><b>${s.version}</b><span>Version</span></div>
          <div class="stat"><b>${up(s.uptimeSec)}</b><span>läuft seit</span></div>
          <div class="stat"><b>${s.memory.processMB} MB</b><span>Speicher (frei ${s.memory.freeMB} von ${s.memory.totalMB})</span></div>
          <div class="stat"><b>${s.load[0]}</b><span>Last (${s.cpus} Kerne)</span></div>
        </div>
        <div class="settings-row-sub">${escapeHtml(s.platform)} · Node ${escapeHtml(s.node)} · Daten: ${fmtB(s.data.all.bytes)} in ${s.data.all.files} Dateien (Videos ${s.data.videos.files}, geteilte Chats ${s.data.shares.files}) · Proxy: ${escapeHtml(s.trustProxy)} · gerade aktiv: ${s.activeChats}</div>
        <div class="group-title">Funktionen</div>
        <div class="pro-actions">${[['Websuche', f.search, s.searchProvider], ['Bilder', f.image], ['Videos', f.video], ['Teilen', f.share], ['Bezahlen', f.stripe], ['Codes', f.codes], ['API', f.apiKeys > 0, f.apiKeys ? `${f.apiKeys} Schlüssel` : '']].map(([n, on, extra]) => badge(`${n}${on && extra ? ` · ${escapeHtml(extra)}` : ''}`, on ? 'ok' : '')).join(' ')}</div>
        <div class="group-title">Letzte 14 Tage</div>
        <div class="settings-row-sub">${t.chat} Chats · ${t.tokens.toLocaleString('de-AT')} Tokens · ${t.search} Suchen · ${t.image} Bilder · ${t.video} Videos · ${t.api} API-Aufrufe · ${t.errors} Fehler</div>
        ${chart(s.metrics.rows, 'chat', 'Chats pro Tag')}${chart(s.metrics.rows, 'users', 'Aktive Konten pro Tag')}
        <div class="group-title">API für andere Programme</div>
        <div class="settings-row-sub">${f.apiKeys ? `OpenAI-kompatibel unter <code>${escapeHtml(base)}/v1</code>. Beispiel:<pre class="api-ex">curl ${escapeHtml(base)}/v1/chat/completions \\
  -H "Authorization: Bearer DEIN_SCHLÜSSEL" \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hallo"}]}'</pre>` : 'Nicht eingerichtet. Trage in der <code>.env</code> <code>API_KEYS=name:ein-langer-schluessel</code> ein (mindestens 16 Zeichen) und starte den Dienst neu.'}</div>
        <button class="btn" id="srv-refresh">Aktualisieren</button>`;
      wrap.querySelector('#srv-refresh').addEventListener('click', load);
    };
    const load = () => api.adminStatus().then(draw).catch(e => { wrap.innerHTML = `<div class="note warn">${escapeHtml(e.message || 'Nicht erreichbar')}</div>`; });
    load();
    return wrap;
  }

  // ---------- Pro ----------
  function renderPro() {
    const wrap = el('div');
    wrap.innerHTML = '<div class="note">Lade …</div>';
    const returnUrl = () => location.origin + location.pathname;
    const fail = (e) => showToast(e.message || 'Das hat nicht geklappt');
    const bar = (label, used, max) => `<div class="pro-use"><div class="pro-use-head"><span>${label}</span><b>${used} von ${max}</b></div><div class="pro-bar"><i style="width:${max ? Math.min(100, used / max * 100) : 100}%"></i></div></div>`;

    const draw = (p) => {
      const until = p.until ? new Date(p.until).toLocaleDateString('de-AT') : '';
      const status = p.unlimited ? `${badge('Unbegrenzt', 'ok')}` : p.pro ? `${badge('Pro', 'ok')} <span class="settings-row-sub">aktiv bis ${until}</span>` : `${badge('Kostenlos')}`;
      wrap.innerHTML = `
        <div class="note"><b>AI Core Pro</b> ${status}<br>${p.unlimited ? 'Als Besitzer hast du keine Grenzen.' : 'Mehr Videos und Bilder pro Monat. Pro gehört zu deinem Konto und gilt auf allen Geräten.'}</div>
        ${p.unlimited ? '' : `<div class="group-title">Dieser Monat</div>${bar('Videos', p.used.video, p.limits.video)}${bar('Bilder', p.used.image, p.limits.image)}`}
        <div class="pro-actions"></div>
        ${p.billing.codes ? `<div class="group-title">Code einlösen</div><div class="pro-code"><input class="text-input" id="pro-code" placeholder="Code eingeben" autocomplete="off" spellcheck="false"><button class="btn" id="pro-redeem">Einlösen</button></div>` : ''}
        ${legalLinks(legal) ? `<div class="settings-row-sub">Mit dem Kauf gelten unsere Bedingungen: ${[['terms', 'AGB'], ['privacy', 'Datenschutz'], ['imprint', 'Impressum']].filter(([k]) => legal[k]).map(([k, t]) => `<a href="${escapeHtml(legal[k])}" target="_blank" rel="noopener noreferrer">${t}</a>`).join(' · ')}</div>` : ''}
        ${!p.billing.stripe && !p.billing.codes ? '<div class="note warn">Der Server hat noch keine Bezahlung eingerichtet (STRIPE_* in der .env, siehe README).</div>' : ''}`;
      const actions = wrap.querySelector('.pro-actions');
      if (!p.unlimited && !p.pro && p.billing.stripe) {
        const b = el('button', { className: 'btn primary' }, `<b>AI Core Pro kaufen${p.billing.price ? ` · ${escapeHtml(p.billing.price)}` : ''}</b>`);
        b.addEventListener('click', async () => { b.disabled = true; try { location.href = await api.proCheckout(returnUrl()); } catch (e) { b.disabled = false; fail(e); } });
        actions.appendChild(b);
      }
      if (p.manageable) {
        const b = el('button', { className: 'btn' }, 'Abo verwalten oder kündigen');
        b.addEventListener('click', async () => { try { location.href = await api.proPortal(returnUrl()); } catch (e) { fail(e); } });
        actions.appendChild(b);
      }
      wrap.querySelector('#pro-redeem')?.addEventListener('click', async () => {
        const input = wrap.querySelector('#pro-code');
        if (!input.value.trim()) return input.focus();
        try { draw({ ...(await api.proRedeem(input.value.trim())), billing: p.billing }); showToast('Pro ist aktiv. Danke!'); } catch (e) { fail(e); }
      });
    };
    api.plan().then(draw).catch(e => { wrap.innerHTML = `<div class="note warn">${escapeHtml(e.message || 'Tarif konnte nicht geladen werden')}</div>`; });
    return wrap;
  }

  function renderAbout() {
    const wrap = el('div');
    wrap.innerHTML = `
      <div class="note"><b>AI Core 4.0</b> · deine eigene AI-Chat-Plattform von OrbitLabs.<br>Lokale Modelle über Ollama, optional DeepSeek V4.1 Flash in der Cloud.</div>
      <div class="group-title">Tastenkürzel</div>
      <div class="settings-row-sub" style="line-height:2">
        <kbd>Enter</kbd> senden · <kbd>Shift</kbd>+<kbd>Enter</kbd> neue Zeile<br>
        <kbd>/</kbd> Befehle (<kbd>/neu</kbd> <kbd>/coder</kbd> <kbd>/datei</kbd> <kbd>/merken</kbd> <kbd>/rolle</kbd> <kbd>/export</kbd> <kbd>/hilfe</kbd>)<br>
        <kbd>Esc</kbd> Antwort stoppen oder Panel schließen<br>
        <kbd>Strg</kbd>+<kbd>K</kbd> Chats durchsuchen · <kbd>Strg</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> neuer Chat<br>
        <kbd>Strg</kbd>+<kbd>/</kbd> Befehlspalette · <kbd>?</kbd> diese Hilfe
      </div>
      ${legalLinks(legal)}`;
    return wrap;
  }
}
