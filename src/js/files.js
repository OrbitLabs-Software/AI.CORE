// files.js — Anhänge: Auswahl, Drag & Drop, Vorschau und Upload zum Server.
// Bilder werden im Browser auf max. 1024 px verkleinert (spart Speicher und Tempo).

import { uid, showToast } from './ui.js';
import { api, ApiError } from './api.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_FILES = 6;
export const ACCEPTED_HINT = 'PDF, DOCX, TXT, Code, CSV, JSON, Bilder';

export function createFileManager({ onChange }) {
  let pending = [];

  const notify = () => onChange(pending);

  async function addFiles(fileList) {
    for (const file of Array.from(fileList)) {
      if (pending.length >= MAX_FILES) { showToast(`Maximal ${MAX_FILES} Dateien pro Nachricht`); break; }
      if (file.size > MAX_FILE_SIZE) { showToast(`„${file.name}“ ist zu groß (max. 20 MB)`); continue; }
      const entry = { id: uid(), file, name: file.name, size: file.size, type: file.type, status: 'uploading', preview: null, text: null, note: null, truncated: false };
      if (file.type.startsWith('image/')) entry.preview = await makeThumbnail(file);
      pending.push(entry);
      notify();
      uploadFile(entry);
    }
  }

  async function uploadFile(entry) {
    try {
      const data = await api.upload(entry.file);
      entry.text = data.extractedText || null;
      entry.note = data.note || null;
      entry.truncated = Boolean(data.truncated);
      if (entry.note && !entry.preview) showToast(`„${entry.name}“: ${entry.note}`);
      else if (entry.truncated) showToast(`„${entry.name}“ ist lang — nur der Anfang wird verwendet`);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) showToast(e.message);
      // Ohne Server bleibt der Anhang nur als Vorschau erhalten.
    }
    entry.status = 'ready';
    notify();
  }

  function removeFile(id) { pending = pending.filter(f => f.id !== id); notify(); }
  function clear() { pending = []; notify(); }
  const getAll = () => pending;

  return { addFiles, removeFile, clear, getAll, ACCEPTED_HINT };
}

function readAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function makeThumbnail(file, max = 1024) {
  const original = await readAsDataURL(file);
  if (!original) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = original;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return original.length < 1_500_000 ? original : null;
  }
}

export function iconForType(type) {
  if (type?.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  return 'file';
}
