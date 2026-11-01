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

export function buildSystem(rolePrompt, settings, project = null) {
  const style = STYLES.find(s => s.id === settings.style)?.hint || '';
  const own = String(settings.instructions || '').trim().slice(0, 1500);
  const proj = projectContext(project);
  if (!style && !own && !proj) return rolePrompt || undefined;
  return [rolePrompt || BASE, style, own && `Anweisungen des Nutzers (immer beachten): ${own}`, proj].filter(Boolean).join('\n\n');
}
