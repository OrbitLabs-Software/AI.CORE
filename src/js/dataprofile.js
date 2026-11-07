// dataprofile.js — Tabellen (CSV/TSV) verstehen: Trennzeichen erkennen, Spalten typisieren, Statistik und Verteilung berechnen.
// Läuft im Browser ohne Modell. Das Modell bekommt bei großen Dateien nur eine kompakte Zusammenfassung statt tausender Zeilen.

export const isTableName = (name) => /\.(csv|tsv)$/i.test(String(name || ''));
const MISSING = new Set(['', 'na', 'n/a', 'null', 'nan', '-', '--', 'none', 'k.a.', 'keine angabe']);
const BOOL = new Set(['ja', 'nein', 'true', 'false', 'yes', 'no', 'wahr', 'falsch']);

/** Zerlegt Text in Zeilen und Zellen (Anführungszeichen, "" und Zeilenumbrüche in Zellen werden verstanden). */
export function parseDelimited(text, maxRows = 50000) {
  const t = String(text).replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  let delimiter = ',', best = -1;
  for (const d of [';', ',', '\t', '|']) {
    let n = 0, q = false;
    for (const ch of first) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
    if (n > best) { best = n; delimiter = d; }
  }
  const rows = []; let row = [], cell = '', q = false, truncated = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > maxRows) { truncated = true; break; }
    } else cell += ch;
  }
  if (!truncated && (cell !== '' || row.length)) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  const header = (rows.shift() || []).map((h, i) => String(h).trim() || `Spalte ${i + 1}`);
  return { header, rows: rows.map(r => header.map((_, i) => (r[i] ?? '').trim())), delimiter, truncated };
}

/** Zahl lesen: 1.234,56 · 1,234.56 · 12,5 · 12 % · € 3,40 · 1e3. Gibt NaN zurück, wenn es keine Zahl ist. */
export function parseNumber(raw) {
  let s = String(raw).trim().replace(/[\s\u00a0]/g, '').replace(/^[€$£]|[€$£]$|%$/g, '');
  if (!/^[+-]?[\d.,]+(e[+-]?\d+)?$/i.test(s)) return NaN;
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  const groups = (sep) => new RegExp(`^[+-]?\\d{1,3}(\\${sep}\\d{3})+`).test(s);   // Tausendergruppen haben genau drei Ziffern
  if (dots && commas) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.', thousands = decimal === ',' ? '.' : ',';
    if (!new RegExp(`^[+-]?\\d{1,3}(\\${thousands}\\d{3})+\\${decimal}\\d+$`).test(s)) return NaN;
    s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (commas > 1) { if (!groups(',') || /,\d{1,2}$|,\d{4,}$/.test(s)) return NaN; s = s.replace(/,/g, ''); }
  else if (commas === 1) s = s.replace(',', '.');
  else if (dots > 1) { if (!groups('.') || /\.\d{1,2}$|\.\d{4,}$/.test(s)) return NaN; s = s.replace(/\./g, ''); }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Datum lesen: 2026-11-04 · 04.11.2026 · 4/11/2026 (Tag zuerst). Gibt Millisekunden oder NaN zurück. */
export function parseDate(raw) {
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return NaN;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function histogram(values, bins = 10) {
  const min = Math.min(...values), max = Math.max(...values), out = Array(bins).fill(0);
  if (min === max) { out[0] = values.length; return out; }
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - min) / (max - min) * bins))]++;
  return out;
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function profile(table) {
  const cols = table.header.map((name, ci) => {
    const raw = table.rows.map(r => r[ci]);
    const vals = raw.filter(v => !MISSING.has(String(v).toLowerCase()));
    const col = { name, count: vals.length, missing: raw.length - vals.length };
    const nums = vals.map(parseNumber), dates = vals.map(parseDate);
    const share = (arr) => (vals.length ? arr.filter(x => !Number.isNaN(x)).length / vals.length : 0);
    if (vals.length && vals.every(v => BOOL.has(String(v).toLowerCase()))) col.type = 'Ja/Nein';
    else if (share(nums) >= 0.9) col.type = 'Zahl';
    else if (share(dates) >= 0.9) col.type = 'Datum';
    else col.type = 'Text';
    if (col.type === 'Zahl') {
      const n = nums.filter(x => !Number.isNaN(x));
      col.min = Math.min(...n); col.max = Math.max(...n); col.mean = n.reduce((a, b) => a + b, 0) / n.length; col.median = median(n); col.sum = n.reduce((a, b) => a + b, 0);
      col.hist = histogram(n); col.unique = new Set(n).size;
    } else if (col.type === 'Datum') {
      const d = dates.filter(x => !Number.isNaN(x));
      col.min = iso(Math.min(...d)); col.max = iso(Math.max(...d)); col.hist = histogram(d); col.unique = new Set(d).size;
    } else {
      const counts = new Map();
      for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
      col.unique = counts.size;
      col.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    }
    return col;
  });
  return { rows: table.rows.length, cols };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
export const describeColumn = (c) => {
  const miss = c.missing ? `, ${c.missing} fehlen` : '';
  if (c.type === 'Zahl') return `${c.name} (Zahl${miss}): ${fmt(c.min)} bis ${fmt(c.max)}, Mittel ${fmt(c.mean)}, Median ${fmt(c.median)}, Summe ${fmt(c.sum)}`;
  if (c.type === 'Datum') return `${c.name} (Datum${miss}): ${c.min} bis ${c.max}`;
  if (c.type === 'Ja/Nein') return `${c.name} (Ja/Nein${miss}): ${(c.top || []).map(([v, n]) => `${v} ${n}×`).join(', ')}`;
  return `${c.name} (Text${miss}): ${c.unique} verschiedene Werte${c.top?.length ? `, häufig: ${c.top.slice(0, 4).map(([v, n]) => `${v.slice(0, 30)} ${n}×`).join(', ')}` : ''}`;
};

/** Kompakter Text für das Modell: Größe, Spalten mit Kennzahlen und die ersten Zeilen. */
export function summarize(table, prof, name, maxChars = 3500) {
  const head = `Tabelle „${name}“: ${prof.rows}${table.truncated ? '+' : ''} Zeilen, ${table.header.length} Spalten.${table.truncated ? ' (nur die ersten 50 000 Zeilen ausgewertet)' : ''}\nSpalten:\n`;
  const cols = prof.cols.map(c => `- ${describeColumn(c)}`).join('\n');
  const sample = `\n\nErste Zeilen (Trennzeichen „${table.delimiter === '\t' ? 'Tab' : table.delimiter}“):\n${[table.header, ...table.rows.slice(0, 8)].map(r => r.join(table.delimiter)).join('\n')}`;
  const text = head + cols;
  return (text.length > maxChars ? text.slice(0, maxChars - 20) + '\n[gekürzt]' : text + sample.slice(0, Math.max(0, maxChars - text.length))).trim();
}

/** Text für die Anfrage: kleine Tabellen komplett, große als Zusammenfassung. */
export function tableForModel(name, text, limit = 6000) {
  if (text.length <= limit) return text;
  const table = parseDelimited(text);
  if (table.header.length < 2) return text;
  return summarize(table, profile(table), name);
}
