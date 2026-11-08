// tokens.js — Token-Anzeige oben rechts: wie viel Guthaben übrig ist und wann es zurückgesetzt wird.
// Der Server rechnet; hier wird nur angezeigt. Klick öffnet die Pro-Seite in den Einstellungen.
import { api } from './api.js';

let state = null, onOpen = null, timer = null;
const pill = () => document.getElementById('token-pill');
const fmt = (n) => Math.floor(n).toLocaleString('de-AT');

export const hasEnough = (needed) => !state?.enabled || state?.unlimited || state?.left == null || state.left >= needed;

export function untilReset(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min`;
}

export function renderTokens() {
  const el = pill();
  if (!el) return;
  if (!state?.enabled || state.unlimited || state.max == null) { el.hidden = true; return; }
  const pct = Math.max(0, Math.min(100, (state.left / state.max) * 100));
  el.hidden = false;
  el.dataset.level = pct <= 10 ? 'low' : pct <= 30 ? 'mid' : 'ok';
  el.querySelector('b').textContent = fmt(state.left);
  el.querySelector('i').style.width = `${pct}%`;
  const reset = state.resetAt ? `Wird in ${untilReset(state.resetAt - Date.now())} zurückgesetzt.` : `Das Fenster startet mit deiner nächsten Aktion (${state.resetHours} Std).`;
  el.title = `${fmt(state.left)} von ${fmt(state.max)} Token übrig. ${reset}`;
}

/** Neue Zahlen vom Server übernehmen (aus dem Chat-Strom oder /api/plan). */
export function setTokens(t) { if (t) { state = t; renderTokens(); } }
export const getTokens = () => state;

export async function refreshTokens() {
  try { setTokens((await api.plan()).tokens); } catch { /* ohne Server gibt es nichts anzuzeigen */ }
}

let bound = false;
export function initTokens(open) {
  onOpen = open;
  if (!bound) {
    bound = true;
    pill()?.addEventListener('click', () => onOpen?.());
    window.addEventListener('aicore:tokens-stale', () => refreshTokens());
  }
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.hidden) return;
    if (state?.resetAt && Date.now() >= state.resetAt) refreshTokens(); else renderTokens();
  }, 30000);
  refreshTokens();
}
