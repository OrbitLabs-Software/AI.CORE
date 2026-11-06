// openai.js — Übersetzung zwischen der OpenAI-Schnittstelle (/v1/chat/completions) und AI Core. Reine Funktionen.
import crypto from 'crypto';

export const parseApiKeys = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean).map((s, i) => {
  const at = s.indexOf(':');
  return at > 0 && at < 40 ? { name: s.slice(0, at), key: s.slice(at + 1) } : { name: `key${i + 1}`, key: s };
}).filter(k => k.key.length >= 16);

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
/** Prüft „Authorization: Bearer …“ gegen die Schlüssel; gibt den Namen des Schlüssels oder null zurück. */
export function checkApiKey(header, keys) {
  const m = /^Bearer\s+(\S+)$/i.exec(header || '');
  if (!m) return null;
  const given = digest(m[1]);
  let found = null;
  for (const k of keys) if (crypto.timingSafeEqual(given, digest(k.key))) found = k.name;
  return found;
}

export const errorBody = (message, type = 'invalid_request_error', code = null) => ({ error: { message, type, code } });
export const estimateTokens = (s) => Math.ceil(String(s || '').length / 3.5);

/** OpenAI-Anfrage -> { system, messages, model, temperature, stream, includeUsage } oder { error }. */
export function toInternal(body) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return { error: '„messages“ fehlt oder ist leer.' };
  if (body.messages.length > 200) return { error: 'Zu viele Nachrichten (höchstens 200).' };
  if (Array.isArray(body.tools) && body.tools.length) return { error: 'AI Core unterstützt keine Werkzeugaufrufe („tools“). Bitte ohne senden.' };
  const system = [], messages = [];
  for (const m of body.messages) {
    if (!m || typeof m !== 'object') return { error: 'Ungültige Nachricht.' };
    let text = '';
    const attachments = [];
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === 'text' && typeof part.text === 'string') text += (text ? '\n' : '') + part.text;
        else if (part?.type === 'image_url' && /^data:image\/(png|jpe?g|webp);base64,/.test(part.image_url?.url || '')) attachments.push({ name: 'Bild', image: part.image_url.url });
      }
    } else if (m.content != null) return { error: 'Ungültiger Inhalt.' };
    if (m.role === 'system' || m.role === 'developer') system.push(text);
    else if (m.role === 'user') messages.push({ role: 'user', content: text, ...(attachments.length ? { attachments } : {}) });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: text });
    else return { error: `Rolle „${String(m.role).slice(0, 20)}“ wird nicht unterstützt.` };
  }
  if (!messages.length || messages.at(-1).role !== 'user') return { error: 'Die letzte Nachricht muss vom Nutzer („user“) sein.' };
  const t = Number(body.temperature);
  return {
    system: system.join('\n\n').trim().slice(0, 30000) || undefined,
    messages,
    model: typeof body.model === 'string' && body.model && body.model !== 'default' ? body.model.slice(0, 120) : undefined,
    temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : undefined,
    stream: body.stream === true,
    includeUsage: body.stream_options?.include_usage === true,
  };
}

/** Entfernt <think>…</think> auch dann, wenn die Markierungen über mehrere Stücke verteilt ankommen. */
export function createThinkFilter() {
  let inThink = false, buf = '';
  const OPEN = '<think>', CLOSE = '</think>';
  const partial = (s, tag) => { for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n; return 0; };
  const push = (delta, final = false) => {
    buf += delta;
    let out = '';
    for (;;) {
      if (inThink) {
        const i = buf.indexOf(CLOSE);
        if (i < 0) { buf = final ? '' : buf.slice(buf.length - partial(buf, CLOSE)); return out; }
        buf = buf.slice(i + CLOSE.length).replace(/^\s+/, ''); inThink = false;
      } else {
        const i = buf.indexOf(OPEN);
        if (i < 0) { const keep = final ? 0 : partial(buf, OPEN); out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); return out; }
        out += buf.slice(0, i); buf = buf.slice(i + OPEN.length); inThink = true;
      }
    }
  };
  return { push, end: () => push('', true) };
}

export const completionId = () => `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
export const chunk = ({ id, created, model, content, role, finish = null, usage }) => ({
  id, object: 'chat.completion.chunk', created, model,
  choices: [{ index: 0, delta: { ...(role ? { role } : {}), ...(content != null ? { content } : {}) }, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});
export const completion = ({ id, created, model, text, usage }) => ({
  id, object: 'chat.completion', created, model,
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage,
});
export const modelList = (ids, created = Math.floor(Date.now() / 1000)) => ({ object: 'list', data: ids.map(id => ({ id, object: 'model', created, owned_by: 'ai-core' })) });
