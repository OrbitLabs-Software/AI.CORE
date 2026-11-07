// dataview.js — Tabellen-Ansicht: Spalten mit Typ, Kennzahlen und kleinen Diagrammen, dazu die ersten Zeilen.
import { openModal } from '../components/modal.js';
import { escapeHtml } from './ui.js';
import { parseDelimited, profile, describeColumn } from './dataprofile.js';

const bars = (counts) => {
  const max = Math.max(1, ...counts);
  return `<div class="mini-bars">${counts.map(n => `<i style="height:${Math.max(3, Math.round(n / max * 100))}%" title="${n}"></i>`).join('')}</div>`;
};
const topBars = (top) => {
  const max = Math.max(1, ...top.map(t => t[1]));
  return `<div class="top-bars">${top.map(([v, n]) => `<div><span>${escapeHtml(String(v).slice(0, 28))}</span><i style="width:${Math.round(n / max * 100)}%"></i><b>${n}</b></div>`).join('')}</div>`;
};

export function openDataDialog({ name, text }) {
  const table = parseDelimited(text);
  const prof = profile(table);
  const root = document.createElement('div');
  root.className = 'data-dialog';
  const head = `<div class="settings-row-sub"><b>${prof.rows.toLocaleString('de-AT')}${table.truncated ? '+' : ''}</b> Zeilen · <b>${table.header.length}</b> Spalten${table.truncated ? ' (nur die ersten 50 000 Zeilen ausgewertet)' : ''}</div>`;
  const cols = prof.cols.map(c => `
    <div class="col-card">
      <div class="col-head"><b>${escapeHtml(c.name)}</b><span class="badge">${c.type}</span></div>
      <div class="col-stat">${escapeHtml(describeColumn(c).replace(/^.*?\): /, '').replace(/^.*?\((.*?)\)$/, '$1'))}${c.missing ? `<br><small>${c.missing} fehlende Werte</small>` : ''}</div>
      ${c.hist ? bars(c.hist) : c.top?.length ? topBars(c.top) : ''}
    </div>`).join('');
  const rows = table.rows.slice(0, 12);
  root.innerHTML = `${head}
    <div class="group-title">Spalten</div><div class="col-grid">${cols}</div>
    <div class="group-title">Erste Zeilen</div>
    <div class="table-wrap"><table><thead><tr>${table.header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${escapeHtml(v.slice(0, 60))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="settings-row-sub">Die KI bekommt bei großen Tabellen diese Zusammenfassung statt aller Zeilen.</div>`;
  openModal({ title: escapeHtml(name), tabs: { main: { label: 'Tabelle', render: () => root } } });
}
