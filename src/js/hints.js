// hints.js — erkennt Sätze, die man sich merken sollte, und Merk-Befehle.

const FACT_START = /^(ich\s+(heiße|heisse|bin|wohne|arbeite|studiere|lebe|mag|liebe|hasse|benutze|nutze|programmiere|spiele|habe|besitze|lerne|trinke|esse)\b|mein(e|en|em|er)?\s+\S+(\s+\S+)?\s+(ist|heißt|heisst|sind|lautet)\b|ich\s+bevorzuge\b|ich\s+möchte\s+(immer|nie)\b)/i;
const REMEMBER_CMD = /^\s*(?:(?:bitte\s+)?(?:merk|merke)\s+(?:dir|es\s+dir)|erinnere\s+dich(?:\s+daran)?|remember)\s*[:,]?\s*(?:dass|that)?\s*(.+)$/is;

/** Erster Satz der Nachricht, der wie ein dauerhafter Fakt klingt (oder null). */
export function suggestMemory(text) {
  const t = String(text ?? '').trim();
  if (t.length < 12 || t.length > 400 || t.includes('?')) return null;
  const sentence = t.split(/(?<=[.!])\s+/)[0].replace(/[.!]+$/, '').trim();
  if (sentence.length < 10 || sentence.length > 220) return null;
  return FACT_START.test(sentence) ? sentence : null;
}

/** "Merk dir, dass ich Vegetarier bin" → "ich Vegetarier bin" … nur der Rest nach dem Befehl. */
export function parseRememberCommand(text) {
  const m = REMEMBER_CMD.exec(String(text ?? ''));
  if (!m) return null;
  const rest = m[1].trim().replace(/[.!]+$/, '');
  return rest.length >= 3 ? rest : null;
}
