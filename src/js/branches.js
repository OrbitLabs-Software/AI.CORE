// branches.js — Gesprächszweige: Bearbeitet man eine Nachricht, bleibt die alte Fassung samt allem, was danach kam,
// als Zweig erhalten. Mit ‹ 1/2 › wechselt man zwischen den Zweigen. Die Logik ist rein (ohne Oberfläche) und testbar.
//
// Datenmodell: Die Nachricht im Chat ist der aktuelle Zweig. Die anderen stehen in message.alts als
// { no, content, attachments, tail } (tail = alle Nachrichten danach). message.no ist die Nummer des aktuellen Zweigs.

/** Vor dem Neusenden: entfernt die Nachricht und alles danach aus dem Chat und gibt ihre Zweige zurück (oder null). */
export function takeBranch(chat, messageId) {
  const i = chat.messages.findIndex(m => m.id === messageId && m.role === 'user');
  if (i < 0) return null;
  const orig = chat.messages[i];
  const tail = chat.messages.slice(i + 1);
  const alts = [...(orig.alts || []), { no: orig.no || 1, content: orig.content, attachments: orig.attachments || [], tail }];
  chat.messages = chat.messages.slice(0, i);
  return { alts, no: Math.max(...alts.map(a => a.no)) + 1 };
}

/** Nach dem Hinzufügen der neuen Nachricht: Zweige anhängen. */
export function applyBranch(message, branch) {
  if (!branch) return message;
  message.alts = branch.alts;
  message.no = branch.no;
  return message;
}

/** Position für die Anzeige: { index (1-basiert), total } oder null, wenn es nur einen Zweig gibt. */
export function branchInfo(message) {
  if (!message?.alts?.length) return null;
  const nos = [...message.alts.map(a => a.no), message.no || 1].sort((a, b) => a - b);
  return { index: nos.indexOf(message.no || 1) + 1, total: nos.length };
}

/** Wechselt zum vorherigen (-1) oder nächsten (+1) Zweig. Gibt true zurück, wenn gewechselt wurde. */
export function switchBranch(chat, messageId, dir) {
  const i = chat.messages.findIndex(m => m.id === messageId);
  const m = chat.messages[i];
  if (!m?.alts?.length) return false;
  const cur = m.no || 1;
  const candidates = m.alts.filter(a => (dir < 0 ? a.no < cur : a.no > cur));
  if (!candidates.length) return false;
  const target = candidates.reduce((best, a) => (dir < 0 ? (a.no > best.no ? a : best) : (a.no < best.no ? a : best)));
  const tail = chat.messages.splice(i + 1);
  const slot = m.alts.indexOf(target);
  m.alts[slot] = { no: cur, content: m.content, attachments: m.attachments || [], tail };
  m.content = target.content;
  m.attachments = target.attachments;
  m.no = target.no;
  chat.messages.push(...target.tail);
  return true;
}
