// stripe.js — Pro-Abo über Stripe Checkout, ohne Zusatzpaket und ohne Webhook.
// Nach der Zahlung fragt der Server Stripe direkt nach dem Ergebnis; das Abo wird bei Ablauf der Periode erneut geprüft.
// So muss der Tiny nicht aus dem Internet erreichbar sein.

const API = 'https://api.stripe.com/v1';
const GRACE_MS = 2 * 86400000;   // Karte läuft gerade ab oder Zahlung hängt: zwei Tage Kulanz

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, name, out); else out.append(name, String(v));
  }
  return out;
}

async function call(method, route, params = {}) {
  const body = form(params);
  const url = `${API}${route}${method === 'GET' && [...body].length ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(method === 'POST' ? { body } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message || `Fehler ${res.status}`}`.slice(0, 220));
  return json;
}

const periodEnd = (sub) => (sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? 0) * 1000;

export async function createCheckout({ key, email, successUrl, cancelUrl }) {
  const s = await call('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: { 0: { price: process.env.STRIPE_PRICE_ID, quantity: 1 } },
    success_url: successUrl, cancel_url: cancelUrl,
    client_reference_id: key,
    customer_email: email || undefined,
    allow_promotion_codes: 'true',
  });
  return s.url;
}

/** Prüft die Sitzung nach der Rückkehr. Nur das Konto, für das sie erstellt wurde, darf sie einlösen. */
export async function confirmCheckout(sessionId, key) {
  if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(String(sessionId))) throw new Error('Ungültige Sitzung');
  const s = await call('GET', `/checkout/sessions/${sessionId}`, { expand: { 0: 'subscription' } });
  if (s.client_reference_id !== key) throw new Error('Diese Zahlung gehört zu einem anderen Konto.');
  if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) throw new Error('Die Zahlung ist noch nicht abgeschlossen.');
  const sub = s.subscription;
  if (!sub || typeof sub !== 'object' || !['active', 'trialing'].includes(sub.status)) throw new Error('Das Abo ist nicht aktiv.');
  return { until: periodEnd(sub) + GRACE_MS, customer: typeof s.customer === 'string' ? s.customer : s.customer?.id, subscription: sub.id };
}

/** @returns {{active:boolean, until:number}} */
export async function subscriptionState(subscriptionId) {
  if (!/^sub_[A-Za-z0-9_]+$/.test(String(subscriptionId))) return { active: false, until: 0 };
  const sub = await call('GET', `/subscriptions/${subscriptionId}`);
  return { active: ['active', 'trialing'].includes(sub.status), until: periodEnd(sub) + GRACE_MS };
}

export async function createPortal(customer, returnUrl) {
  const s = await call('POST', '/billing_portal/sessions', { customer, return_url: returnUrl });
  return s.url;
}
