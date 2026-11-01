// share.js — geteilte Chats als Nur-Lesen-Schnappschuss (data/shares/<id>.json).
// Die ID ist 128 Bit zufällig; wer den Link hat, kann lesen. Bilder und Dateiinhalte werden nicht mitgeteilt.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = () => path.join(process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'shares');
const ID = /^[a-f0-9]{32}$/;
const MAX_MESSAGES = 400;
const MAX_CHARS = 400000;

export const shareEnabled = () => process.env.SHARING !== 'false';

function clean(chat) {
  const msgs = Array.isArray(chat?.messages) ? chat.messages.slice(-MAX_MESSAGES) : [];
  const messages = msgs
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({
      role: m.role,
      content: m.content.slice(0, 60000),
      ...(Array.isArray(m.attachments) && m.attachments.length ? { files: m.attachments.map(a => String(a?.name || '').slice(0, 120)).filter(Boolean).slice(0, 10) } : {}),
    }));
  return { title: String(chat?.title || 'Chat').slice(0, 120), messages };
}

export function createShare(chat, owner = '') {
  const data = clean(chat);
  if (!data.messages.length) return { error: 'Der Chat ist leer', status: 400 };
  if (JSON.stringify(data).length > MAX_CHARS) return { error: 'Der Chat ist zu groß zum Teilen', status: 413 };
  const id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify({ ...data, owner: String(owner), createdAt: Date.now() }), { mode: 0o600 });
  return { id };
}

export function readShare(id) {
  if (!ID.test(String(id))) return null;
  try {
    const { title, messages, createdAt } = JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf-8'));
    return { title, messages, createdAt };
  } catch { return null; }
}

/** Nur die Person, die geteilt hat (oder jeder bei abgeschalteter Anmeldung), darf löschen. */
export function deleteShare(id, owner = '') {
  if (!ID.test(String(id))) return false;
  const file = path.join(dir(), `${id}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.owner && data.owner !== String(owner)) return false;
    fs.unlinkSync(file);
    return true;
  } catch { return false; }
}
