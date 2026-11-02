// pdf.js — Antworten (Markdown) als PDF, ohne Bibliothek.
// Eingebaute Schriften (Helvetica, Courier), Umlaute und € in WinAnsi, Seitenumbruch, Überschriften, Listen, Tabellen, Code, Zitate.
import { blocks, spans, plainInline, answerOnly } from './mdblocks.js';

export const PDF_MIME = 'application/pdf';

// ---------- Schriftbreiten (Helvetica AFM, Zeichen 32–126, in 1/1000 Punkt) ----------
const rep = (n, v) => Array(n).fill(v);
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, ...rep(10, 556), 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, ...rep(10, 556), 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const LATIN_FIX = { 160: 278, 161: 333, 162: 556, 163: 556, 164: 556, 165: 556, 166: 260, 167: 556, 168: 333, 169: 737, 170: 370, 171: 556, 172: 584, 173: 333, 174: 737, 175: 333, 176: 400, 177: 584, 178: 333, 179: 333, 180: 333, 181: 556, 182: 537, 183: 278, 184: 333, 185: 333, 186: 365, 187: 556, 188: 834, 189: 834, 190: 834, 191: 611, 198: 1000, 208: 722, 215: 584, 216: 778, 222: 667, 223: 611, 230: 889, 240: 556, 247: 584, 248: 611, 254: 556 };
const CP_FIX = { 128: 556, 130: 222, 131: 556, 132: 333, 133: 1000, 134: 556, 135: 556, 136: 333, 137: 1000, 138: 667, 139: 333, 140: 1000, 142: 611, 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 152: 333, 153: 1000, 154: 500, 155: 333, 156: 944, 158: 500, 159: 667 };

/** Breite eines WinAnsi-Zeichens (Code 0–255) in 1/1000 Punkt. font: F1 normal, F2 fett, F3 Courier, F4 kursiv */
export function glyphWidth(code, font) {
  if (font === 'F3') return 600;
  const t = font === 'F2' ? W_BOLD : W_REG;
  if (code >= 32 && code <= 126) return t[code - 32];
  let w;
  if (code >= 128 && code <= 159) w = CP_FIX[code] ?? 556;
  else if (LATIN_FIX[code]) w = LATIN_FIX[code];
  else if (code >= 192 && code <= 255) {
    const base = String.fromCharCode(code).normalize('NFD')[0];
    const bc = base.charCodeAt(0);
    w = bc >= 32 && bc <= 126 ? t[bc - 32] : 556;
  } else w = 556;
  return font === 'F2' ? Math.round(w * 1.04) : w;
}

// ---------- Text → WinAnsi-Codes ----------
const CP1252 = new Map([[0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]]);
const TRANSLIT = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '✓': 'x', '✔': 'x', '✗': '-', '✘': '-', '−': '-', '‐': '-', '‑': '-', '‒': '-', '′': "'", '″': '"', '\t': '    ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ', '\u202f': ' ', '▶': '>', '►': '>', '◦': '-', '▪': '-', '■': '-' };

export function toCodes(str) {
  const out = [];
  const s = String(str ?? '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u200B\uFEFF]/gu, '');
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (CP1252.has(cp)) out.push(CP1252.get(cp));
    else if (TRANSLIT[ch] != null) for (const c of TRANSLIT[ch]) out.push(c.charCodeAt(0));
    else if (cp < 32 || cp === 127) continue;
    else out.push(63);
  }
  return out;
}
const widthOf = (codes, font, size) => codes.reduce((w, c) => w + glyphWidth(c, font), 0) * size / 1000;
const pdfString = (codes) => `(${codes.map(c => (c === 40 ? '\\(' : c === 41 ? '\\)' : c === 92 ? '\\\\' : c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('')})`;
const num = (n) => (Math.round(n * 100) / 100).toString();

// ---------- Umbruch ----------
const fontOf = (sp, base) => (sp.c ? 'F3' : sp.b ? 'F2' : sp.i && base === 'F1' ? 'F4' : base);

/** Abschnitte → Zeilen; jede Zeile: { items:[{codes,font,w,space}], w } */
function wrap(spanList, maxW, size, base = 'F1') {
  const lines = [];
  let line = { items: [], w: 0 };
  const push = () => { while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().w; lines.push(line); line = { items: [], w: 0 }; };
  for (const sp of spanList) {
    const font = fontOf(sp, base);
    for (const part of String(sp.t).split(/(\s+)/)) {
      if (part === '') continue;
      const space = /^\s+$/.test(part);
      const codes = space ? [32] : toCodes(part);
      if (!codes.length) continue;
      let w = widthOf(codes, font, size);
      if (space) { if (line.items.length) { line.items.push({ codes, font, w, space: true }); line.w += w; } continue; }
      if (line.w + w > maxW && line.items.length) push();
      if (w > maxW) { // sehr langes Wort (z. B. Adresse): Zeichenweise teilen
        let chunk = [];
        for (const c of codes) {
          if (widthOf([...chunk, c], font, size) > maxW && chunk.length) { line.items.push({ codes: chunk, font, w: widthOf(chunk, font, size) }); line.w += widthOf(chunk, font, size); push(); chunk = []; }
          chunk.push(c);
        }
        codes.length = 0; codes.push(...chunk); w = widthOf(codes, font, size);
      }
      line.items.push({ codes, font, w }); line.w += w;
    }
  }
  if (line.items.length || !lines.length) push();
  return lines;
}

// ---------- Dokument ----------
const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 56, TOP = 62, BOTTOM = 66;
const CW = PAGE_W - 2 * MARGIN;
const GREY = (g) => `${g} ${g} ${g}`;

class Doc {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.page = []; this.pages.push(this.page); this.y = PAGE_H - TOP; }
  need(h) { if (this.y - h < BOTTOM && this.y < PAGE_H - TOP - 1) this.newPage(); }
  op(s) { this.page.push(s); }
  /** Zeile mit Grundlinie bei y zeichnen */
  drawLine(line, x, baseline, size, color = '0.12 0.11 0.10') {
    let cx = x;
    for (const it of line.items) {
      if (!it.space) this.op(`${color} rg BT /${it.font} ${num(size)} Tf 1 0 0 1 ${num(cx)} ${num(baseline)} Tm ${pdfString(it.codes)} Tj ET`);
      cx += it.w;
    }
  }
  rect(x, y, w, h, fill, stroke) {
    this.op(`${fill ? `${fill} rg ` : ''}${stroke ? `${stroke} RG 0.5 w ` : ''}${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  gap(h) { this.y -= h; }
}

function drawText(doc, lines, x, size, lead, color) {
  for (const line of lines) {
    doc.need(lead);
    doc.drawLine(line, x, doc.y - size, size, color);
    doc.y -= lead;
  }
}

function drawTable(doc, b) {
  const rows = b.rows;
  const cols = Math.max(...rows.map(r => r.length));
  const pad = 4, size = 9.5, lead = size * 1.35;
  const spanRows = rows.map(r => Array.from({ length: cols }, (_, c) => spans(r[c] ?? '')));
  const natural = Array(cols).fill(0), longest = Array(cols).fill(0);
  spanRows.forEach((r, ri) => r.forEach((cell, c) => {
    const font = b.header && ri === 0 ? 'F2' : 'F1';
    const text = cell.map(s => s.t).join('');
    natural[c] = Math.max(natural[c], widthOf(toCodes(text), font, size));
    for (const word of text.split(/\s+/)) longest[c] = Math.max(longest[c], widthOf(toCodes(word), font, size));
  }));
  const want = natural.map(n => n + 2 * pad + 2);
  const min = longest.map(l => Math.min(l + 2 * pad + 2, CW / cols));
  let widths;
  const sum = want.reduce((a, v) => a + v, 0);
  if (sum <= CW) widths = want.map(w => w * CW / sum);
  else {
    const free = Math.max(0, CW - min.reduce((a, v) => a + v, 0));
    const extra = want.map((w, i) => Math.max(0, w - min[i]));
    const es = extra.reduce((a, v) => a + v, 0) || 1;
    widths = min.map((m, i) => m + free * extra[i] / es);
  }
  const maxLines = Math.floor((PAGE_H - TOP - BOTTOM - 2 * pad) / lead);
  const layout = spanRows.map((r, ri) => {
    const cellLines = r.map((cell, c) => wrap(cell, widths[c] - 2 * pad, size, b.header && ri === 0 ? 'F2' : 'F1').slice(0, maxLines));
    return { cellLines, h: Math.max(...cellLines.map(l => l.length)) * lead + 2 * pad };
  });
  const drawRow = (row, header) => {
    doc.need(row.h);
    const top = doc.y;
    let x = MARGIN;
    row.cellLines.forEach((lines, c) => {
      doc.rect(x, top - row.h, widths[c], row.h, header ? '0.93 0.90 0.86' : null, '0.72 0.70 0.66');
      lines.forEach((line, li) => doc.drawLine(line, x + pad, top - pad - size - li * lead + 1, size));
      x += widths[c];
    });
    doc.y -= row.h;
  };
  layout.forEach((row, ri) => {
    if (doc.y - row.h < BOTTOM && b.header && ri > 0) { doc.newPage(); drawRow(layout[0], true); }
    drawRow(row, b.header && ri === 0);
  });
  doc.gap(10);
}

function render(markdown) {
  const doc = new Doc();
  const SIZE = 11, LEAD = SIZE * 1.42;
  const list = blocks(answerOnly(markdown));
  let title = '';
  for (let bi = 0; bi < list.length; bi++) {
    const b = list[bi];
    if (b.type === 'h') {
      const size = [0, 21, 16.5, 13.5, 12][b.level];
      if (!title) title = plainInline(b.text);
      if (doc.y < PAGE_H - TOP - 1) doc.gap(size * (b.level === 1 ? 0.7 : 0.9));
      doc.need(size * 1.5 + 44);
      drawText(doc, wrap(spans(b.text), CW, size, 'F2'), MARGIN, size, size * 1.3, '0.10 0.09 0.08');
      if (b.level === 1) { doc.rect(MARGIN, doc.y - 1, 60, 2, '0.76 0.37 0.24'); doc.gap(8); } else doc.gap(size * 0.25);
    } else if (b.type === 'p') {
      for (const l of b.lines) drawText(doc, wrap(spans(l), CW, SIZE), MARGIN, SIZE, LEAD);
      doc.gap(6);
    } else if (b.type === 'li') {
      const x0 = MARGIN + b.level * 16;
      const marker = b.ordered ? toCodes(b.marker) : [b.level ? 150 : 149];
      const mw = Math.max(16, widthOf(marker, 'F1', SIZE) + 5);
      const lines = wrap(spans(b.text), CW - b.level * 16 - mw, SIZE);
      lines.forEach((line, li) => {
        doc.need(LEAD);
        if (li === 0) doc.drawLine({ items: [{ codes: marker, font: 'F1', w: 0 }] }, x0, doc.y - SIZE, SIZE);
        doc.drawLine(line, x0 + mw, doc.y - SIZE, SIZE);
        doc.y -= LEAD;
      });
      doc.gap(2.5);
      if (list[bi + 1]?.type !== 'li') doc.gap(4);
    } else if (b.type === 'code') {
      const size = 9, lead = 12.4, pad = 6;
      const maxChars = Math.floor((CW - 2 * pad) / (size * 0.6));
      const rows = [];
      for (const l of b.lines) {
        const codes = toCodes(l);
        if (!codes.length) rows.push([]);
        for (let i = 0; i < codes.length; i += maxChars) rows.push(codes.slice(i, i + maxChars));
      }
      doc.need(lead * Math.min(rows.length, 4) + 2 * pad);
      doc.rect(MARGIN, doc.y - pad, CW, pad, '0.95 0.94 0.92');
      doc.gap(pad);
      for (const codes of rows) {
        if (doc.y - lead < BOTTOM) { doc.newPage(); doc.rect(MARGIN, doc.y - lead, CW, lead, '0.95 0.94 0.92'); } else doc.rect(MARGIN, doc.y - lead, CW, lead + 0.4, '0.95 0.94 0.92');
        if (codes.length) doc.drawLine({ items: [{ codes, font: 'F3', w: 0 }] }, MARGIN + pad, doc.y - size - 1.5, size, '0.15 0.14 0.13');
        doc.y -= lead;
      }
      doc.rect(MARGIN, doc.y - pad, CW, pad, '0.95 0.94 0.92');
      doc.gap(pad + 8);
    } else if (b.type === 'table') {
      if (b.rows.length) drawTable(doc, b);
    } else if (b.type === 'quote') {
      const start = doc.y, startPage = doc.page;
      for (const l of b.lines) drawText(doc, wrap(spans(l), CW - 14, SIZE, 'F1').map(x => x), MARGIN + 14, SIZE, LEAD, '0.35 0.33 0.30');
      if (doc.page === startPage) doc.rect(MARGIN + 2, doc.y + 2, 2.5, start - doc.y - 2, '0.76 0.74 0.70');
      doc.gap(8);
    } else if (b.type === 'hr') {
      doc.need(14);
      doc.gap(5);
      doc.op(`0.8 0.78 0.74 RG 0.7 w ${num(MARGIN)} ${num(doc.y)} m ${num(PAGE_W - MARGIN)} ${num(doc.y)} l S`);
      doc.gap(9);
    }
  }
  return { doc, title };
}

/** Markdown → Uint8Array (.pdf) */
export function pdfBytes(markdown) {
  const { doc, title } = render(markdown);
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    const label = toCodes(`Seite ${i + 1} von ${total}`);
    const w = widthOf(label, 'F1', 9);
    ops.push(`0.55 0.53 0.50 rg BT /F1 9 Tf 1 0 0 1 ${num((PAGE_W - w) / 2)} 32 Tm ${pdfString(label)} Tj ET`);
  });

  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${doc.pages.map((_, i) => `${8 + i * 2} 0 R`).join(' ')}] /Count ${total} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  add(`<< /Title ${pdfString(toCodes(title || 'Dokument'))} /Producer (AI Core) /Creator (AI Core) >>`);
  doc.pages.forEach((ops, i) => {
    const stream = ops.join('\n');
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${9 + i * 2} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}

export const buildPdf = (markdown) => new Blob([pdfBytes(markdown)], { type: PDF_MIME });
