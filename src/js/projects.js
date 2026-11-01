// projects.js — Projekte wie bei Claude: eigene Anweisungen und Dateien, die in jedem Chat des Projekts gelten.
import { storage } from './storage.js';
import { api } from './api.js';
import { uid, escapeHtml, showToast } from './ui.js';
import { openModal } from '../components/modal.js';

const MAX_FILES_CHARS = 12000;   // damit auch kleine lokale Modelle noch Platz zum Antworten haben

export function createProjectStore() {
  let list = storage.getProjects();
  const save = () => storage.saveProjects(list);
  return {
    all: () => list.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    get: (id) => list.find(p => p.id === id) || null,
    create(name) {
      const p = { id: uid(), name: String(name).trim().slice(0, 60) || 'Projekt', instructions: '', files: [], createdAt: Date.now(), updatedAt: Date.now() };
      list.push(p); save(); return p;
    },
    update(id, patch) { const p = list.find(x => x.id === id); if (p) { Object.assign(p, patch, { updatedAt: Date.now() }); save(); } },
    remove(id) { list = list.filter(p => p.id !== id); save(); },
  };
}

/** Text für den Systemprompt: Anweisungen und (gekürzte) Dateien des Projekts. */
export function projectContext(p) {
  if (!p) return '';
  let left = MAX_FILES_CHARS;
  const files = (p.files || []).map(f => {
    if (left <= 0) return '';
    const t = f.text.slice(0, left); left -= t.length;
    return `### ${f.name}\n${t}${t.length < f.text.length ? '\n[gekürzt]' : ''}`;
  }).filter(Boolean).join('\n\n');
  return `Du arbeitest im Projekt „${p.name}“.${p.instructions ? ` Anweisungen des Projekts: ${p.instructions.slice(0, 3000)}` : ''}${files ? `\n\nDateien des Projekts:\n${files}` : ''}`;
}

export function openProjectDialog({ project, chats, onNewChat, onOpenChat, onChange, onDelete }) {
  const root = document.createElement('div');
  root.className = 'proj-dialog';
  const modal = openModal({ title: 'Projekt', tabs: { main: { label: 'Projekt', render: () => root } } });

  const draw = () => {
    root.innerHTML = `
      <label class="proj-field">Name<input class="text-input" data-f="name" maxlength="60" value="${escapeHtml(project.name)}"></label>
      <label class="proj-field">Anweisungen für dieses Projekt<textarea class="text-input" data-f="ins" rows="5" maxlength="3000" placeholder="z. B. „Wir schreiben an einer Bewerbung. Antworte förmlich.“">${escapeHtml(project.instructions || '')}</textarea></label>
      <div class="proj-field">Dateien <small>(${project.files.length}) — werden in jedem Chat des Projekts mitgelesen</small>
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
          project.files.push({ id: uid(), name: file.name, text: data.extractedText.slice(0, 30000) });
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
