// xlsx.js — Tabellen als Excel-Datei (.xlsx), ohne Bibliothek.
// Eingabe: CSV (; , Tab |), Markdown-Tabelle oder JSON. Mehrere Blätter mit „=== Blatt: Name ===“.
// Zahlen, Prozent, Euro und Formeln (auch deutsche Namen wie SUMME) werden erkannt.
import { makeZip } from './zip.js';
import { tablesOf } from './mdblocks.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const RNS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const MAX_ROWS = 50000;
const MAX_COLS = 200;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colName(i) { // 0 → A, 26 → AA
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------- Eingabe lesen ----------
const SHEET_MARK = /^\s*(?:={2,}|-{3,}|#{1,3})\s*(?:Blatt|Sheet|Tabelle)\s*:?\s*(.+?)\s*(?:={2,}|-{3,})?\s*$/i;
const SHEET_MARK_ALT = /^\s*={3,}\s*(.+?)\s*={3,}\s*$/;

/** Trennzeichen erkennen: nimmt das, das in allen Probezeilen gleich oft vorkommt. */
export function detectDelimiter(text) {
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 6);
  let best = null;
  for (const d of [';', '\t', '|', ',']) {
    const counts = lines.map(l => countOutsideQuotes(l, d));
    const min = Math.min(...counts);
    if (min > 0 && (!best || min > best.min)) best = { d, min };
  }
  return best?.d || null;
}
function countOutsideQuotes(line, d) {
  let q = false, n = 0;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
  return n;
}

/** CSV mit Anführungszeichen („a;b“ und "" als Escape). */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false;
  const src = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (delim && ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => mergeFormulaCells(r, delim)).filter(r => r.some(c => String(c).trim() !== ''));
}

/** „=SUMME(B2;B3)“ in einer Datei mit „;“ als Trenner: zerschnittene Formeln wieder zusammensetzen. */
function mergeFormulaCells(row, delim) {
  if (!delim) return row;
  const out = [];
  for (let i = 0; i < row.length; i++) {
    let c = row[i];
    if (/^\s*=/.test(c)) {
      while ((c.match(/\(/g) || []).length > (c.match(/\)/g) || []).length && i + 1 < row.length) c += delim + row[++i];
    }
    out.push(c);
  }
  return out;
}

function rowsFromJson(v) {
  if (Array.isArray(v)) {
    if (v.length && v.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
      const keys = [...new Set(v.flatMap(r => Object.keys(r)))];
      return [keys, ...v.map(r => keys.map(k => r[k] ?? ''))];
    }
    return v.map(r => Array.isArray(r) ? r : [r]);
  }
  return [];
}

/** Text → [{ name, rows: string|number[][] }] */
export function parseSheets(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  if (/^[[{]/.test(text)) {
    try {
      const j = JSON.parse(text);
      const list = Array.isArray(j?.sheets) ? j.sheets : Array.isArray(j) || Array.isArray(j?.rows) || Array.isArray(j?.data) ? [{ rows: Array.isArray(j) ? j : j.rows || j.data, name: j.name }] : [];
      const sheets = list.map((s, i) => ({ name: s.name || s.title || `Tabelle${i + 1}`, rows: rowsFromJson(s.rows || s.data || []) })).filter(s => s.rows.length);
      if (sheets.length) return sheets;
    } catch { /* kein JSON — als Text weiter */ }
  }
  // In Abschnitte (Blätter) teilen
  const sections = [];
  let cur = { name: '', lines: [] };
  for (const line of text.split('\n')) {
    const m = SHEET_MARK.exec(line) || SHEET_MARK_ALT.exec(line);
    if (m) { if (cur.lines.some(l => l.trim())) sections.push(cur); cur = { name: m[1].replace(/[=\-#]+$/, '').trim(), lines: [] }; } else cur.lines.push(line);
  }
  if (cur.lines.some(l => l.trim()) || !sections.length) sections.push(cur);

  return sections.map((s, i) => {
    const body = s.lines.join('\n').trim();
    let rows;
    if (/^\s*\|/.test(body)) {
      const t = tablesOf(body)[0];
      rows = t ? t.rows : [];
    } else {
      const delim = detectDelimiter(body);
      rows = parseDelimited(body, delim);
    }
    return { name: s.name || `Tabelle${i + 1}`, rows };
  }).filter(s => s.rows.length);
}

/** Alle Markdown-Tabellen einer Antwort als Blätter. */
export function sheetsFromMarkdown(md) {
  return tablesOf(md).map((t, i) => ({ name: t.name || `Tabelle${i + 1}`, rows: t.rows }));
}

// ---------- Zellen ----------
const FUNCS = { SUMME: 'SUM', MITTELWERT: 'AVERAGE', ANZAHL2: 'COUNTA', ANZAHL: 'COUNT', WENN: 'IF', RUNDEN: 'ROUND', PRODUKT: 'PRODUCT', HEUTE: 'TODAY', JETZT: 'NOW', SUMMEWENN: 'SUMIF', ZÄHLENWENN: 'COUNTIF', ZAEHLENWENN: 'COUNTIF', MEDIAN: 'MEDIAN', WURZEL: 'SQRT', BETRAG: 'ABS', VERKETTEN: 'CONCATENATE', LINKS: 'LEFT', RECHTS: 'RIGHT', TEIL: 'MID', LÄNGE: 'LEN', LAENGE: 'LEN', UND: 'AND', ODER: 'OR', NICHT: 'NOT', SVERWEIS: 'VLOOKUP' };

/** =SUMME(B2;B3) → SUM(B2,B3): englische Namen, Komma als Trenner (außerhalb von Texten). */
export function normalizeFormula(f) {
  let out = '', q = false;
  const s = String(f).replace(/^=/, '').trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { q = !q; out += ch; } else if (!q && ch === ';') out += ',';
    else out += ch;
  }
  return out.replace(/([A-ZÄÖÜ][A-ZÄÖÜ0-9]*)\s*\(/gi, (m, name) => (FUNCS[name.toUpperCase()] ? `${FUNCS[name.toUpperCase()]}(` : m));
}

/** { kind: 'n'|'s'|'f'|'e', v, style } — style: 2 = 0 %, 3 = 0,00 %, 4 = Euro */
export function toCell(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'n', v: raw, style: 0 };
  if (typeof raw === 'boolean') return { kind: 's', v: raw ? 'WAHR' : 'FALSCH', style: 0 };
  const t = String(raw ?? '').trim();
  if (t === '') return { kind: 'e' };
  if (/^=.{1,}/.test(t)) return { kind: 'f', v: normalizeFormula(t), style: 0 };
  const pct = /^(-?\d+(?:[.,]\d+)?)\s?%$/.exec(t);
  if (pct) { const n = Number(pct[1].replace(',', '.')); return { kind: 'n', v: n / 100, style: /[.,]/.test(pct[1]) ? 3 : 2 }; }
  const eur = /^(?:€\s?)?(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s?(?:€|EUR)?$/.exec(t);
  if (eur && /€|EUR/.test(t)) return { kind: 'n', v: Number(eur[1].replace(/\./g, '').replace(',', '.')), style: 4 };
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return { kind: 'n', v: Number(t.replace(/\./g, '').replace(',', '.')), style: 0 };
  if (/^-?(?:0|[1-9]\d{0,14})(?:[.,]\d+)?$/.test(t)) return { kind: 'n', v: Number(t.replace(',', '.')), style: 0 };
  return { kind: 's', v: clean(t), style: 0 };
}

const safeSheetName = (name, used) => {
  let n = String(name || 'Tabelle').replace(/[[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Tabelle';
  let k = 2;
  const base = n;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
};

function sheetXml(rows, selected) {
  rows = rows.slice(0, MAX_ROWS).map(r => r.slice(0, MAX_COLS));
  const cells = rows.map(r => r.map(toCell));
  const first = cells[0] || [];
  const textCells = first.filter(c => c.kind === 's').length;
  const header = cells.length >= 2 && textCells >= Math.max(1, Math.ceil(first.filter(c => c.kind !== 'e').length / 2)) && first.every(c => c.kind === 's' || c.kind === 'e');
  const cols = Math.max(1, ...cells.map(r => r.length));
  const widths = Array.from({ length: cols }, (_, c) => {
    let w = 8;
    for (const r of cells) {
      const cell = r[c];
      if (!cell || cell.kind === 'e') continue;
      const len = cell.kind === 'f' ? 12 : String(cell.v).length + (cell.style === 4 ? 4 : 0);
      w = Math.max(w, len + 2);
    }
    return Math.min(60, w);
  });
  let data = '';
  cells.forEach((r, ri) => {
    let row = '';
    r.forEach((c, ci) => {
      if (c.kind === 'e') return;
      const ref = `${colName(ci)}${ri + 1}`;
      const s = header && ri === 0 ? 1 : c.style;
      const sAttr = s ? ` s="${s}"` : '';
      if (c.kind === 'n') row += `<c r="${ref}"${sAttr}><v>${c.v}</v></c>`;
      else if (c.kind === 'f') row += `<c r="${ref}"${sAttr}><f>${esc(c.v)}</f></c>`;
      else row += `<c r="${ref}" t="inlineStr"${sAttr}><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
    });
    data += `<row r="${ri + 1}">${row}</row>`;
  });
  const lastRef = `${colName(cols - 1)}${Math.max(1, cells.length)}`;
  const pane = header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>' : '';
  return `${X}<worksheet ${NS} ${RNS}><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData></worksheet>`;
}

const STYLES = `${X}<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC15F3C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** sheets: [{ name, rows }] → Uint8Array (.xlsx) */
export function xlsxBytes(sheets) {
  const list = (sheets || []).filter(s => s.rows?.length);
  if (!list.length) list.push({ name: 'Tabelle1', rows: [['']] });
  const used = new Set();
  const named = list.map(s => ({ ...s, name: safeSheetName(s.name, used) }));
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    { name: '[Content_Types].xml', content: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', content: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `${X}<workbook ${NS} ${RNS}><bookViews><workbookView/></bookViews><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.rows, i === 0) })),
  ];
  return makeZip(files);
}

export function buildXlsx(input) {
  const sheets = Array.isArray(input) ? input : parseSheets(input);
  return new Blob([xlsxBytes(sheets)], { type: XLSX_MIME });
}
