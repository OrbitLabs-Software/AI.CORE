// exporter.js — Chats als Markdown oder JSON sichern und wieder einlesen.

import { downloadFile } from './ui.js';

const stamp = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s || 'chat').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'chat';

export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || 'Chat'}`, '', `_Exportiert aus AI Core am ${new Date().toLocaleString('de-DE')}_`, ''];
  for (const m of chat.messages) {
    lines.push(`## ${m.role === 'user' ? 'Du' : 'AI Core'}`, '');
    for (const a of m.attachments || []) lines.push(`> Anhang: ${a.name}`);
    if (m.attachments?.length) lines.push('');
    lines.push(String(m.content || '').trim(), '');
  }
  return lines.join('\n');
}

export function exportChatMarkdown(chat) {
  downloadFile(`${safeName(chat.title)}-${stamp()}.md`, chatToMarkdown(chat), 'text/markdown');
}

export function exportAllJSON(chats) {
  const payload = { app: 'ai-core', version: 2, exportedAt: new Date().toISOString(), chats };
  downloadFile(`ai-core-chats-${stamp()}.json`, JSON.stringify(payload), 'application/json');
}

/** Komplette Sicherung: Chats, Projekte und Einstellungen (ohne alles, was nach Schlüssel aussieht). */
export function exportBackupJSON({ chats, projects, settings }) {
  const safe = Object.fromEntries(Object.entries(settings || {}).filter(([k]) => !/key|token|secret|ack/i.test(k)));
  const payload = { app: 'ai-core', type: 'backup', version: 3, exportedAt: new Date().toISOString(), chats, projects, settings: safe };
  downloadFile(`ai-core-sicherung-${stamp()}.json`, JSON.stringify(payload), 'application/json');
}

/** Liest eine komplette Sicherung (oder eine alte Chat-Sicherung) und gibt { chats, projects, settings } zurück. */
export function parseBackup(text) {
  const data = JSON.parse(text);
  const chats = parseImport(text);
  const projects = Array.isArray(data?.projects)
    ? data.projects.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({
      id: p.id, name: String(p.name).slice(0, 60), instructions: String(p.instructions || '').slice(0, 3000),
      files: (Array.isArray(p.files) ? p.files : []).filter(f => f && typeof f.text === 'string').map(f => ({ id: String(f.id || f.name), name: String(f.name || 'Datei').slice(0, 120), text: f.text.slice(0, 60000) })),
      createdAt: Number(p.createdAt) || Date.now(), updatedAt: Number(p.updatedAt) || Date.now(),
    })) : [];
  const settings = data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
    ? Object.fromEntries(Object.entries(data.settings).filter(([k]) => !/key|token|secret|ack/i.test(k))) : {};
  return { chats, projects, settings };
}

/** Liest eine Exportdatei und gibt gültige Chats zurück (wirft bei ungültiger Datei). */
export function parseImport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.chats;
  if (!Array.isArray(list)) throw new Error('Keine AI-Core-Sicherung');
  return list
    .filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages))
    .map(c => ({
      id: c.id,
      title: String(c.title || 'Importierter Chat').slice(0, 120),
      favorite: Boolean(c.favorite),
      roleId: c.roleId || null,
      createdAt: Number(c.createdAt) || Date.now(),
      updatedAt: Number(c.updatedAt) || Date.now(),
      messages: c.messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ ...m, content: String(m.content ?? '') })),
    }));
}
