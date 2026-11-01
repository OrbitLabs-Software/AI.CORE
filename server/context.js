// context.js — baut aus dem Chatverlauf den Kontext für das Modell:
//  * Dateitexte aus Anhängen werden an die jeweilige Nachricht gehängt,
//  * der Verlauf wird auf das Token-Budget des Modells gekürzt,
//  * Bilder gehen nur an Modelle, die Bilder lesen können.

const CHARS_PER_TOKEN = 3.2; // grobe Schätzung für deutschen Text
export const approxTokens = (s) => Math.ceil(String(s ?? '').length / CHARS_PER_TOKEN);

export const stripThink = (t) => String(t ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

export const isVisionModel = (name) =>
  /(llava|vision|minicpm-v|moondream|gemma3|qwen2\.5vl|qwen3-vl|[-_]vl\b|bakllava|deepseek-(flash|v4)|claude|gpt-[45]|gemini)/i.test(name || '');

const MAX_ATTACHMENT_CHARS = 60000;
const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 60000;

function parseDataUrl(url) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url || '');
  return m ? { mime: m[1], data: m[2] } : null;
}

function withAttachments(content, attachments, charBudget) {
  const texts = (attachments || []).filter(a => typeof a?.text === 'string' && a.text.trim());
  if (!texts.length) return content;
  const perFile = Math.max(400, Math.floor(charBudget / texts.length));
  const blocks = texts.map(a => {
    const name = String(a.name || 'Datei').slice(0, 120);
    const body = a.text.slice(0, Math.min(MAX_ATTACHMENT_CHARS, perFile));
    const cut = a.text.length > body.length ? '\n[… gekürzt …]' : '';
    return `[Anhang: ${name}]\n${body}${cut}\n[Ende Anhang]`;
  });
  return `${content}\n\n${blocks.join('\n\n')}`;
}

/**
 * @param {Array}  messages     [{role, content, attachments?:[{name,text,image}]}]
 * @param {number} budgetTokens Platz für Verlauf (ohne Systemprompt und Antwort)
 * @param {string} model        Modellname (für Bild-Fähigkeit)
 */
export function buildContext({ messages, budgetTokens, model }) {
  const clean = (messages || []).slice(-MAX_MESSAGES).map(m => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: String(m?.content ?? '').slice(0, MAX_CONTENT_CHARS),
    attachments: m?.role === 'assistant' ? [] : (Array.isArray(m?.attachments) ? m.attachments.slice(0, 8) : []),
  }));

  const notices = [];
  const vision = isVisionModel(model);
  const lastIdx = clean.length - 1;
  const charBudget = Math.max(800, Math.floor(budgetTokens * CHARS_PER_TOKEN));

  const prepared = clean.map((m, i) => {
    if (m.role === 'assistant') return { role: 'assistant', content: stripThink(m.content) };
    const isLast = i === lastIdx;
    // Anhänge nur für die letzten zwei Nutzernachrichten voll mitschicken (spart Kontext)
    const recentUser = i >= lastIdx - 2;
    let content = recentUser
      ? withAttachments(m.content, m.attachments, Math.max(400, charBudget - m.content.length - 200))
      : m.content;

    const images = [];
    for (const a of m.attachments) {
      if (!a?.image) continue;
      if (isLast && vision) {
        const parsed = parseDataUrl(a.image);
        if (parsed) images.push(parsed);
      } else if (isLast) {
        content += `\n\n[Bild angehängt: ${String(a.name || 'Bild').slice(0, 80)} — dieses Modell kann keine Bilder ansehen.]`;
        if (!notices.includes('images_ignored')) notices.push('images_ignored');
      }
    }
    return images.length ? { role: 'user', content, images } : { role: 'user', content };
  });

  // Von hinten auffüllen, bis das Budget erreicht ist.
  let used = 0;
  const kept = [];
  for (let i = prepared.length - 1; i >= 0; i--) {
    const cost = approxTokens(prepared[i].content) + 8;
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.unshift(prepared[i]);
    used += cost;
  }
  // Letzte Nachricht zu groß? Hart auf das Budget kürzen.
  if (kept.length === 1 && used > budgetTokens) {
    kept[0].content = kept[0].content.slice(0, charBudget) + '\n[… gekürzt …]';
  }
  // Der Verlauf muss mit einer Nutzernachricht beginnen.
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();

  return { messages: kept, trimmed: kept.length < prepared.length, dropped: prepared.length - kept.length, notices };
}
