// whatsnew.js — „Neu in AI Core 4.0“, wird einmal nach dem Update gezeigt (und mit /neu).
import { openModal } from '../components/modal.js';

export const WHATS_NEW_VERSION = '4.0';
const ITEMS = [
  ['🧭', 'Aufgeräumter Chat', 'Rolle, Suche und Stil stehen jetzt im Werkzeug-Menü unter dem Eingabefeld. Aktive Einstellungen siehst du als Chips. Die obere Leiste ist ruhiger.'],
  ['🔄', 'Abgleich zwischen Geräten', 'Handy und Computer zeigen denselben Stand. Du schaltest es selbst unter Einstellungen → Abgleich ein.'],
  ['🗑️', 'Papierkorb', 'Gelöschte Chats bleiben 30 Tage im Papierkorb und lassen sich wiederherstellen.'],
  ['📊', 'Tabellen verstehen', 'CSV-Dateien zeigen Spalten, Kennzahlen und Diagramme. Große Tabellen gehen als Zusammenfassung ans Modell, das macht Antworten besser.'],
  ['⚙️', 'Übersichtliche Einstellungen', 'Die Einstellungen haben eine Seitenleiste mit Gruppen statt zehn Reitern.'],
  ['🏠', 'Neue Startseite', 'Schnellstart-Kacheln für Recherche, Schreiben, Code, Daten, Sprache und Bilder, dazu „Weitermachen“ mit deinen letzten Chats und Projekten.'],
];

export function showWhatsNew() {
  const root = document.createElement('div');
  root.className = 'whatsnew';
  root.innerHTML = `<p class="settings-row-sub">Version 4.0 ist die größte Überarbeitung bisher: übersichtlicher und mit neuen Funktionen für den Alltag.</p>
    ${ITEMS.map(([i, t, d]) => `<div class="wn-item"><span class="wn-icon" aria-hidden="true">${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    <p class="settings-row-sub">Tipp: <kbd>Strg</kbd>+<kbd>/</kbd> öffnet die Befehlspalette. Mit <code>/neu</code> siehst du diese Seite wieder.</p>`;
  openModal({ title: 'Neu in AI Core 4.0', tabs: { main: { label: 'Neu', render: () => root } } });
}
