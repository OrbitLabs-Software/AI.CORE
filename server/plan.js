// plan.js — Tarife (Gratis / Pro) und Token-Guthaben pro Konto, gespeichert in data/plans.json.
// Gezählt wird in Token; das Guthaben setzt sich nach einem Zeitfenster zurück (Gratis 4 Std., Pro 2 Std.). Pro kommt per Stripe-Abo oder Einlösecode.

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

// ---------- Token-Konto ----------
// Jedes Konto hat ein Token-Guthaben, das sich nach einem Zeitfenster zurücksetzt (Gratis: 4 Stunden, Pro: 2 Stunden).
// Das Fenster beginnt mit der ersten Ausgabe nach dem letzten Zurücksetzen.
export const KINDS = { image: 'Bilder', video: 'Videos', music: 'Musik' };
export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };
const dec = (v, d) => { const n = Number(String(v ?? '').replace(',', '.')); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const round2 = (n) => Math.round(n * 100) / 100;

/** Preise in Token. Per .env änderbar (z. B. TOKEN_RATE_IMAGE=45.9). */
export function rates() {
  const e = process.env;
  return {
    word: dec(e.TOKEN_RATE_WORD, 0.25),             // pro Wort im Chat (Frage und Antwort)
    image: dec(e.TOKEN_RATE_IMAGE, 45.9),           // pro erzeugtem Bild
    videoSecond: dec(e.TOKEN_RATE_VIDEO_SECOND, 15.9),
    fileWord: dec(e.TOKEN_RATE_FILE_WORD, 0.5),     // pro Wort in einer hochgeladenen Datei
    analyzedWord: dec(e.TOKEN_RATE_ANALYZED_WORD, 0.75), // pro Wort, das in der Datenanalyse ausgewertet wird
    musicSecond: dec(e.TOKEN_RATE_MUSIC_SECOND, 10),
  };
}

/** Wörter zählen (Leerraum trennt). */
export const countWords = (s) => { const t = String(s ?? '').trim(); return t ? t.split(/\s+/).length : 0; };

/** Kosten einer Leistung in Token. kind: words | image | video | fileWords | analyzedWords | music; amount: Anzahl bzw. Sekunden. */
export function cost(kind, amount = 1) {
  const r = rates(), n = Math.max(0, Number(amount) || 0);
  const per = { words: r.word, image: r.image, video: r.videoSecond, fileWords: r.fileWord, analyzedWords: r.analyzedWord, music: r.musicSecond }[kind];
  if (per === undefined) throw new Error(`Unbekannte Art: ${kind}`);
  return round2(per * n);
}

export function limits(pro) {
  const e = process.env;
  return pro
    ? { tokens: num(e.PRO_TOKENS, 10000), resetHours: dec(e.PRO_RESET_HOURS, 2) }
    : { tokens: num(e.FREE_TOKENS, 4000), resetHours: dec(e.FREE_RESET_HOURS, 4) };
}

const rec = (key) => (load().users[key] ||= {});
export const isPro = (key, now = Date.now()) => (load().users[key]?.pro?.until || 0) > now;

/** Aktuelles Fenster eines Kontos; abgelaufene Fenster zählen als leer. */
function windowOf(key, now, pro) {
  const lim = limits(pro), ms = Math.max(60000, Math.round(lim.resetHours * 3600000));
  const w = load().users[key]?.wallet;
  const live = w && now - w.start < ms && now >= w.start;
  const spent = live ? w.spent : 0;
  return { limit: lim.tokens, ms, spent, start: live ? w.start : null, resetAt: live ? w.start + ms : null, remaining: Math.max(0, round2(lim.tokens - spent)) };
}

/** Zustand für die Oberfläche (ohne Stripe-Kennungen). unlimited = Besitzer oder Server ohne Anmeldung. */
export function planStatus(key, { unlimited = false, now = Date.now() } = {}) {
  const r = load().users[key];
  const pro = isPro(key, now);
  const w = windowOf(key, now, pro);
  return {
    unlimited, pro, until: pro ? r.pro.until : null, source: pro ? r.pro.source : null,
    manageable: Boolean(pro && r.pro.customer),
    tokens: { limit: w.limit, used: round2(w.spent), remaining: w.remaining, resetAt: w.resetAt, resetHours: limits(pro).resetHours },
    plans: { free: limits(false), pro: limits(true) },
    rates: rates(),
  };
}

const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('de-AT');
const resetText = (resetAt, now) => {
  const min = Math.max(1, Math.ceil((resetAt - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} Std. ${min % 60} Min.` : `${min} Min.`;
};

/** Prüft, ob das Guthaben für `tokens` reicht, ohne etwas abzubuchen. */
export function canAfford(key, tokens, { unlimited = false, now = Date.now() } = {}) {
  if (unlimited) return { ok: true };
  const pro = isPro(key, now), w = windowOf(key, now, pro);
  if (w.remaining + 1e-9 >= tokens && w.remaining > 0) return { ok: true, remaining: w.remaining };
  const when = w.resetAt ? ` Es setzt sich in ${resetText(w.resetAt, now)} zurück.` : '';
  return {
    ok: false, status: 402, remaining: w.remaining,
    error: `Dein Token-Guthaben reicht dafür nicht (${fmt(w.remaining)} von ${fmt(w.limit)} übrig, benötigt: ${fmt(tokens)}).${when}${pro ? '' : ' Mit AI Core Pro bekommst du mehr Token und ein schnelleres Zurücksetzen: Einstellungen → Pro.'}`,
  };
}

/** Bucht Token ab. strict=true: nur wenn das Guthaben reicht; sonst wird bis zum Limit abgebucht (für Antworten, die schon laufen). */
export function charge(key, tokens, { unlimited = false, strict = true, kind = 'other', now = Date.now() } = {}) {
  const t = round2(Math.max(0, Number(tokens) || 0));
  if (!t) return { ok: true, charged: 0 };
  if (!unlimited && strict) { const c = canAfford(key, t, { now }); if (!c.ok) return c; }
  const pro = isPro(key, now), d = load(), m = monthKey(now);
  const w = windowOf(key, now, pro);
  const take = unlimited ? t : Math.min(t, w.remaining);
  if (!unlimited) {
    rec(key).wallet = { start: w.start ?? now, spent: round2(w.spent + take) };
  }
  const g = (d.global[m] ||= {});
  g.tokens = round2((g.tokens || 0) + take);
  g[kind] = round2((g[kind] || 0) + take);
  save();
  return { ok: true, charged: take };
}

/** Zurückgeben, wenn eine Leistung fehlgeschlagen ist (nur im laufenden Fenster). */
export function refund(key, tokens, { now = Date.now() } = {}) {
  const w = load().users[key]?.wallet;
  const t = round2(Math.max(0, Number(tokens) || 0));
  if (w && t) { w.spent = Math.max(0, round2(w.spent - t)); }
  const g = load().global[monthKey(now)];
  if (g?.tokens) g.tokens = Math.max(0, round2(g.tokens - t));
  save();
}

/** Notbremse für die Gesamtkosten: Bilder/Videos pro Monat für alle zusammen (0 = aus). */
export function globalCapReached(kind, now = Date.now()) {
  const cap = num(process.env[`${kind.toUpperCase()}_MAX_PER_MONTH_TOTAL`], 0);
  if (!cap) return false;
  const done = load().global[monthKey(now)]?.[`${kind}Count`] || 0;
  return done >= cap;
}
export function countGlobal(kind, delta = 1, now = Date.now()) {
  const g = (load().global[monthKey(now)] ||= {});
  g[`${kind}Count`] = Math.max(0, (g[`${kind}Count`] || 0) + delta);
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
