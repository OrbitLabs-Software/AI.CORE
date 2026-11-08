// whatsnew.js — „Neu in AI Core 5.1“, wird einmal nach dem Update gezeigt (und mit /neu).
import { openModal } from '../components/modal.js';

export const WHATS_NEW_VERSION = '5.1';
const ITEMS = [
  ['⚡', 'Token-Guthaben', 'Alles kostet Token: Gratis 4 000 (neu alle 4 Stunden), Pro 10 000 (neu alle 2 Stunden). Dein Stand steht oben, die Preisliste unter Einstellungen → Pro.'],
  ['🎨', 'Neues Design', 'Ruhigere Farben, weichere Flächen, größere Schrift in der Anmeldung und eine aufgeräumte Seitenleiste.'],
  ['📚', 'Bibliothek', 'Lade Dokumente einmal hoch und lass sie in jedem Chat durchsuchen. Die KI nennt die Quelle. Einschalten im Werkzeug-Menü.'],
  ['🔗', 'Links lesen', 'Schick einen Link in deiner Nachricht, und AI Core liest die Seite und beantwortet Fragen dazu.'],
  ['🧩', 'Diagramme', 'Mermaid-Diagramme in Antworten haben jetzt eine Vorschau (Abläufe, Organigramme, Zeitpläne).'],
  ['⚙️', 'Modelle und Meldungen (Besitzer)', 'Neue Modelle laden und alte löschen, ohne ins Terminal. Dazu die letzten Server-Meldungen.'],
  ['✨', 'Titel und Folgefragen', 'Optional: Die KI vergibt Chat-Titel und schlägt Folgefragen vor (Einstellungen → Allgemein).'],
  ['📝', 'Ganzer Chat als Word', 'Im Menü „⋯“ speicherst du einen Chat als Word-Datei.'],
];

export function showWhatsNew() {
  const root = document.createElement('div');
  root.className = 'whatsnew';
  root.innerHTML = `<p class="settings-row-sub">Version 5.1 bringt ein Token-Guthaben mit Pro-Tarif.</p>
    ${ITEMS.map(([i, t, d]) => `<div class="wn-item"><span class="wn-icon" aria-hidden="true">${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    <p class="settings-row-sub">Tipp: <kbd>Strg</kbd>+<kbd>/</kbd> öffnet die Befehlspalette. Mit <code>/neu</code> siehst du diese Seite wieder.</p>`;
  openModal({ title: 'Neu in AI Core 5.1', tabs: { main: { label: 'Neu', render: () => root } } });
}
