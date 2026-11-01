// security.js — optionaler Passwortschutz, Rate-Limits, Header, Origin-Prüfung.
// Alles ohne zusätzliche Abhängigkeiten.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { firebaseEnabled, firebaseClientConfig, verifyIdToken, denyReason, identityFromPayload, FirebaseAuthError } from './firebaseAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = () => process.env.AICORE_DATA_DIR || path.resolve(__dirname, '..', 'data');
const COOKIE = 'aicore_session';
const SESSION_DAYS = 30;

// ---------- Konfiguration (lazy, weil dotenv erst nach den Imports lädt) ----------
export const passwordEnabled = () => Boolean(process.env.ACCESS_PASSWORD);
export const authEnabled = () => passwordEnabled() || firebaseEnabled();

let cachedSecret = null;
function secret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET) return (cachedSecret = process.env.SESSION_SECRET);
  const file = path.join(dataDir(), 'session.secret');
  try {
    cachedSecret = fs.readFileSync(file, 'utf-8').trim();
    if (cachedSecret.length >= 32) return cachedSecret;
  } catch { /* wird neu erzeugt */ }
  cachedSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  } catch (e) {
    console.warn('[security] Sitzungsschlüssel konnte nicht gespeichert werden:', e.message);
  }
  return cachedSecret;
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Sitzungs-Token: base64url(JSON{exp, sub?, email?, name?}) + "." + HMAC
export function makeToken(identity = {}) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000, ...identity })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Gibt die Daten aus einem gültigen Token zurück, sonst null. */
export function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return data && Number(data.exp) > Date.now() ? data : null;
  } catch { return null; }
}

export const isValidToken = (token) => readToken(token) !== null;

/** Angemeldete Person aus dem Cookie (oder null). */
export function sessionFromRequest(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return readToken(bearer ? bearer[1] : parseCookies(req.headers.cookie)[COOKIE]);
}

export function isAuthenticated(req) {
  if (!authEnabled()) return true;
  return sessionFromRequest(req) !== null;
}

export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

function cookieFlags(req, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// ---------- Rate-Limiter (im Speicher, pro IP) ----------
export function rateLimit({ windowMs, max, message = 'Zu viele Anfragen. Bitte kurz warten.', keyFn }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60000).unref();

  const limiter = (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) entry = { count: 0, reset: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
  limiter.reset = (req) => hits.delete(keyFn ? keyFn(req) : req.ip);
  return limiter;
}

export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 8,
  message: 'Zu viele Anmeldeversuche. Bitte in ein paar Minuten erneut versuchen.',
});

// ---------- Login / Logout / Session ----------
// Cookie (gleicher Ursprung) UND Token im Antworttext (für die GitHub-Seite, die den Server von außen anspricht).
const setSession = (req, res, identity) => {
  const token = makeToken(identity);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(req, SESSION_DAYS * 86400)}`);
  return token;
};

/** Anmeldung mit dem Zugangspasswort (ACCESS_PASSWORD). */
export function loginHandler(req, res) {
  if (!passwordEnabled()) return res.status(400).json({ error: 'Passwort-Anmeldung ist nicht aktiviert' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !safeEqual(password, process.env.ACCESS_PASSWORD)) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  loginLimiter.reset(req);
  const token = setSession(req, res, { sub: 'password', name: 'Zugang' });
  res.json({ ok: true, token });
}

/** Anmeldung mit Firebase (derselbe Login wie auf der OrbitLabs-Webseite). */
export async function firebaseLoginHandler(req, res) {
  try {
    const payload = await verifyIdToken(req.body?.idToken);
    const reason = denyReason(payload);
    if (reason) return res.status(403).json({ error: reason });
    const identity = identityFromPayload(payload);
    loginLimiter.reset(req);
    const token = setSession(req, res, identity);
    res.json({ ok: true, token, user: { email: identity.email || identity.phone, name: identity.name } });
  } catch (e) {
    if (e instanceof FirebaseAuthError) return res.status(e.status).json({ error: e.message });
    console.error('[firebase-login]', e);
    res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
  }
}

export function logoutHandler(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieFlags(req, 0)}`);
  res.json({ ok: true });
}

/** Öffentliche Angaben zur Anmeldung für die Oberfläche. */
export function authInfo(req) {
  const session = sessionFromRequest(req);
  return {
    authRequired: authEnabled(),
    authenticated: isAuthenticated(req),
    methods: { password: passwordEnabled(), firebase: firebaseClientConfig() },
    user: session && (session.email || session.phone) ? { email: session.email || session.phone, name: session.name || session.email || session.phone } : null,
  };
}

// ---------- Header & Origin-Prüfung ----------
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const fb = firebaseEnabled();
  const phone = fb && (firebaseClientConfig()?.providers || []).includes('phone');
  const authDomain = fb ? (process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`) : '';
  // Nur wenn Firebase aktiv ist, werden Googles Domains für den Login freigegeben.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self'${fb ? ' https://www.gstatic.com https://apis.google.com' : ''}${phone ? ' https://www.google.com/recaptcha/' : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${fb ? ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com' : ''}`,
    `frame-src 'self'${fb ? ` https://${authDomain} https://*.firebaseapp.com https://accounts.google.com https://*.web.app${phone ? ' https://www.google.com' : ''}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
}

// ---------- CORS: erlaubte Seiten, die den Server von außen ansprechen (z. B. die GitHub-Seite) ----------
// ALLOWED_ORIGINS in der .env, kommagetrennt; „*“ vor dem Punkt als Platzhalter: https://*.github.io
const originPatterns = () => String(process.env.ALLOWED_ORIGINS ?? 'https://*.github.io').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

export function originAllowed(origin) {
  const o = String(origin || '').toLowerCase().replace(/\/+$/, '');
  if (!o) return false;
  return originPatterns().some(p => {
    if (p === o) return true;
    if (!p.includes('*')) return false;
    const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$');
    return re.test(o);
  });
}

export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true'); // Browser-Vorabfrage für Heimnetz-Server
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

export function sameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host && !originAllowed(origin)) return res.status(403).json({ error: 'Ungültiger Ursprung' });
    } catch {
      return res.status(403).json({ error: 'Ungültiger Ursprung' });
    }
  }
  next();
}
