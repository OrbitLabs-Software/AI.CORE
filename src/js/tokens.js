// tokens.js — Token-Anzeige in der oberen Leiste. Zeigt das restliche Guthaben und wann es sich zurücksetzt.
import { api } from './api.js';

let state = null, chip = null, timer = null, onOpen = () => {};
const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('de-AT');

function left(resetAt) {
  if (!resetAt) return '';
  const min = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} Std. ${min % 60} Min.` : `${min} Min.`;
}

function draw() {
  if (!chip) return;
  if (!state || state.unlimited) { chip.hidden = true; return; }
  const t = state.tokens;
  chip.hidden = false;
  chip.classList.toggle('low', t.remaining < t.limit * 0.1);
  chip.querySelector('b').textContent = fmt(t.remaining);
  chip.title = `${fmt(t.remaining)} von ${fmt(t.limit)} Token übrig${t.resetAt ? ` · setzt sich in ${left(t.resetAt)} zurück` : ' · das Zeitfenster startet mit deiner nächsten Anfrage'}`;
}

/** Aktualisiert die Anzeige mit {tokens} aus dem Server oder dem ganzen Tarif. */
export function setTokens(next) {
  if (!next) return;
  state = next.tokens ? { ...(state || {}), ...next } : { ...(state || {}), tokens: next, unlimited: state?.unlimited };
  draw();
}

export async function refreshTokens() {
  try { state = await api.plan(); draw(); } catch { /* ohne Anmeldung oder Server: keine Anzeige */ }
}

export function initTokenChip(el, open) {
  chip = el; onOpen = open;
  window.addEventListener('aicore:tokens-stale', () => refreshTokens());
  chip.addEventListener('click', () => onOpen());
  clearInterval(timer);
  timer = setInterval(() => {
    if (state?.tokens?.resetAt && Date.now() >= state.tokens.resetAt) refreshTokens(); else draw();
  }, 30000);
  refreshTokens();
}
