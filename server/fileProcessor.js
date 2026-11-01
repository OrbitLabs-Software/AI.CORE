// fileProcessor.js — liest Text aus hochgeladenen Dateien (im Speicher, nichts
// bleibt auf der Festplatte). Der Text wird später als Kontext an das Modell gegeben.

import path from 'path';
import mammoth from 'mammoth';

const MAX_TEXT = 60000;
const MAX_PDF_PAGES = 80;

// pdf.js wird erst beim ersten PDF geladen (spart Startzeit und Speicher).
let pdfjsPromise = null;
const loadPdfjs = () => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  let text = '';
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let p = 1; p <= pages && text.length < MAX_TEXT; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('') + '\n\n';
  }
  await doc.destroy();
  return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), numPages: doc.numPages };
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.log', '.html', '.htm', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.cs',
  '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.ps1', '.sql', '.vue', '.svelte', '.kt', '.swift', '.r', '.lua',
]);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const looksBinary = (buf) => {
  const sample = buf.subarray(0, 4000);
  let bad = 0;
  for (const b of sample) if (b === 0) bad++;
  return bad > 0;
};

export async function processUploadedFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const info = {
    name: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
    kind: 'other',
    extractedText: null,
    truncated: false,
    note: null,
  };

  try {
    if (ext === '.pdf' || file.mimetype === 'application/pdf') {
      info.kind = 'pdf';
      const parsed = await extractPdf(file.buffer);
      info.extractedText = parsed.text;
      info.pages = parsed.numPages;
      if (!info.extractedText) info.note = 'Kein Text gefunden (vermutlich ein Scan).';
    } else if (ext === '.docx') {
      info.kind = 'docx';
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      info.extractedText = value.replace(/\n{3,}/g, '\n\n').trim();
    } else if (TEXT_EXT.has(ext) || /^text\//.test(file.mimetype) || file.mimetype === 'application/json') {
      if (looksBinary(file.buffer)) {
        info.note = 'Binärdatei, kein Text lesbar.';
      } else {
        info.kind = 'text';
        info.extractedText = file.buffer.toString('utf-8');
      }
    } else if (IMAGE_EXT.has(ext) || /^image\//.test(file.mimetype)) {
      info.kind = 'image';
    } else {
      info.note = 'Dateityp wird nicht gelesen.';
    }
  } catch (e) {
    info.note = `Lesen fehlgeschlagen (${e.message.slice(0, 80)})`;
    info.extractedText = null;
  }

  if (info.extractedText && info.extractedText.length > MAX_TEXT) {
    info.extractedText = info.extractedText.slice(0, MAX_TEXT);
    info.truncated = true;
  }
  return info;
}
