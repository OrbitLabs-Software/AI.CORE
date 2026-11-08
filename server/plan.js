// plan.js — Tarife und Monats-Kontingente (Gratis / Pro) pro Konto, gespeichert in data/plans.json.
// Gezählt wird pro Kalendermonat (UTC). Pro kommt per Stripe-Abo oder Einlösecode.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data');
const file = () => path.join(dataDir(), 'plans.json');

let cache = null, cachePath = null;
function load() {
  if (cache && cachePath === file()) return cache;
  cachePath = file();
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch { cache = {}; }
  if (typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  cache.users ||= {}; cache.global ||= {}; cache.usedCodes ||= [];
  return cache;
}
function save() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { console.warn('[plan] Speichern fehlgeschlagen:', e.message); }
}

export const KINDS = { video: 'Videos', image: 'Bilder' };
export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };

export function limits(pro) {
  const e = process.env;
  return pro
    ? { video: num(e.PRO_VIDEOS_PER_MONTH, 20), image: num(e.PRO_IMAGES_PER_MONTH, 200) }
    : { video: num(e.FREE_VIDEOS_PER_MONTH, 1), image: num(e.FREE_IMAGES_PER_MONTH, 10) };
}

const rec = (key) => (load().users[key] ||= { usage: {} });
export const isPro = (key, now = Date.now()) => (load().users[key]?.pro?.until || 0) > now;

/** Zustand für die Oberfläche (ohne Stripe-Kennungen). unlimited = Besitzer oder Server ohne Anmeldung. */
export function planStatus(key, { unlimited = false, now = Date.now() } = {}) {
  const r = load().users[key];
  const pro = isPro(key, now);
  const used = r?.usage?.[monthKey(now)] || {};
  return {
    unlimited, pro, until: pro ? r.pro.until : null, source: pro ? r.pro.source : null,
    manageable: Boolean(pro && r.pro.customer),
    limits: limits(pro), used: { video: used.video || 0, image: used.image || 0 },
    tokens: tokenStatus(key, { unlimited, now }),
  };
}

// ---------- Token-Guthaben ----------
// Jede Aktion kostet Token (Wörter, Bilder, Videosekunden …). Das Guthaben gilt für ein Zeitfenster, das mit der
// ersten Nutzung beginnt und nach Ablauf zurückgesetzt wird: Gratis 4 000 Token alle 4 Stunden, Pro 10 000 alle 2 Stunden.
// Intern wird in Hundertstel-Token gerechnet (0,25 Token = 25), damit keine Rundungsfehler entstehen.
export const tokensEnabled = () => process.env.TOKENS !== 'false';
const fnum = (v, d) => { const n = Number(String(v ?? '').replace(',', '.')); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const cents = (t) => Math.round(t * 100);
const tok = (c) => Math.round(c) / 100;

/** Kosten pro Einheit in Token. */
export function costs() {
  const e = process.env;
  return {
    word: fnum(e.TOKEN_COST_WORD, 0.25),           // pro Wort im Chat (deine Nachricht und die Antwort)
    image: fnum(e.TOKEN_COST_IMAGE, 45.9),         // pro erzeugtem Bild
    videoSecond: fnum(e.TOKEN_COST_VIDEO_SECOND, 15.9),
    fileWord: fnum(e.TOKEN_COST_FILE_WORD, 0.5),   // pro Wort in einer hochgeladenen Datei
    analyzeWord: fnum(e.TOKEN_COST_ANALYZE_WORD, 0.75),  // pro Wort einer Datei, das die KI analysiert
    musicSecond: fnum(e.TOKEN_COST_MUSIC_SECOND, 10),
  };
}
export function tokenPlan(pro) {
  const e = process.env;
  return pro
    ? { max: fnum(e.PRO_TOKENS, 10000), resetHours: fnum(e.PRO_RESET_HOURS, 2) }
    : { max: fnum(e.FREE_TOKENS, 4000), resetHours: fnum(e.FREE_RESET_HOURS, 4) };
}
export const wordCount = (s) => (String(s ?? '').match(/\S+/g) || []).length;

function wallet(key, now) {
  const pro = isPro(key, now), plan = tokenPlan(pro), resetMs = plan.resetHours * 3600000;
  const r = rec(key);
  if (!r.tok || typeof r.tok.used !== 'number') r.tok = { used: 0, start: 0 };
  if (r.tok.start && now >= r.tok.start + resetMs) r.tok = { used: 0, start: 0 };     // Fenster abgelaufen: zurückgesetzt
  return { r, pro, max: cents(plan.max), resetMs, resetHours: plan.resetHours };
}

export function tokenStatus(key, { unlimited = false, now = Date.now() } = {}) {
  const base = { enabled: tokensEnabled(), costs: costs(), free: tokenPlan(false), pro: tokenPlan(true) };
  if (!tokensEnabled()) return base;
  if (unlimited) return { ...base, unlimited: true };
  const w = wallet(key, now), t = w.r.tok;
  return { ...base, max: tok(w.max), used: tok(Math.min(t.used, w.max)), left: tok(Math.max(0, w.max - t.used)), resetHours: w.resetHours, resetAt: t.start ? t.start + w.resetMs : null };
}

const span = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min`; };

/**
 * Token abziehen. strict: nur wenn das Guthaben reicht (sonst 402, nichts wird abgezogen).
 * Ohne strict (Antwort ist schon geschrieben) wird bis zur Obergrenze abgezogen.
 */
export function spendTokens(key, amount, { unlimited = false, strict = true, now = Date.now() } = {}) {
  const c = cents(amount);
  if (!tokensEnabled() || unlimited || c <= 0) return { ok: true, spent: 0 };
  const w = wallet(key, now), t = w.r.tok;
  if (strict && t.used + c > w.max) {
    const left = Math.max(0, w.max - t.used), when = t.start ? ` Zurückgesetzt wird in ${span(t.start + w.resetMs - now)}.` : '';
    return { ok: false, status: 402, error: `Dein Token-Guthaben reicht dafür nicht (${tok(left)} übrig, ${tok(c)} nötig).${when}${w.pro ? '' : ' Mit AI Core Pro bekommst du mehr: Einstellungen → Pro.'}`, left: tok(left) };
  }
  if (!t.start) t.start = now;
  const before = t.used;
  t.used = Math.min(w.max, t.used + c);
  save();
  return { ok: true, spent: tok(t.used - before), spentCents: t.used - before };
}

export function refundTokens(key, amount, { now = Date.now() } = {}) {
  const c = cents(amount);
  if (!tokensEnabled() || c <= 0 || !load().users[key]?.tok) return;
  const w = wallet(key, now);
  w.r.tok.used = Math.max(0, w.r.tok.used - c);
  save();
}

/** Kontingent vorab reservieren. Bei Fehlschlag der Erzeugung mit refund() zurückgeben. */
export function reserve(key, kind, { unlimited = false, now = Date.now() } = {}) {
  if (!KINDS[kind]) return { ok: false, status: 400, error: 'Unbekannte Art' };
  const m = monthKey(now), d = load();
  if (!unlimited && !tokensEnabled()) {
    const pro = isPro(key, now), max = limits(pro)[kind];
    const used = d.users[key]?.usage?.[m]?.[kind] || 0;
    if (used >= max) {
      return { ok: false, status: 402, error: `Dein Kontingent für ${KINDS[kind]} in diesem Monat ist aufgebraucht (${used} von ${max}).${pro ? '' : ' Mit AI Core Pro bekommst du mehr: Einstellungen → Pro.'}` };
    }
  }
  const cap = num(process.env[`${kind.toUpperCase()}_MAX_PER_MONTH_TOTAL`], 0);   // Notbremse für die Gesamtkosten
  const g = ((d.global[m] ||= {})[kind] ||= 0);
  if (cap && g >= cap) return { ok: false, status: 503, error: `Für diesen Monat ist das Gesamtlimit für ${KINDS[kind]} erreicht. Ab dem nächsten Monat geht es wieder.` };
  const u = ((rec(key).usage[m] ||= {})[kind] ||= 0);
  rec(key).usage[m][kind] = u + 1;
  d.global[m][kind] = g + 1;
  save();
  return { ok: true };
}

export function refund(key, kind, now = Date.now()) {
  const m = monthKey(now), d = load();
  const u = d.users[key]?.usage?.[m];
  if (u?.[kind] > 0) u[kind] -= 1;
  if (d.global[m]?.[kind] > 0) d.global[m][kind] -= 1;
  save();
}

export function grantPro(key, { until, source, customer, subscription }) {
  rec(key).pro = { until: Number(until), source, ...(customer ? { customer } : {}), ...(subscription ? { subscription } : {}), checkedAt: Date.now() };
  save();
}
export const revokePro = (key) => { if (load().users[key]) { delete load().users[key].pro; save(); } };
export const proInfo = (key) => load().users[key]?.pro || null;

// ---------- Einlösecodes: PRO_CODES=CODE1:30,CODE2:365 (Tage), jeder Code nur einmal ----------
const hash = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
const codeList = () => String(process.env.PRO_CODES || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const [code, days] = s.split(':');
  return { code: code.trim(), days: Math.min(3650, Math.max(1, Math.floor(Number(days)) || 30)) };
});
export const codesEnabled = () => codeList().length > 0;

export function redeemCode(key, input, now = Date.now()) {
  const h = hash(input), d = load();
  const entry = codeList().find(c => crypto.timingSafeEqual(Buffer.from(hash(c.code)), Buffer.from(h)));
  if (!entry) return { ok: false, status: 400, error: 'Dieser Code ist ungültig.' };
  if (d.usedCodes.includes(h)) return { ok: false, status: 409, error: 'Dieser Code wurde schon eingelöst.' };
  const base = Math.max(now, load().users[key]?.pro?.until || 0);
  const prev = rec(key).pro || {};
  rec(key).pro = { ...prev, until: base + entry.days * 86400000, source: prev.source === 'stripe' ? 'stripe' : 'code' };
  d.usedCodes.push(h);
  save();
  return { ok: true, days: entry.days };
}
