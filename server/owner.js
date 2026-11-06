// owner.js — Wer ist Besitzer? OWNER_UIDS, sonst die erlaubten Konten (ALLOWED_UIDS). Besitzer sehen die Server-Übersicht
// und haben keine Kontingent-Grenzen.
const list = (v) => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export const ownerIds = () => (list(process.env.OWNER_UIDS).length ? list(process.env.OWNER_UIDS) : list(process.env.ALLOWED_UIDS));
export const isOwnerSession = (session) => Boolean(session?.sub) && ownerIds().includes(String(session.sub).toLowerCase());
