// projects.js — Projekte wie bei Claude: eigene Anweisungen und Dateien, die in jedem Chat des Projekts gelten.
import { storage } from './storage.js';
import { api } from './api.js';
import { retrieve } from './rag.js';
import { uid, escapeHtml, showToast } from './ui.js';
import { openModal } from '../components/modal.js';

const MAX_PROJECT_CHARS = 400000;   // pro Projekt (der Speicher im Browser ist begrenzt)

export function createProjectStore() {
  let list = storage.getProjects();
  const stamp = (p) => Math.max(Date.now(), (p.updatedAt || 0) + 1);   // streng aufsteigend, siehe chat.js
  const save = () => { storage.saveProjects(list); if (typeof window !== 'undefined') window.dispatchEvent(new Event('aicore:store-changed')); };
  return {
    all: () => list.filter(p => !p.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt),
    get: (id) => list.find(p => p.id === id && !p.deletedAt) || null,
    raw: () => list,
    /** Ersetzt oder ergänzt ein Projekt (Abgleich). */
    upsert(project) { const i = list.findIndex(x => x.id === project.id); if (i >= 0) list[i] = project; else list.push(project); save(); },
    create(name) {
      const p = { id: uid(), name: String(name).trim().slice(0, 60) || 'Projekt', instructions: '', files: [], createdAt: Date.now(), updatedAt: Date.now() };
      list.push(p); save(); return p;
    },
    update(id, patch) { const p = list.find(x => x.id === id); if (p) { Object.assign(p, patch, { updatedAt: stamp(p) }); save(); } },
    remove(id) { const p = list.find(x => x.id === id); if (p) { p.updatedAt = stamp(p); p.deletedAt = p.updatedAt; p.files = []; save(); } },
  };
}

/** Text für den Systemprompt: Anweisungen und Dateien. Passt alles in `budget`, kommt alles mit, sonst nur die Abschnitte zur Frage. */
export function projectContext(p, { query = '', budget = 12000 } = {}) {
  if (!p) return '';
  const head = `Du arbeitest im Projekt „${p.name}“.${p.instructions ? ` Anweisungen des Projekts: ${p.instructions.slice(0, 3000)}` : ''}`;
  const files = p.files || [];
  if (!files.length) return head;
  const room = Math.max(800, budget - head.length);
  const total = files.reduce((n, f) => n + f.text.length, 0);
  const body = total <= room
    ? files.map(f => `### ${f.name}\n${f.text}`).join('\n\n')
    : `[Auszüge, die zur Frage passen. Das Projekt ist größer als der Platz im Modell.]\n${retrieve(files, query, room)}`;
  return `${head}\n\nDateien des Projekts:\n${body}`;
}

export function openProjectDialog({ project, chats, onNewChat, onOpenChat, onChange, onDelete }) {
  const root = document.createElement('div');
  root.className = 'proj-dialog';
  const modal = openModal({ title: 'Projekt', tabs: { main: { label: 'Projekt', render: () => root } } });

  const draw = () => {
    root.innerHTML = `
      <label class="proj-field">Name<input class="text-input" data-f="name" maxlength="60" value="${escapeHtml(project.name)}"></label>
      <label class="proj-field">Anweisungen für dieses Projekt<textarea class="text-input" data-f="ins" rows="5" maxlength="3000" placeholder="z. B. „Wir schreiben an einer Bewerbung. Antworte förmlich.“">${escapeHtml(project.instructions || '')}</textarea></label>
      <div class="proj-field">Dateien <small>(${project.files.length}) — große Dateien werden nach der Frage durchsucht</small>
        <ul class="proj-files">${project.files.map(f => `<li><span>${escapeHtml(f.name)}</span><button type="button" class="mini-btn" data-del="${f.id}" aria-label="Datei entfernen">✕</button></li>`).join('') || '<li class="empty">Noch keine Dateien</li>'}</ul>
        <input type="file" data-f="file" multiple hidden>
        <button type="button" class="btn" data-add>Datei hinzufügen</button></div>
      <div class="proj-field">Chats in diesem Projekt
        <ul class="proj-chats">${chats.map(c => `<li><button type="button" class="link-btn" data-open="${c.id}">${escapeHtml(c.title)}</button></li>`).join('') || '<li class="empty">Noch keine Chats</li>'}</ul></div>
      <div class="proj-actions"><button type="button" class="btn primary" data-new><b>Neuer Chat im Projekt</b></button><button type="button" class="link-btn danger" data-remove>Projekt löschen</button></div>`;
    const $ = (s) => root.querySelector(s);
    $('[data-f="name"]').addEventListener('change', (e) => { project.name = e.target.value.trim() || project.name; onChange({ name: project.name }); });
    $('[data-f="ins"]').addEventListener('change', (e) => { project.instructions = e.target.value.trim(); onChange({ instructions: project.instructions }); });
    $('[data-add]').addEventListener('click', () => $('[data-f="file"]').click());
    $('[data-f="file"]').addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        try {
          const data = await api.upload(file);
          if (!data.extractedText) { showToast(`„${file.name}“: ${data.note || 'kein Text gefunden'}`); continue; }
          if (project.files.reduce((n, f) => n + f.text.length, 0) + data.extractedText.length > MAX_PROJECT_CHARS) { showToast('Das Projekt ist voll. Entferne zuerst eine Datei.'); break; }
          project.files.push({ id: uid(), name: file.name, text: data.extractedText.slice(0, 60000) });
        } catch (err) { showToast(err.message || 'Datei konnte nicht gelesen werden'); }
      }
      onChange({ files: project.files }); draw();
    });
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { project.files = project.files.filter(f => f.id !== b.dataset.del); onChange({ files: project.files }); draw(); }));
    root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { modal.close(); onOpenChat(b.dataset.open); }));
    $('[data-new]').addEventListener('click', () => { modal.close(); onNewChat(); });
    $('[data-remove]').addEventListener('click', () => { if (confirm(`Projekt „${project.name}“ löschen? Die Chats bleiben erhalten.`)) { modal.close(); onDelete(); } });
  };
  draw();
}
