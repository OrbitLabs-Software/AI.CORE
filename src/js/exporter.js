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
