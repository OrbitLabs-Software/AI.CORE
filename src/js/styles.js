// styles.js — Antwortstil (wie „Stile“ bei Claude) und eigene Anweisungen. Beides wird dem Systemprompt angehängt.

export const STYLES = [
  { id: 'normal', name: 'Normal', hint: '' },
  { id: 'concise', name: 'Prägnant', hint: 'Antworte so kurz wie möglich: direkt zur Sache, keine Einleitung, keine Wiederholung.' },
  { id: 'explanatory', name: 'Erklärend', hint: 'Erkläre ausführlich und verständlich, mit Beispielen und Schritt für Schritt. Frage am Ende, ob etwas unklar ist.' },
  { id: 'formal', name: 'Formell', hint: 'Schreibe sachlich und förmlich, in vollständigen Sätzen, ohne Umgangssprache und ohne Emojis.' },
  { id: 'casual', name: 'Locker', hint: 'Schreibe locker und freundlich wie im Gespräch mit einem Bekannten, gerne mit kurzen Sätzen.' },
];

const BASE = 'Du bist AI Core, ein hilfreicher Assistent. Antworte standardmäßig auf Deutsch, klar und freundlich. Nutze Markdown für Code und Listen.';

/** Systemprompt aus Rolle, Stil und eigenen Anweisungen; undefined = Server-Standard. */
import { projectContext } from './projects.js';

export function buildSystem(rolePrompt, settings, project = null, extra = {}) {
  const style = STYLES.find(x => x.id === settings.style)?.hint || '';
  const own = String(settings.instructions || '').trim().slice(0, 1500);
  const summary = extra.summary ? `Zusammenfassung des früheren Gesprächs (die Nachrichten selbst sind nicht mehr da):\n${extra.summary}` : '';
  const search = extra.search || '';
  const budget = extra.budget || 12000;
  const proj = projectContext(project, { query: extra.query, budget: Math.max(1000, budget - search.length - summary.length) });
  if (!style && !own && !proj && !summary && !search) return rolePrompt || undefined;
  return [rolePrompt || BASE, style, own && `Anweisungen des Nutzers (immer beachten): ${own}`, summary, search, proj].filter(Boolean).join('\n\n');
}
