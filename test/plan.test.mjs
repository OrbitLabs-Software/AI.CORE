import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-plan-'));
process.env.TOKENS = 'false';   // diese Tests prüfen die alten Monatsgrenzen; Token siehe tokens.test.mjs
const plan = await import('../server/plan.js');
const stripe = await import('../server/stripe.js');
const video = await import('../server/video.js');

test('Gratis: 1 Video pro Monat, danach gesperrt; Rückgabe gibt es zurück', () => {
  const k = 'u1';
  assert.equal(plan.reserve(k, 'video').ok, true);
  const second = plan.reserve(k, 'video');
  assert.equal(second.ok, false);
  assert.equal(second.status, 402);
  assert.match(second.error, /Pro/);
  plan.refund(k, 'video');
  assert.equal(plan.reserve(k, 'video').ok, true);
});

test('Kontingent zählt pro Monat und pro Konto', () => {
  assert.equal(plan.reserve('u2', 'video').ok, true);                       // anderes Konto: eigenes Kontingent
  const nextMonth = Date.now() + 32 * 86400000;
  assert.equal(plan.reserve('u1', 'video', { now: nextMonth }).ok, true);   // neuer Monat
});

test('Pro erhöht das Limit, Besitzer ist unbegrenzt', () => {
  plan.grantPro('u3', { until: Date.now() + 86400000, source: 'code' });
  assert.equal(plan.planStatus('u3').pro, true);
  assert.equal(plan.planStatus('u3').limits.video, 20);
  for (let i = 0; i < 20; i++) assert.equal(plan.reserve('u3', 'video').ok, true);
  assert.equal(plan.reserve('u3', 'video').ok, false);
  for (let i = 0; i < 30; i++) assert.equal(plan.reserve('boss', 'video', { unlimited: true }).ok, true);
});

test('Pro läuft ab', () => {
  plan.grantPro('u4', { until: Date.now() - 1000, source: 'stripe' });
  assert.equal(plan.isPro('u4'), false);
});

test('Gesamtlimit als Notbremse', () => {
  process.env.IMAGE_MAX_PER_MONTH_TOTAL = '2';
  assert.equal(plan.reserve('g1', 'image').ok, true);
  assert.equal(plan.reserve('g2', 'image').ok, true);
  const r = plan.reserve('g3', 'image');
  assert.equal(r.ok, false); assert.equal(r.status, 503);
  delete process.env.IMAGE_MAX_PER_MONTH_TOTAL;
});

test('Codes: einmal einlösbar, verlängern Pro, falsche werden abgelehnt', () => {
  process.env.PRO_CODES = 'ABC-123:30, GESCHENK:365';
  assert.equal(plan.codesEnabled(), true);
  assert.equal(plan.redeemCode('c1', 'falsch').status, 400);
  const r = plan.redeemCode('c1', ' abc-123 ');
  assert.equal(r.ok, true); assert.equal(r.days, 30);
  assert.equal(plan.isPro('c1'), true);
  assert.equal(plan.redeemCode('c2', 'ABC-123').status, 409);
  plan.redeemCode('c1', 'GESCHENK');
  assert.ok(plan.planStatus('c1').until > Date.now() + 390 * 86400000);   // 30 + 365 Tage
});

test('Stripe: Checkout wird als Formular gesendet, Bestätigung prüft das Konto', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_ID = 'price_1';
  assert.equal(stripe.stripeEnabled(), true);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    if (String(url).includes('/checkout/sessions/cs_test_ok')) return Response.json({ status: 'complete', payment_status: 'paid', client_reference_id: 'u9', customer: 'cus_1', subscription: { id: 'sub_1', status: 'active', current_period_end: end } });
    if (String(url).includes('/checkout/sessions/cs_test_other')) return Response.json({ status: 'complete', payment_status: 'paid', client_reference_id: 'jemand-anders', subscription: { id: 'sub_2', status: 'active' } });
    if (String(url).includes('/checkout/sessions/cs_test_open')) return Response.json({ status: 'open', payment_status: 'unpaid', client_reference_id: 'u9' });
    if (String(url).endsWith('/checkout/sessions')) return Response.json({ url: 'https://checkout.stripe.com/c/pay/x' });
    if (String(url).includes('/subscriptions/sub_1')) return Response.json({ status: 'canceled' });
    return Response.json({ error: { message: 'nope' } }, { status: 404 });
  };
  try {
    const url = await stripe.createCheckout({ key: 'u9', email: 'a@b.at', successUrl: 'https://x/#pro=success&session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://x/#pro=cancel' });
    assert.equal(url, 'https://checkout.stripe.com/c/pay/x');
    const body = String(calls[0].opts.body);
    assert.match(body, /mode=subscription/);
    assert.match(body, /line_items%5B0%5D%5Bprice%5D=price_1/);
    assert.match(body, /client_reference_id=u9/);
    assert.match(calls[0].opts.headers.Authorization, /^Bearer sk_test_x$/);

    const ok = await stripe.confirmCheckout('cs_test_ok', 'u9');
    assert.equal(ok.subscription, 'sub_1'); assert.equal(ok.customer, 'cus_1');
    assert.ok(ok.until > Date.now() + 30 * 86400000);
    await assert.rejects(stripe.confirmCheckout('cs_test_ok', 'anderer'), /anderen Konto/);
    await assert.rejects(stripe.confirmCheckout('cs_test_other', 'u9'), /anderen Konto/);
    await assert.rejects(stripe.confirmCheckout('cs_test_open', 'u9'), /nicht abgeschlossen/);
    await assert.rejects(stripe.confirmCheckout('../../etc', 'u9'), /Ungültig/);
    assert.deepEqual(await stripe.subscriptionState('sub_1'), { active: false, until: (await stripe.subscriptionState('sub_1')).until });
  } finally { globalThis.fetch = realFetch; }
});

test('Hugging Face: Video wird im Hintergrund erzeugt und gespeichert; Fehler geben das Kontingent zurück', async () => {
  process.env.HF_TOKEN = 'hf_x'; process.env.HF_VIDEO_MODEL = 'Lightricks/LTX-Video';
  assert.equal(video.videoBackend(), 'huggingface');
  let args;
  video._setHfLoader(async () => ({ InferenceClient: class { textToVideo(a) { args = a; return Promise.resolve(new Blob([new Uint8Array([0, 0, 0, 24])])); } } }));
  const id = await video.startVideo('Ein Fuchs im Schnee');
  assert.match(id, /^hf_[a-f0-9]{16}$/);
  assert.equal((await video.videoStatus(id)).status, 'working');
  for (let i = 0; i < 50 && (await video.videoStatus(id)).status !== 'done'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal((await video.videoStatus(id)).status, 'done');
  assert.equal(args.inputs, 'Ein Fuchs im Schnee'); assert.equal(args.model, 'Lightricks/LTX-Video');
  assert.ok(fs.existsSync(video.videoFile(id)));

  let failed = 0;
  video._setHfLoader(async () => ({ InferenceClient: class { textToVideo() { return Promise.reject(new Error('402 Payment Required')); } } }));
  const bad = await video.startVideo('x', { onFail: () => failed++ });
  for (let i = 0; i < 50 && (await video.videoStatus(bad)).status === 'working'; i++) await new Promise(r => setTimeout(r, 20));
  const st = await video.videoStatus(bad);
  assert.equal(st.status, 'failed'); assert.match(st.error, /Guthaben/); assert.equal(failed, 1);

  video._setHfLoader(async () => { throw new Error('Cannot find package'); });
  const missing = await video.startVideo('y');
  for (let i = 0; i < 50 && (await video.videoStatus(missing)).status === 'working'; i++) await new Promise(r => setTimeout(r, 20));
  assert.match((await video.videoStatus(missing)).error, /npm install @huggingface\/inference/);
});
