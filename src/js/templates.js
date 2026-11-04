// templates.js — Vorlagen für häufige Aufgaben. Platzhalter stehen in [eckigen Klammern]; eigene Vorlagen lassen sich speichern.
import { openModal } from '../components/modal.js';
import { escapeHtml, uid, showToast } from './ui.js';

export const BUILTIN = [
  { name: 'E-Mail schreiben', text: 'Schreibe eine [förmliche/freundliche] E-Mail an [Empfänger]. Anlass: [worum es geht]. Wichtig: [Kernpunkte]. Halte sie kurz.' },
  { name: 'Text zusammenfassen', text: 'Fasse den folgenden Text in [5] Stichpunkten zusammen und nenne am Ende die wichtigste Aussage:\n\n[Text einfügen]' },
  { name: 'Text korrigieren', text: 'Korrigiere Rechtschreibung, Grammatik und Zeichensetzung im folgenden Text. Ändere den Stil nicht. Zeige danach kurz, was du geändert hast:\n\n[Text einfügen]' },
  { name: 'Übersetzen', text: 'Übersetze den folgenden Text ins [Englische] und halte den Ton bei:\n\n[Text einfügen]' },
  { name: 'Einfach erklären', text: 'Erkläre mir [Thema] so, dass es ein Zehnjähriger versteht. Nimm ein Beispiel aus dem Alltag.' },
  { name: 'Pro und Contra', text: 'Stelle Pro und Contra für [Entscheidung] übersichtlich gegenüber und gib am Ende eine begründete Empfehlung.' },
  { name: 'Lernplan', text: 'Erstelle mir einen Lernplan für [Thema/Prüfung] über [4] Wochen bei [30] Minuten pro Tag. Mit Zielen pro Woche.' },
  { name: 'Rezept aus Zutaten', text: 'Ich habe: [Zutaten]. Schlage mir drei einfache Gerichte vor und schreibe das Rezept für das beste davon.' },
  { name: 'Code erklären', text: 'Erkläre mir diesen Code Zeile für Zeile und nenne mögliche Fehler:\n\n```\n[Code einfügen]\n```' },
  { name: 'Code prüfen', text: 'Prüfe diesen Code auf Fehler, Sicherheitsprobleme und unnötige Komplexität. Zeige eine verbesserte Version:\n\n```\n[Code einfügen]\n```' },
  { name: 'Bewerbungsanschreiben', text: 'Schreibe ein Bewerbungsanschreiben für die Stelle [Stelle] bei [Firma]. Meine Stärken: [Stärken]. Maximal eine Seite.' },
  { name: 'Protokoll aus Notizen', text: 'Mache aus diesen Notizen ein sauberes Protokoll mit Teilnehmern, Beschlüssen und Aufgaben (wer, was, bis wann):\n\n[Notizen einfügen]' },
  { name: 'Ideen sammeln', text: 'Sammle 10 Ideen zu [Thema]. Sortiere sie von leicht umsetzbar bis ehrgeizig und beschreibe jede in einem Satz.' },
];

/** Setzt den Text ins Eingabefeld und markiert den ersten Platzhalter. */
export function insertTemplate(textarea, setValue, text) {
  setValue(text);
  const m = /\[[^\]\n]+\]/.exec(text);
  if (m) textarea.setSelectionRange(m.index, m.index + m[0].length);
}

export function openTemplateDialog({ settings, saveSettings, currentText, onUse }) {
  const root = document.createElement('div');
  root.className = 'tpl-dialog';
  const modal = openModal({ title: 'Vorlagen', tabs: { main: { label: 'Vorlagen', render: () => root } } });
  let query = '';
  const draw = () => {
    const own = settings.templates || [];
    const match = (t) => !query || `${t.name} ${t.text}`.toLowerCase().includes(query);
    const card = (t, mine) => `<div class="tpl-card" data-id="${t.id || ''}" data-text="${escapeHtml(t.text)}"><button type="button" class="tpl-use"><b>${escapeHtml(t.name)}</b><span>${escapeHtml(t.text.slice(0, 110))}${t.text.length > 110 ? ' …' : ''}</span></button>${mine ? '<button type="button" class="mini-btn" data-del aria-label="Vorlage löschen">✕</button>' : ''}</div>`;
    root.innerHTML = `<input class="text-input" data-q placeholder="Vorlagen suchen" value="${escapeHtml(query)}">
      ${own.filter(match).length ? `<div class="group-title">Meine Vorlagen</div>${own.filter(match).map(t => card(t, true)).join('')}` : ''}
      <div class="group-title">Vorlagen</div>${BUILTIN.filter(match).map(t => card(t, false)).join('') || '<div class="note">Nichts gefunden</div>'}
      <button type="button" class="btn" data-save>Aktuellen Text im Eingabefeld als Vorlage speichern</button>`;
    const q = root.querySelector('[data-q]');
    q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); const pos = q.selectionStart; draw(); const n = root.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); });
    root.querySelectorAll('.tpl-use').forEach(b => b.addEventListener('click', () => { modal.close(); onUse(b.closest('.tpl-card').dataset.text); }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      settings.templates = own.filter(t => t.id !== b.closest('.tpl-card').dataset.id); saveSettings(); draw();
    }));
    root.querySelector('[data-save]').addEventListener('click', () => {
      const text = currentText().trim();
      if (text.length < 5) return showToast('Schreibe zuerst den Text ins Eingabefeld, den du speichern willst.');
      const name = prompt('Name der Vorlage:', text.slice(0, 30));
      if (!name?.trim()) return;
      settings.templates = [...own, { id: uid(), name: name.trim().slice(0, 40), text: text.slice(0, 4000) }];
      saveSettings(); draw();
    });
  };
  draw();
}
