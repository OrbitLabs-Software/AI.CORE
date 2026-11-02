// formats.js — Format-Fabrik: macht aus Code-Blöcken und Antworten fertige Dateien (xlsx, pptx, pdf, docx, zip, png, jpg …).
// Alles läuft im Browser, ohne Server und ohne Bibliothek. Die Bausteine sind reine Funktionen und lassen sich testen.
import { buildXlsx, sheetsFromMarkdown } from './xlsx.js';
import { buildPptx } from './pptx.js';
import { buildPdf } from './pdf.js';
import { markdownToDocx } from './docx.js';
import { makeZip } from './zip.js';
import { answerOnly } from './mdblocks.js';
import { formatsFor, isNativeLang, FORMAT_EXT } from './formatsMeta.js';
import { downloadFile, EXT } from './ui.js';

export { formatsFor, isNativeLang, messageExports, FORMAT_LABEL } from './formatsMeta.js';

const FALLBACK_NAME = { xlsx: 'tabelle', pptx: 'praesentation', pdf: 'dokument', docx: 'dokument', zip: 'projekt', png: 'bild', jpg: 'bild', md: 'antwort', txt: 'antwort' };

export const MIME = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  md: 'text/markdown', txt: 'text/plain', svg: 'image/svg+xml', xml: 'application/xml', ics: 'text/calendar', vcf: 'text/vcard',
  yml: 'text/yaml', sql: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export const mimeFor = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'text/plain';

/** „Projekt“, „projekt.xlsx“, „ordner/bericht.docx“ → Dateiname mit der Endung des Zielformats. */
export function outName(file, fmt, fallback) {
  const ext = FORMAT_EXT[fmt] || fmt;
  const stem = String(file || '').split('/').pop().replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().slice(0, 60);
  return `${stem || fallback || FALLBACK_NAME[fmt] || 'datei'}.${ext}`;
}

// ---------- ZIP-Beschreibung ----------
const ZIP_MARK = [
  /^\s*={3,}\s*(?:Datei|File)?\s*:?\s*(\S[^=]*?\.[A-Za-z0-9]{1,8})\s*={3,}\s*$/i,
  /^\s*-{3,}\s*(?:Datei|File)\s*:\s*(\S.*?)\s*(?:-{3,})?\s*$/i,
];
export function safeZipPath(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..');
  return parts.join('/').replace(/[<>:"|?*\u0000-\u001F]/g, '_').slice(0, 120);
}
/** „=== pfad/datei.ext ===“ vor jeder Datei → [{ name, content }] */
export function parseZipSpec(text) {
  const files = [];
  let cur = null;
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = ZIP_MARK[0].exec(line) || ZIP_MARK[1].exec(line);
    if (m) { cur = { name: safeZipPath(m[1]) || `datei-${files.length + 1}.txt`, lines: [] }; files.push(cur); } else if (cur) cur.lines.push(line);
  }
  if (!files.length) return [{ name: 'datei.txt', content: String(text ?? '') }];
  const seen = new Set();
  return files.slice(0, 200).map((f, i) => {
    let name = f.name;
    while (seen.has(name.toLowerCase())) name = `${i + 1}-${name}`;
    seen.add(name.toLowerCase());
    return { name, content: f.lines.join('\n').replace(/^\n+|\n+$/g, '') + '\n' };
  });
}

// ---------- SVG → PNG / JPG (nur im Browser) ----------
function svgSize(src) {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(src);
  const w = /<svg\b[^>]*\swidth\s*=\s*["']?([\d.]+)/i.exec(src);
  const h = /<svg\b[^>]*\sheight\s*=\s*["']?([\d.]+)/i.exec(src);
  const W = Number(w?.[1] || vb?.[1] || 800), H = Number(h?.[1] || vb?.[2] || 600);
  return { w: W > 0 ? W : 800, h: H > 0 ? H : 600 };
}
export function svgToImage(svg, fmt = 'png') {
  return new Promise((resolve, reject) => {
    let src = String(svg).trim();
    if (!/<svg\b[^>]*xmlns\s*=/i.test(src)) src = src.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const { w, h } = svgSize(src);
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(3, 3000 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (fmt === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Die SVG-Grafik ist fehlerhaft und konnte nicht gelesen werden')); };
    img.src = url;
  });
}

// ---------- Code-Block → Datei ----------
/** @returns {Promise<{name:string, blob:Blob}|null>} */
export async function exportBlock({ lang, code, file }, fmt) {
  const f = fmt || formatsFor(lang)[0];
  if (!f) return null;
  const text = String(code ?? '');
  let blob;
  if (f === 'xlsx') blob = buildXlsx(text);
  else if (f === 'pptx') blob = buildPptx(text);
  else if (f === 'pdf') blob = buildPdf(text);
  else if (f === 'docx') blob = markdownToDocx(text);
  else if (f === 'zip') blob = new Blob([makeZip(parseZipSpec(text))], { type: MIME.zip });
  else if (f === 'png' || f === 'jpg') blob = await svgToImage(text, f);
  else return null;
  return { name: outName(file, f), blob };
}

/** Datei speichern: Beschreibungs-Blöcke (xlsx, pptx, pdf, docx, zip) werden zur fertigen Datei, alles andere bleibt Text. */
export async function saveBlock(block, fmt) {
  const lang = String(block.lang || '').toLowerCase();
  if (fmt || isNativeLang(lang)) {
    const r = await exportBlock(block, fmt);
    if (r) { downloadFile(r.name, r.blob); return r.name; }
  }
  const ext = block.file?.includes('.') ? block.file.split('.').pop() : (EXT[lang] || lang || 'txt');
  const name = block.file || `code.${ext}`;
  const text = lang === 'csv' || lang === 'tsv' ? `\uFEFF${block.code}` : block.code; // BOM: Excel liest Umlaute richtig
  downloadFile(name, text, mimeFor(name));
  return name;
}

// ---------- Ganze Antwort → Datei ----------
const stripMarkdown = (md) => String(md).replace(/^```.*$/gm, '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();

export function exportMessage(content, fmt, title = 'antwort') {
  const md = answerOnly(content);
  const name = (f) => outName(title, f, 'antwort');
  if (fmt === 'docx') return { name: name('docx'), blob: markdownToDocx(md) };
  if (fmt === 'pdf') return { name: name('pdf'), blob: buildPdf(md) };
  if (fmt === 'pptx') return { name: outName(title, 'pptx'), blob: buildPptx(md) };
  if (fmt === 'xlsx') return { name: outName(title, 'xlsx'), blob: buildXlsx(sheetsFromMarkdown(md)) };
  if (fmt === 'md') return { name: name('md'), blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }) };
  if (fmt === 'txt') return { name: name('txt'), blob: new Blob([stripMarkdown(md)], { type: 'text/plain;charset=utf-8' }) };
  return null;
}
