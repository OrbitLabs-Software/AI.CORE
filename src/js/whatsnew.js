// whatsnew.js — „Neu in AI Core 5.0“, wird einmal nach dem Update gezeigt (und mit /neu).
import { openModal } from '../components/modal.js';

export const WHATS_NEW_VERSION = '5.0';
const ITEMS = [
  ['📚', 'Bibliothek', 'Lade Dokumente einmal hoch und lass sie in jedem Chat durchsuchen. Die KI antwortet mit passenden Abschnitten und nennt die Quelle. Einschalten im Werkzeug-Menü.'],
  ['🔗', 'Links lesen', 'Schick einen Link in deiner Nachricht, und AI Core liest die Seite und fasst sie zusammen oder beantwortet Fragen dazu.'],
  ['🧩', 'Diagramme', 'Mermaid-Diagramme in Antworten haben jetzt eine Vorschau, zum Beispiel Abläufe, Organigramme und Zeitpläne.'],
  ['⚙️', 'Modelle und Meldungen (Besitzer)', 'Neue Modelle laden und alte löschen, ohne ins Terminal zu müssen. Dazu die letzten Server-Meldungen auf einen Blick.'],
  ['✨', 'Titel und Folgefragen', 'Optional: Die KI vergibt Chat-Titel und schlägt Folgefragen vor. Einschalten unter Einstellungen → Allgemein.'],
  ['📝', 'Ganzer Chat als Word', 'Im Menü „⋯“ speicherst du einen Chat als Word-Datei.'],
];

export function showWhatsNew() {
  const root = document.createElement('div');
  root.className = 'whatsnew';
  root.innerHTML = `<p class="settings-row-sub">Version 5.0 bringt Wissen in deine Chats: Dokumente, Links und Diagramme.</p>
    ${ITEMS.map(([i, t, d]) => `<div class="wn-item"><span class="wn-icon" aria-hidden="true">${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    <p class="settings-row-sub">Tipp: <kbd>Strg</kbd>+<kbd>/</kbd> öffnet die Befehlspalette. Mit <code>/neu</code> siehst du diese Seite wieder.</p>`;
  openModal({ title: 'Neu in AI Core 5.0', tabs: { main: { label: 'Neu', render: () => root } } });
}
