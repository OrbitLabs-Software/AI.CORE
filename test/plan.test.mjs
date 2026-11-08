import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-plan-'));
const plan = await import('../server/plan.js');
const stripe = await import('../server/stripe.js');
const video = await import('../server/video.js');

test('Preise: Wort, Bild, Video, Datei, Analyse, Musik', () => {
  assert.equal(plan.cost('words', 100), 25);
  assert.equal(plan.cost('image'), 45.9);
  assert.equal(plan.cost('video', 4), 63.6);
  assert.equal(plan.cost('fileWords', 100), 50);
  assert.equal(plan.cost('analyzedWords', 100), 75);
  assert.equal(plan.cost('music', 30), 300);
  assert.equal(plan.countWords('  Ein  kurzer\nSatz  '), 3);
  assert.equal(plan.countWords(''), 0);
});

test('Gratis: 4000 Token, danach gesperrt; Rückgabe gibt Token zurück', () => {
  const k = 'u1', t0 = 1_000_000_000_000;
  assert.equal(plan.planStatus(k, { now: t0 }).tokens.limit, 4000);
  assert.equal(plan.charge(k, 3900, { now: t0 }).ok, true);
  const second = plan.charge(k, 200, { now: t0 + 1000 });
  assert.equal(second.ok, false);
  assert.equal(second.status, 402);
  assert.match(second.error, /Pro/);
  assert.match(second.error, /4 Std\./);                                    // setzt sich in 4 Stunden zurück
  plan.refund(k, 3900, { now: t0 + 2000 });
  assert.equal(plan.charge(k, 200, { now: t0 + 3000 }).ok, true);
});

test('Gratis setzt sich nach 4 Stunden zurück, Pro nach 2 Stunden und hat 10 000 Token', () => {
  const t0 = 2_000_000_000_000, H = 3600000;
  plan.charge('r1', 4000, { now: t0 });
  assert.equal(plan.canAfford('r1', 1, { now: t0 + 4 * H - 60000 }).ok, false);   // fast 4 Stunden: noch leer
  assert.equal(plan.canAfford('r1', 4000, { now: t0 + 4 * H }).ok, true);          // nach 4 Stunden: voll
  assert.equal(plan.planStatus('r1', { now: t0 + 4 * H }).tokens.remaining, 4000);

  plan.grantPro('r2', { until: t0 + 30 * 86400000, source: 'code' });
  assert.equal(plan.planStatus('r2', { now: t0 }).tokens.limit, 10000);
  assert.equal(plan.charge('r2', 10000, { now: t0 }).ok, true);
  assert.equal(plan.canAfford('r2', 1, { now: t0 + 2 * H - 60000 }).ok, false);
  assert.equal(plan.canAfford('r2', 10000, { now: t0 + 2 * H }).ok, true);        // Pro: schon nach 2 Stunden
});

test('Antworten werden bis zum Limit abgebucht, nie ins Minus; Konten sind getrennt', () => {
  const t0 = 3_000_000_000_000;
  plan.charge('a1', 3990, { now: t0 });
  const r = plan.charge('a1', 50, { now: t0 + 1, strict: false });
  assert.equal(r.ok, true); assert.equal(r.charged, 10);
  assert.equal(plan.planStatus('a1', { now: t0 + 2 }).tokens.remaining, 0);
  assert.equal(plan.canAfford('a2', 4000, { now: t0 }).ok, true);                  // anderes Konto: eigenes Guthaben
});

test('Pro erhöht das Limit, Besitzer ist unbegrenzt', () => {
  plan.grantPro('u3', { until: Date.now() + 86400000, source: 'code' });
  assert.equal(plan.planStatus('u3').pro, true);
  assert.equal(plan.planStatus('u3').plans.pro.tokens, 10000);
  assert.equal(plan.charge('u3', 9999).ok, true);
  assert.equal(plan.charge('u3', 5).ok, false);
  for (let i = 0; i < 30; i++) assert.equal(plan.charge('boss', 5000, { unlimited: true }).ok, true);
  assert.equal(plan.planStatus('boss', { unlimited: true }).tokens.used, 0);
});

test('Pro läuft ab', () => {
  plan.grantPro('u4', { until: Date.now() - 1000, source: 'stripe' });
  assert.equal(plan.isPro('u4'), false);
});

test('Gesamtlimit als Notbremse', () => {
  process.env.IMAGE_MAX_PER_MONTH_TOTAL = '2';
  assert.equal(plan.globalCapReached('image'), false);
  plan.countGlobal('image'); plan.countGlobal('image');
  assert.equal(plan.globalCapReached('image'), true);
  plan.countGlobal('image', -1);
  assert.equal(plan.globalCapReached('image'), false);
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

test('Hugging Face: Video wird im Hintergrund erzeugt und gespeichert; Fehler lösen die Rückgabe aus', async () => {
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
