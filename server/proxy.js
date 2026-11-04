// proxy.js — Welchem Vermittler darf der Server die Absender-Adresse glauben? (Express „trust proxy“)
// Standard „loopback“: Tunnel wie Tailscale Funnel oder Cloudflare Tunnel laufen auf demselben Rechner und melden
// die echte Adresse des Besuchers. Direkte Zugriffe aus dem Netz können diese Angabe nicht fälschen.
// TRUST_PROXY=false schaltet es ab, true vertraut jedem (nur hinter einem eigenen, abgesicherten Proxy).

export function trustProxySetting(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '' || v === 'loopback') return 'loopback';
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  return String(value).trim();   // Adressliste, zum Beispiel "loopback, 10.0.0.0/8"
}
