// whatsnew.js — „Neu in AI Core 5.0“, wird einmal nach dem Update gezeigt (und mit /neu).
import { openModal } from '../components/modal.js';
import { ico } from './icons.js';

export const WHATS_NEW_VERSION = '5.0';
const ITEMS = [
  ['download', 'Apps für alle Geräte', 'Windows, macOS, Linux und als App auf iPhone, iPad und Android. Einstellungen → Apps.'],
  ['palette', 'Neues Design', 'Ruhigere Farben, weichere Flächen, größere Schrift in der Anmeldung und eine aufgeräumte Seitenleiste.'],
  ['book', 'Bibliothek', 'Lade Dokumente einmal hoch und lass sie in jedem Chat durchsuchen. Die KI nennt die Quelle. Einschalten im Werkzeug-Menü.'],
  ['link', 'Links lesen', 'Schick einen Link in deiner Nachricht, und AI Core liest die Seite und beantwortet Fragen dazu.'],
  ['diagram-project', 'Diagramme', 'Mermaid-Diagramme in Antworten haben jetzt eine Vorschau (Abläufe, Organigramme, Zeitpläne).'],
  ['gear', 'Modelle und Meldungen (Besitzer)', 'Neue Modelle laden und alte löschen, ohne ins Terminal. Dazu die letzten Server-Meldungen.'],
  ['wand-magic-sparkles', 'Titel und Folgefragen', 'Optional: Die KI vergibt Chat-Titel und schlägt Folgefragen vor (Einstellungen → Allgemein).'],
  ['terminal', 'Coder Ultimate (Pro)', 'Programmier-Agent für die Konsole und ein Linux-Testlabor, in dem Programme sicher laufen. Auch per Knopf „Linux“ an jedem Codeblock.'],
  ['file-word', 'Ganzer Chat als Word', 'Im Menü „⋯“ speicherst du einen Chat als Word-Datei.'],
];

export function showWhatsNew() {
  const root = document.createElement('div');
  root.className = 'whatsnew';
  root.innerHTML = `<p class="settings-row-sub">Version 5.0 bringt Wissen in deine Chats und ein neues Design.</p>
    ${ITEMS.map(([i, t, d]) => `<div class="wn-item"><span class="wn-icon" aria-hidden="true">${ico(i)}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    <p class="settings-row-sub">Tipp: <kbd>Strg</kbd>+<kbd>/</kbd> öffnet die Befehlspalette. Mit <code>/neu</code> siehst du diese Seite wieder.</p>`;
  openModal({ title: 'Neu in AI Core 5.0', tabs: { main: { label: 'Neu', render: () => root } } });
}
