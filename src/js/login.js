// login.js — Anmelde-Overlay mit denselben Anmeldearten wie die OrbitLabs-Webseite:
// E-Mail und Passwort (Anmelden/Registrieren, Passwort vergessen), Google, GitHub,
// X (Twitter), Apple, Yahoo und Handynummer per SMS. Welche davon erscheinen,
// bestimmt FIREBASE_PROVIDERS in der .env. Alternativ: Zugangspasswort (ACCESS_PASSWORD).
// Das Firebase-SDK wird erst geladen, wenn der Login wirklich angezeigt wird.

import { api } from './api.js';
import { findServer, serverBase, isCrossOrigin, isPrivateHost, normalizeServer, setServerBase, DEFAULT_SERVER } from './config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1';

async function loadSdk() {
  if (window.__firebaseSdk) return window.__firebaseSdk; // Einstieg für Tests
  const [app, auth] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-auth.js`),
  ]);
  return { ...app, ...auth };
}

const ICON = {
  google: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.4-4.7 3.4-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.2a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.300 9.100 5.400 12 5.400z"/></svg>',
  github: '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
};

const PROVIDERS = {
  google: { name: 'Google', color: '#4285F4', mark: 'G', make: (s) => new s.GoogleAuthProvider() },
  github: { name: 'GitHub', color: '#6e40c9', mark: 'GH', make: (s) => new s.GithubAuthProvider() },
  twitter: { name: 'X (Twitter)', color: '#1d9bf0', mark: 'X', make: (s) => new s.TwitterAuthProvider() },
  apple: { name: 'Apple', color: '#555', mark: 'A', make: (s) => { const p = new s.OAuthProvider('apple.com'); p.addScope?.('email'); p.addScope?.('name'); return p; } },
  yahoo: { name: 'Yahoo', color: '#6001d2', mark: 'Y!', make: (s) => new s.OAuthProvider('yahoo.com') },
  facebook: { name: 'Facebook', color: '#1877f2', mark: 'f', make: (s) => new s.FacebookAuthProvider() },
};

const ERRORS = {
  'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
  'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
  'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
  'auth/weak-password': 'Das Passwort ist zu schwach.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte später erneut probieren.',
  'auth/user-disabled': 'Dieses Konto ist gesperrt.',
  'auth/network-request-failed': 'Keine Verbindung zu Firebase. Ist dieser Rechner online?',
  'auth/operation-not-allowed': 'Diese Anmeldeart ist in Firebase noch nicht aktiviert.',
  'auth/unauthorized-domain': 'Diese Adresse ist in Firebase nicht als Domain freigegeben. Per E-Mail und Passwort geht es trotzdem; für Google, GitHub und Handynummer die Domain unter Authentication → Einstellungen → Autorisierte Domains eintragen.',
  'auth/account-exists-with-different-credential': 'Zu dieser E-Mail gibt es schon ein Konto mit einer anderen Anmeldeart (z. B. Google oder Passwort). Bitte melde dich damit an.',
  'auth/popup-blocked': 'Das Pop-up wurde blockiert. Bitte Pop-ups für diese Seite erlauben.',
  'auth/invalid-phone-number': 'Bitte die Nummer mit Ländervorwahl eingeben, z. B. +43 660 1234567.',
  'auth/missing-phone-number': 'Bitte die Nummer mit Ländervorwahl eingeben, z. B. +43 660 1234567.',
  'auth/invalid-verification-code': 'Der SMS-Code ist falsch.',
  'auth/code-expired': 'Der SMS-Code ist abgelaufen. Bitte neu anfordern.',
  'auth/quota-exceeded': 'Das SMS-Kontingent ist aufgebraucht. Bitte später erneut probieren.',
  'auth/captcha-check-failed': 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte Seite neu laden.',
};
const IGNORED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

const explain = (e) => (IGNORED.has(e?.code) ? '' : ERRORS[e?.code] || e?.message || 'Anmeldung fehlgeschlagen.');

let ctxPromise = null;
async function firebaseContext(config) {
  ctxPromise ??= (async () => {
    const sdk = await loadSdk();
    const { providers, ...options } = config;
    const app = sdk.getApps().length ? sdk.getApp() : sdk.initializeApp(options);
    const auth = sdk.getAuth(app);
    auth.languageCode = 'de';
    return { sdk, auth };
  })();
  try { return await ctxPromise; } catch (e) { ctxPromise = null; throw e; }
}

/** Tauscht das Firebase-Token gegen die Sitzung des Servers und meldet bei Firebase wieder ab. */
async function finish({ sdk, auth }, user) {
  const result = await api.firebaseLogin(await user.getIdToken(true));
  await sdk.signOut(auth).catch(() => {});
  return result;
}

async function emailSignIn(config, { email, password, name, register }) {
  const ctx = await firebaseContext(config);
  const { sdk, auth } = ctx;
  let cred;
  if (register) {
    cred = await sdk.createUserWithEmailAndPassword(auth, email, password);
    if (name) await sdk.updateProfile?.(cred.user, { displayName: name }).catch(() => {});
  } else {
    cred = await sdk.signInWithEmailAndPassword(auth, email, password);
  }
  if (register && !cred.user.emailVerified) await sdk.sendEmailVerification(cred.user).catch(() => {});
  return finish(ctx, cred.user);
}

async function popupSignIn(config, provider) {
  const ctx = await firebaseContext(config);
  const cred = await ctx.sdk.signInWithPopup(ctx.auth, PROVIDERS[provider].make(ctx.sdk));
  return finish(ctx, cred.user);
}

let recaptcha = null;
let confirmation = null;
async function phoneSend(config, raw) {
  const nr = String(raw).replace(/[\s()/-]/g, '');
  if (!/^\+\d{8,15}$/.test(nr)) throw Object.assign(new Error('x'), { code: 'auth/invalid-phone-number' });
  const { sdk, auth } = await firebaseContext(config);
  try {
    recaptcha ??= new sdk.RecaptchaVerifier(auth, 'login-recaptcha', { size: 'invisible' });
    confirmation = await sdk.signInWithPhoneNumber(auth, nr, recaptcha);
  } catch (e) {
    try { recaptcha?.clear(); } catch { /* egal */ }
    recaptcha = null;
    throw e;
  }
}
async function phoneConfirm(config, code) {
  if (!confirmation) throw new Error('Bitte zuerst einen Code anfordern.');
  const ctx = await firebaseContext(config);
  const cred = await confirmation.confirm(String(code).trim());
  return finish(ctx, cred.user);
}

async function sendReset(config, email) {
  const { sdk, auth } = await firebaseContext(config);
  await sdk.sendPasswordResetEmail(auth, email);
}

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MARK = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z" fill="currentColor"/></svg>';
const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const hostLabel = () => (serverBase() || location.host).replace(/^https?:\/\//, '');

/** Kleine Hilfen für beide Fenster: Meldungen, Ladezustand, Server-Zeile. */
function shell(inner) {
  const el = h(`<div class="lg-overlay"><div class="lg-card" role="dialog" aria-modal="true" aria-labelledby="lg-title">
    <div class="lg-brand" aria-hidden="true">${MARK}</div>${inner}</div></div>`);
  const $ = (sel) => el.querySelector(sel);
  const msg = $('.lg-msg');
  const say = (text, kind = 'error') => { msg.textContent = text || ''; msg.className = `lg-msg ${text ? kind : ''}`; msg.hidden = !text; };
  const busy = (btn, on) => {
    el.classList.toggle('busy', on);
    el.setAttribute('aria-busy', on);
    el.querySelectorAll('button').forEach(b => { b.disabled = on; });
    btn?.classList.toggle('loading', on);
  };
  return { el, $, say, busy };
}

/**
 * Anmelde-Overlay. onSuccess({user}) wird nach erfolgreicher Anmeldung aufgerufen.
 * @param {{password: boolean, firebase: object|null}} methods  aus /api/config
 */
export function mountLogin({ methods, onSuccess, legal = {} }) {
  const fb = methods.firebase;
  const list = fb?.providers || [];
  const hasEmail = list.includes('password');
  // Google, GitHub und SMS verlangen bei Firebase eine freigegebene Webadresse — Heimnetz-IPs gehören nicht dazu.
  const popupOk = !isPrivateHost();
  const social = popupOk ? list.filter(p => PROVIDERS[p]) : [];
  const hasPhone = popupOk && list.includes('phone');
  const hiddenSome = !popupOk && list.some(p => PROVIDERS[p] || p === 'phone');
  const both = Boolean(fb && methods.password);

  const socialHtml = social.map(p => {
    const v = PROVIDERS[p];
    const icon = ICON[p] || `<span class="lg-mark" style="background:${v.color}">${esc(v.mark)}</span>`;
    return `<button type="button" class="btn lg-social" data-provider="${p}">${icon}<span>Weiter mit ${esc(v.name)}</span></button>`;
  }).join('') + (hasPhone ? `<button type="button" class="btn lg-social" data-action="phone">${ICON.phone}<span>Weiter mit Handynummer</span></button>` : '');

  const { el, $, say, busy } = shell(`
    <h2 id="lg-title">Willkommen bei AI Core</h2>
    <p class="lg-sub">Melde dich an, um weiterzumachen.</p>
    ${isCrossOrigin() ? `<button type="button" class="lg-server" data-action="server" title="Server-Adresse ändern"><i class="lg-dot"></i><span>Verbunden mit ${esc(hostLabel())}</span><u>ändern</u></button>` : ''}
    <div class="lg-msg" role="alert" hidden></div>

    <section data-pane="firebase" ${fb ? '' : 'hidden'}>
      ${hasEmail ? `
      <div class="lg-tabs" role="tablist"><button type="button" role="tab" class="on" data-tab="login">Anmelden</button><button type="button" role="tab" data-tab="register">Registrieren</button></div>
      <form class="lg-form" data-form="email" novalidate>
        <label data-field="name" hidden>Name<input class="text-input" name="name" autocomplete="name" placeholder="Dein Name"></label>
        <label>E-Mail<input class="text-input" type="email" name="email" autocomplete="username" inputmode="email" placeholder="name@beispiel.at"></label>
        <label>Passwort<span class="lg-pw"><input class="text-input" type="password" name="password" autocomplete="current-password" placeholder="Dein Passwort"><button type="button" class="icon-btn" data-action="peek" aria-label="Passwort anzeigen" title="Passwort anzeigen">${EYE}</button></span></label>
        <button class="btn primary block" type="submit" data-role="go"><b>Anmelden</b></button>
        <button type="button" class="link-btn" data-action="reset">Passwort vergessen?</button>
      </form>` : ''}
      ${socialHtml && hasEmail ? '<div class="lg-divider"><span>oder weiter mit</span></div>' : ''}
      ${socialHtml ? `<div class="lg-stack">${socialHtml}</div>` : ''}
      ${hasPhone ? `<form class="lg-phone" data-form="phone" hidden novalidate>
        <label>Handynummer<input class="text-input" type="tel" name="tel" autocomplete="tel" placeholder="+43 660 1234567"></label>
        <button class="btn primary block" type="submit"><b>SMS-Code senden</b></button>
        <label class="lg-code" hidden>SMS-Code<input class="text-input" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></label>
        <button class="btn primary block lg-code" type="button" data-action="phone-confirm" hidden><b>Bestätigen</b></button>
      </form>` : ''}
      ${hiddenSome ? '<p class="lg-note">Google, GitHub und Handynummer gehen nur über die GitHub-Seite, nicht über die Heimnetz-Adresse.</p>' : ''}
      <div id="login-recaptcha"></div>
    </section>

    <form class="lg-form" data-pane="password" ${fb ? 'hidden' : ''} novalidate>
      <label>Zugangspasswort<input class="text-input" type="password" name="secret" autocomplete="current-password" placeholder="Zugangspasswort"></label>
      <button class="btn primary block" type="submit"><b>Anmelden</b></button>
    </form>
    ${both ? '<button type="button" class="link-btn lg-switch" data-action="switch">Mit Zugangspasswort anmelden</button>' : ''}
    ${[['imprint', 'Impressum'], ['privacy', 'Datenschutz'], ['terms', 'AGB']].filter(([k]) => legal[k]).length ? `<p class="lg-legal">${[['imprint', 'Impressum'], ['privacy', 'Datenschutz'], ['terms', 'AGB']].filter(([k]) => legal[k]).map(([k, t]) => `<a href="${esc(legal[k])}" target="_blank" rel="noopener noreferrer">${t}</a>`).join(' · ')}</p>` : ''}`);

  async function run(task, btn) {
    say('');
    busy(btn, true);
    try {
      const result = await task();
      el.remove();
      onSuccess({ user: result?.user || null });
    } catch (e) {
      busy(btn, false);
      if (e?.network) say('Der Server antwortet nicht. Prüfe deine Verbindung oder wähle oben einen anderen Server.');
      else say(explain(e));
    }
  }

  // --- E-Mail ---
  const emailForm = $('[data-form="email"]');
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    el.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === m); b.setAttribute('aria-selected', b.dataset.tab === m); });
    emailForm.querySelector('[data-field="name"]').hidden = m !== 'register';
    emailForm.elements.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('[data-role="go"] b').textContent = m === 'register' ? 'Konto erstellen' : 'Anmelden';
    $('[data-action="reset"]').hidden = m === 'register';
    say('');
  };
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tab)));
  $('[data-action="peek"]')?.addEventListener('click', (e) => {
    const input = emailForm.elements.password;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    input.focus();
  });
  emailForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = emailForm.elements;
    const email = f.email.value.trim(), password = f.password.value, name = f.name.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say('Bitte eine gültige E-Mail-Adresse eingeben.'); return f.email.focus(); }
    if (!password) { say('Bitte das Passwort eingeben.'); return f.password.focus(); }
    if (mode === 'register' && password.length < 8) { say('Das Passwort muss mindestens 8 Zeichen haben.'); return f.password.focus(); }
    run(async () => {
      try { return await emailSignIn(fb, { email, password, name, register: mode === 'register' }); }
      catch (err) {
        if (err?.status === 403 && mode === 'register') err.message += ' Wir haben dir eine Bestätigungs-Mail geschickt.';
        throw err;
      }
    }, $('[data-role="go"]'));
  });
  $('[data-action="reset"]')?.addEventListener('click', async () => {
    const email = emailForm.elements.email.value.trim();
    if (!email) { say('Bitte zuerst die E-Mail eintragen.'); return emailForm.elements.email.focus(); }
    busy(null, true);
    try { await sendReset(fb, email); say('Wir haben dir eine E-Mail zum Zurücksetzen geschickt.', 'info'); }
    catch (e) { say(explain(e)); }
    finally { busy(null, false); }
  });

  // --- Anbieter ---
  el.querySelectorAll('[data-provider]').forEach(btn =>
    btn.addEventListener('click', () => run(() => popupSignIn(fb, btn.dataset.provider), btn)));

  // --- Handynummer ---
  const phoneForm = $('[data-form="phone"]');
  $('[data-action="phone"]')?.addEventListener('click', () => { phoneForm.hidden = !phoneForm.hidden; if (!phoneForm.hidden) phoneForm.elements.tel.focus(); });
  phoneForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!phoneForm.querySelector('.lg-code').hidden) return $('[data-action="phone-confirm"]').click();
    say(''); busy(null, true);
    try {
      await phoneSend(fb, phoneForm.elements.tel.value);
      phoneForm.querySelectorAll('.lg-code').forEach(x => { x.hidden = false; });
      say('SMS-Code gesendet.', 'info');
      phoneForm.elements.code.focus();
    } catch (err) { say(explain(err)); }
    finally { busy(null, false); phoneForm.elements.code?.focus(); }
  });
  $('[data-action="phone-confirm"]')?.addEventListener('click', (e) =>
    run(() => phoneConfirm(fb, phoneForm.elements.code.value), e.currentTarget));

  // --- Zugangspasswort ---
  const pwForm = $('form[data-pane="password"]');
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pwForm.elements.secret.value) return say('Bitte das Zugangspasswort eingeben.');
    run(async () => { await api.login(pwForm.elements.secret.value); return null; }, pwForm.querySelector('button'));
  });
  $('[data-action="switch"]')?.addEventListener('click', (e) => {
    const fbPane = $('[data-pane="firebase"]');
    const toPassword = !fbPane.hidden;
    fbPane.hidden = toPassword;
    pwForm.hidden = !toPassword;
    e.currentTarget.textContent = toPassword ? 'Mit OrbitLabs-Konto anmelden' : 'Mit Zugangspasswort anmelden';
    say('');
    (toPassword ? pwForm.elements.secret : emailForm?.elements.email)?.focus();
  });

  // --- Server wechseln ---
  $('[data-action="server"]')?.addEventListener('click', () => {
    el.remove();
    mountConnect({ onConnected: (cfg) => window.dispatchEvent(new CustomEvent('aicore:reconnected', { detail: cfg })) });
  });

  document.body.appendChild(el);
  setTimeout(() => el.querySelector('input:not([hidden])')?.focus(), 30);
  return el;
}

/**
 * Verbindungsfenster: erscheint, wenn der Server nicht erreichbar ist (oder man ihn wechseln will).
 * onConnected(config) wird aufgerufen, sobald der Server antwortet.
 */
export function mountConnect({ error = '', onConnected }) {
  const { el, $, say, busy } = shell(`
    <h2 id="lg-title">${error ? 'Server nicht erreichbar' : 'Server wählen'}</h2>
    <p class="lg-sub">Die Oberfläche läuft hier, die KI auf deinem Server.</p>
    <div class="lg-msg" role="alert" hidden></div>
    <form class="lg-form" novalidate>
      <label>Server-Adresse<input class="text-input" name="server" inputmode="url" autocapitalize="off" spellcheck="false" value="${esc(serverBase() || DEFAULT_SERVER)}" placeholder="http://192.168.1.190:3000 oder https://…"></label>
      <button class="btn primary block" type="submit"><b>Verbinden</b></button>
      <button type="button" class="link-btn" data-action="default">Automatisch suchen</button>
    </form>
    <details class="lg-help"><summary>Verbindung klappt nicht?</summary><ul>
      <li>Läuft der Server? Auf dem Tiny: <code>sudo systemctl status ai-core</code></li>
      <li>Du musst im selben WLAN/Netzwerk sein wie der Server.</li>
      <li>Chrome und Edge fragen einmal nach dem Zugriff aufs lokale Netzwerk. Bitte <b>Zulassen</b>.</li>
      <li>Von unterwegs oder mit dem iPhone: hier die HTTPS-Adresse des Servers eintragen (zum Beispiel von Tailscale Funnel, siehe README).</li>
    </ul></details>`);
  const form = $('form');
  if (error) say(error);

  const connect = async (raw) => {
    const url = normalizeServer(raw);
    if (url === null) return say('Das ist keine gültige Adresse.');
    const previous = serverBase();
    setServerBase(url === DEFAULT_SERVER ? '' : url);
    say(''); busy(form.querySelector('.primary'), true);
    try {
      const cfg = await api.config();
      el.remove();
      onConnected(cfg);
    } catch (e) {
      setServerBase(previous);
      busy(form.querySelector('.primary'), false);
      say(e?.network ? `Keine Antwort von ${url.replace(/^https?:\/\//, '')}. Details unter „Verbindung klappt nicht?“.` : explain(e));
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); connect(form.elements.server.value); });
  $('[data-action="default"]').addEventListener('click', async () => {
    setServerBase(''); say(''); busy(form.querySelector('.primary'), true);
    const found = await findServer(5000);
    busy(form.querySelector('.primary'), false);
    if (!found) return say('Kein Server gefunden. Prüfe, ob er läuft und du im richtigen Netzwerk bist.');
    form.elements.server.value = found; connect(found);
  });

  document.body.appendChild(el);
  setTimeout(() => form.elements.server.focus(), 30);
  return el;
}
