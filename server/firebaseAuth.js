// firebaseAuth.js — prüft Firebase-ID-Tokens (derselbe Login wie auf der OrbitLabs-Webseite).
//
// Ablauf: Die Oberfläche meldet sich bei Firebase an und schickt das ID-Token an
// POST /api/auth/firebase. Der Server prüft die Signatur gegen Googles öffentliche
// Schlüssel (ohne firebase-admin, ohne Dienstkonto) und stellt dann ein eigenes
// Sitzungs-Cookie aus. Wer rein darf, bestimmt die Zugangsliste in der .env.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const env = () => process.env;
const list = (v) => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const firebaseEnabled = () => Boolean(env().FIREBASE_PROJECT_ID && env().FIREBASE_API_KEY);

/** Öffentliche Web-Konfiguration für die Oberfläche (diese Werte sind nicht geheim). */
export function firebaseClientConfig() {
  if (!firebaseEnabled()) return null;
  const e = env();
  const providers = list(e.FIREBASE_PROVIDERS || 'password,google')
    .filter(p => ['password', 'google', 'github', 'facebook', 'apple', 'twitter', 'yahoo', 'phone'].includes(p));
  return {
    apiKey: e.FIREBASE_API_KEY,
    authDomain: e.FIREBASE_AUTH_DOMAIN || `${e.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: e.FIREBASE_PROJECT_ID,
    ...(e.FIREBASE_APP_ID ? { appId: e.FIREBASE_APP_ID } : {}),
    providers,
  };
}

let jwks = null;
let jwksUrl = null;
function keys() {
  const url = env().FIREBASE_JWKS_URL || GOOGLE_JWKS; // Überschreiben nur für Tests
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url), { cooldownDuration: 30000, cacheMaxAge: 6 * 3600 * 1000 });
    jwksUrl = url;
  }
  return jwks;
}

export class FirebaseAuthError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}

/** Prüft Signatur, Aussteller, Zielgruppe und Ablauf. Gibt die Token-Daten zurück. */
export async function verifyIdToken(idToken) {
  if (!firebaseEnabled()) throw new FirebaseAuthError('Firebase-Anmeldung ist nicht aktiviert', 400);
  if (typeof idToken !== 'string' || idToken.length < 50 || idToken.length > 6000) {
    throw new FirebaseAuthError('Ungültiges Anmelde-Token');
  }
  const projectId = env().FIREBASE_PROJECT_ID;
  try {
    const { payload } = await jwtVerify(idToken, keys(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
      clockTolerance: 10,
    });
    if (!payload.sub || typeof payload.sub !== 'string') throw new Error('sub fehlt');
    if (payload.auth_time && payload.auth_time * 1000 > Date.now() + 60000) throw new Error('auth_time in der Zukunft');
    return payload;
  } catch (e) {
    if (e?.code === 'ERR_JWKS_TIMEOUT'
      || /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timed out|Expected 200 OK/i.test(String(e?.message))) {
      throw new FirebaseAuthError('Google-Schlüssel konnten nicht geladen werden (Internet am Server prüfen)', 503);
    }
    throw new FirebaseAuthError('Anmelde-Token ungültig oder abgelaufen');
  }
}

/** Darf diese Person AI Core nutzen? Gibt null (ja) oder einen Grund (nein) zurück. */
export function denyReason(payload) {
  const e = env();
  // Gäste (anonyme Konten) lässt AI Core nie herein.
  if (payload.firebase?.sign_in_provider === 'anonymous') return 'Gast-Anmeldung ist hier nicht erlaubt.';

  const email = String(payload.email || '').toLowerCase();
  const phone = String(payload.phone_number || '');

  // Die Benutzer-ID kann niemand fälschen — sie ist die sicherste Form der Freigabe.
  if (list(e.ALLOWED_UIDS).includes(String(payload.sub).toLowerCase())) return null;
  if (phone && list(e.ALLOWED_PHONES).includes(phone.toLowerCase())) return null;

  // Alle weiteren Wege brauchen eine bestätigte Identität (E-Mail oder Handynummer).
  const verifiedEmail = Boolean(email) && payload.email_verified === true;
  if (email && !verifiedEmail && !phone) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link im Postfach).';
  if (!verifiedEmail && !phone) return 'Dieses Konto hat keine bestätigte E-Mail-Adresse oder Handynummer.';

  if (e.ALLOW_ANY_FIREBASE_USER === 'true') return null;
  const emails = list(e.ALLOWED_EMAILS);
  const domains = list(e.ALLOWED_EMAIL_DOMAINS).map(d => d.replace(/^@/, ''));
  if (!list(e.ALLOWED_UIDS).length && !list(e.ALLOWED_PHONES).length && !emails.length && !domains.length) {
    return 'Für diesen Server ist noch niemand freigegeben (ALLOWED_UIDS oder ALLOWED_EMAILS in der .env eintragen).';
  }
  if (verifiedEmail && (emails.includes(email) || domains.includes(email.split('@')[1]))) return null;
  return 'Dieses Konto ist für diesen Server nicht freigegeben.';
}

export function identityFromPayload(payload) {
  const email = String(payload.email || '').toLowerCase();
  const phone = String(payload.phone_number || '');
  const name = payload.name || (email && email.split('@')[0]) || phone || 'Nutzer';
  return { sub: payload.sub, ...(email ? { email } : {}), ...(phone ? { phone } : {}), name: String(name).slice(0, 60) };
}

/** Gibt es mindestens eine Freigabe-Regel? (für die Startmeldung) */
export function hasAllowRules() {
  const e = env();
  return e.ALLOW_ANY_FIREBASE_USER === 'true'
    || [e.ALLOWED_UIDS, e.ALLOWED_PHONES, e.ALLOWED_EMAILS, e.ALLOWED_EMAIL_DOMAINS].some(v => list(v).length);
}
