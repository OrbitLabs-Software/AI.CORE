import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import {
  streamAiResponse, getConfig, contextBudget, resolveModel, listAllModels,
  warmUpModel, pullOllamaModel,
} from './ai.js';
import { buildContext } from './context.js';
import { processUploadedFile } from './fileProcessor.js';
import {
  requireAuth, rateLimit, loginLimiter, loginHandler, firebaseLoginHandler, logoutHandler, authInfo, sessionFromRequest,
  authEnabled, originAllowed, isAuthenticated,
} from './security.js';
import { keyFor, listMemories, addMemory, deleteMemory, clearMemories, memoryPrompt, memoryEnabled, MAX_ITEMS } from './memory.js';
import { createPreview } from './preview.js';
import { createShare, readShare, deleteShare, shareEnabled } from './share.js';
import { generateImage, imageEnabled } from './image.js';
import { startVideo, videoStatus, videoFile, videoEnabled } from './video.js';
import { planStatus, canAfford, charge, refund, cost, countWords, globalCapReached, countGlobal, grantPro, revokePro, proInfo, redeemCode, codesEnabled } from './plan.js';
import { webSearch, searchEnabled, readPage } from './search.js';
import * as library from './library.js';
import { startPull, pullStatus, cancelPull, deleteModel, SUGGESTED, diskFree } from './models.js';
import { getLogs } from './logbuffer.js';
import { isOwnerSession } from './owner.js';
import { syncEnabled, pull as syncPull, push as syncPush, prune as syncPrune, wipe as syncWipe } from './sync.js';
import { record, snapshot } from './metrics.js';
import { parseApiKeys, checkApiKey, errorBody, toInternal, createThinkFilter, completionId, chunk, completion, modelList, estimateTokens } from './openai.js';
import { stripeEnabled, createCheckout, confirmCheckout, subscriptionState, createPortal } from './stripe.js';

export const VERSION = '5.1.0';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 30,
  message: 'Zu viele Nachrichten in kurzer Zeit. Bitte kurz warten.',
});
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Zu viele Uploads. Bitte kurz warten.' });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 12 });
const lightLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_CHATS) || 2;
const MAX_UPLOADS = 2; // gleichzeitig; PDF-Lesen kostet auf dem Tiny viel CPU
let activeChats = 0;
let activeUploads = 0;
let pulling = false;

export const router = Router();

// ---------- Öffentlich ----------
const apiKeys = () => parseApiKeys(process.env.API_KEYS);
/** Nur http(s)-Adressen für Impressum, Datenschutz und AGB. */
const legalLinks = () => Object.fromEntries([['imprint', 'LEGAL_IMPRINT_URL'], ['privacy', 'LEGAL_PRIVACY_URL'], ['terms', 'LEGAL_TERMS_URL']]
  .map(([k, e]) => [k, /^https?:\/\/[^\s]+$/.test(process.env[e] || '') ? process.env[e] : '']).filter(([, v]) => v));
const isOwner = (req) => !authEnabled() || isOwnerSession(sessionFromRequest(req));

router.get('/config', (req, res) => {
  const cfg = getConfig();
  res.json({
    version: VERSION, provider: cfg.provider,
    features: { search: searchEnabled(), image: imageEnabled(), video: videoEnabled(), share: shareEnabled(), pro: stripeEnabled() || codesEnabled(), api: apiKeys().length > 0, sync: syncEnabled(), library: library.libraryEnabled(), read: searchEnabled() },
    legal: legalLinks(), owner: isAuthenticated(req) && isOwner(req),
    ...authInfo(req),
  });
});
// Geteilte Chats lesen: ohne Anmeldung (der Link ist das Geheimnis).
router.get('/share/:id', lightLimiter, (req, res) => {
  const data = shareEnabled() ? readShare(req.params.id) : null;
  if (!data) return res.status(404).json({ error: 'Dieser Link gibt es nicht (mehr).' });
  res.json(data);
});
router.post('/login', loginLimiter, loginHandler);
router.post('/auth/firebase', loginLimiter, firebaseLoginHandler);
router.post('/logout', logoutHandler);

// ---------- Ab hier nur mit Anmeldung (falls aktiv) ----------
router.use(requireAuth);

router.get('/health', async (req, res) => {
  const cfg = getConfig();
  const { models, status, defaultModel } = await listAllModels(cfg);
  const ollama = status.ollama;
  res.json({
    ok: true,
    version: VERSION,
    provider: cfg.provider,
    mode: models.length ? 'live' : 'demo',
    model: defaultModel,
    models,
    status,
    reachable: ollama.enabled ? ollama.reachable : null,
    loaded: ollama.loaded || [],
    ...(ollama.enabled && !ollama.reachable ? { error: ollama.error } : {}),
    memory: memoryEnabled(),
    limits: { numCtx: cfg.numCtx, maxTokens: cfg.maxTokens, cloudContext: cfg.cloudContext },
  });
});

router.get('/models', async (req, res) => {
  const cfg = getConfig();
  const info = await listAllModels(cfg);
  res.json({ ...info, admin: cfg.ollamaEnabled && cfg.modelAdmin });
});

// Modell vorab in den Speicher laden (z. B. beim Wechsel des Modells im Chat).
router.post('/warmup', adminLimiter, (req, res) => {
  const target = resolveModel(req.body?.model);
  if (target.provider === 'ollama') warmUpModel(target.model).catch(e => console.warn('[warmup]', e.message));
  res.status(202).json({ ok: true });
});

// Modell herunterladen (nur Ollama), Fortschritt als Server-Sent-Events.
router.post('/models/pull', adminLimiter, async (req, res) => {
  const cfg = getConfig();
  if (!cfg.ollamaEnabled || !cfg.modelAdmin) return res.status(403).json({ error: 'Modellverwaltung ist deaktiviert' });
  const name = String(req.body?.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(name)) return res.status(400).json({ error: 'Ungültiger Modellname' });
  if (pulling) return res.status(409).json({ error: 'Es läuft bereits ein Download' });

  pulling = true;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    await pullOllamaModel(name, send, ac.signal, cfg);
    send({ status: 'success', percent: 100, done: true });
  } catch (e) {
    if (!ac.signal.aborted) send({ error: e.message });
  } finally {
    pulling = false;
    if (!res.writableEnded) res.end();
  }
});

router.post('/upload', uploadLimiter, (req, res, next) => {
  if (activeUploads >= MAX_UPLOADS) return res.status(429).json({ error: 'Es werden gerade Dateien gelesen. Bitte gleich erneut versuchen.' });
  activeUploads += 1;
  res.on('close', () => { activeUploads -= 1; });
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei empfangen' });
  try {
    const info = await processUploadedFile(req.file);
    // Wörter in der Datei kosten Token (nur gelesener Text; Bilder ohne Text sind frei)
    const acct = accountOf(req);
    const price = cost('fileWords', countWords(info.extractedText));
    const q = charge(acct.key, price, { unlimited: acct.unlimited, kind: 'file' });
    if (!q.ok) return res.status(q.status).json({ error: q.error });
    res.json({ ...info, tokens: q.charged });
  } catch (e) {
    console.error('upload processing failed', e);
    res.status(500).json({ error: 'Verarbeitung fehlgeschlagen' });
  }
});

// ---------- Erinnerungen ----------
const memKey = (req) => keyFor(sessionFromRequest(req));

router.get('/memories', lightLimiter, (req, res) => {
  res.json({ enabled: memoryEnabled(), max: MAX_ITEMS, items: memoryEnabled() ? listMemories(memKey(req)) : [] });
});
router.post('/memories', lightLimiter, (req, res) => {
  if (!memoryEnabled()) return res.status(403).json({ error: 'Erinnerungen sind deaktiviert' });
  const r = addMemory(memKey(req), req.body?.text);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json({ item: r.item });
});
router.delete('/memories/:id', lightLimiter, (req, res) => {
  res.status(deleteMemory(memKey(req), req.params.id) ? 200 : 404).json({ ok: true });
});
router.delete('/memories', lightLimiter, (req, res) => {
  res.json({ ok: true, removed: clearMemories(memKey(req)) });
});

// ---------- Teilen ----------
router.post('/share', lightLimiter, (req, res) => {
  if (!shareEnabled()) return res.status(403).json({ error: 'Teilen ist deaktiviert' });
  const r = createShare(req.body?.chat, sessionFromRequest(req)?.sub || '');
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json({ id: r.id });
});
router.delete('/share/:id', lightLimiter, (req, res) => {
  res.status(deleteShare(req.params.id, sessionFromRequest(req)?.sub || '') ? 200 : 404).json({ ok: true });
});

// ---------- Websuche ----------
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: 'Zu viele Suchen. Bitte kurz warten.' });
router.post('/search', searchLimiter, async (req, res) => {
  if (!searchEnabled()) return res.status(403).json({ error: 'Die Websuche ist abgeschaltet.' });
  record('search', memKey(req));
  try { res.json(await webSearch(req.body?.query, { deep: req.body?.deep === true })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Konto, Tarif, Kontingent ----------
const accountOf = (req) => {
  const s = sessionFromRequest(req);
  return { key: keyFor(s), session: s, unlimited: !authEnabled() || isOwnerSession(s) };
};

/** Stripe-Abo bei Ablauf der Periode erneut prüfen (kein Webhook nötig); höchstens alle 10 Minuten. */
async function syncStripe(key) {
  const info = proInfo(key);
  if (!stripeEnabled() || info?.source !== 'stripe' || !info.subscription) return;
  if (info.until > Date.now() + 86400000 || Date.now() - (info.checkedAt || 0) < 600000) return;
  try {
    const s = await subscriptionState(info.subscription);
    if (s.active) grantPro(key, { ...info, until: s.until }); else revokePro(key);
  } catch (e) { console.warn('[pro]', e.message); }
}

// ---------- Bilder ----------
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: 'Zu viele Bilder in kurzer Zeit. Bitte kurz warten.' });
let imageBusy = false;
router.post('/image', imageLimiter, async (req, res) => {
  if (!imageEnabled()) return res.status(501).json({ error: 'Bilderzeugung ist nicht eingerichtet (IMAGE_API_KEY in der .env).' });
  const prompt = String(req.body?.prompt || '').trim().slice(0, 1500);
  if (!prompt) return res.status(400).json({ error: 'Bitte beschreibe das Bild.' });
  if (imageBusy) return res.status(429).json({ error: 'Es wird gerade ein Bild erzeugt. Bitte gleich erneut.' });
  const acct = accountOf(req);
  const price = cost('image');
  if (globalCapReached('image')) return res.status(503).json({ error: 'Für diesen Monat ist das Gesamtlimit für Bilder erreicht. Ab dem nächsten Monat geht es wieder.' });
  const q = charge(acct.key, price, { unlimited: acct.unlimited, kind: 'image' });
  if (!q.ok) return res.status(q.status).json({ error: q.error });
  countGlobal('image');
  imageBusy = true;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    record('image', memKey(req));
    const { b64, mime } = await generateImage(prompt, ac.signal);
    res.json({ image: `data:${mime};base64,${b64}` });
  } catch (e) {
    refund(acct.key, q.charged); countGlobal('image', -1);
    if (!ac.signal.aborted) { console.warn('[image]', e.message); res.status(502).json({ error: e.message || 'Bild fehlgeschlagen' }); }
  } finally { imageBusy = false; }
});

// ---------- Videos ----------
const videoLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 6, message: 'Zu viele Videos in kurzer Zeit. Bitte später erneut.' });
router.post('/video', videoLimiter, async (req, res) => {
  if (!videoEnabled()) return res.status(501).json({ error: 'Videoerstellung ist nicht eingerichtet (VIDEO_API_KEY in der .env).' });
  const prompt = String(req.body?.prompt || '').trim().slice(0, 1500);
  if (!prompt) return res.status(400).json({ error: 'Bitte beschreibe das Video.' });
  const acct = accountOf(req);
  const seconds = Number(process.env.VIDEO_SECONDS) > 0 ? Number(process.env.VIDEO_SECONDS) : 4;
  if (globalCapReached('video')) return res.status(503).json({ error: 'Für diesen Monat ist das Gesamtlimit für Videos erreicht. Ab dem nächsten Monat geht es wieder.' });
  const q = charge(acct.key, cost('video', seconds), { unlimited: acct.unlimited, kind: 'video' });
  if (!q.ok) return res.status(q.status).json({ error: q.error });
  countGlobal('video');
  const giveBack = () => { refund(acct.key, q.charged); countGlobal('video', -1); };
  record('video', memKey(req));
  try { res.status(202).json({ id: await startVideo(prompt, { onFail: giveBack }), tokens: q.charged }); }
  catch (e) { giveBack(); console.warn('[video]', e.message); res.status(502).json({ error: e.message }); }
});
router.get('/video/:id', lightLimiter, async (req, res) => {
  try { res.json(await videoStatus(req.params.id)); }
  catch (e) { res.status(502).json({ status: 'failed', error: e.message }); }
});
router.get('/video/:id/file', lightLimiter, (req, res) => {
  const file = videoFile(req.params.id);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Video nicht gefunden' });
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(file).pipe(res);
});

// ---------- AI Core Pro ----------
const proLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 12, message: 'Zu viele Versuche. Bitte später erneut.' });
const needAccount = (req, res) => {
  if (authEnabled()) return true;
  res.status(400).json({ error: 'Pro gehört zu einem Konto. Ohne Anmeldung gibt es keine Konten, hier ist ohnehin alles frei.' });
  return false;
};
/** Rückkehradresse: nur die eigene Seite oder eine erlaubte (GitHub-Seite), sonst PUBLIC_URL. */
function returnBase(req) {
  try {
    const u = new URL(String(req.body?.returnUrl || ''));
    if (['http:', 'https:'].includes(u.protocol) && (u.host === req.headers.host || originAllowed(u.origin))) return u.origin + u.pathname;
  } catch { /* weiter */ }
  return process.env.PUBLIC_URL ? String(process.env.PUBLIC_URL).replace(/\/+$/, '') + '/' : null;
}

router.get('/plan', lightLimiter, async (req, res) => {
  const acct = accountOf(req);
  await syncStripe(acct.key);
  res.json({ ...planStatus(acct.key, acct), billing: { stripe: stripeEnabled(), codes: codesEnabled(), price: process.env.PRO_PRICE_LABEL || '16,99 € pro Monat' } });
});

router.post('/pro/checkout', proLimiter, async (req, res) => {
  if (!stripeEnabled()) return res.status(501).json({ error: 'Bezahlung ist nicht eingerichtet (STRIPE_SECRET_KEY und STRIPE_PRICE_ID in der .env).' });
  if (!needAccount(req, res)) return;
  const base = returnBase(req);
  if (!base) return res.status(400).json({ error: 'Rückkehradresse ungültig. Trage PUBLIC_URL in der .env ein.' });
  const acct = accountOf(req);
  try {
    const url = await createCheckout({ key: acct.key, email: acct.session?.email, successUrl: `${base}#pro=success&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}#pro=cancel` });
    res.json({ url });
  } catch (e) { console.warn('[pro]', e.message); res.status(502).json({ error: e.message }); }
});

router.post('/pro/confirm', proLimiter, async (req, res) => {
  if (!stripeEnabled()) return res.status(501).json({ error: 'Bezahlung ist nicht eingerichtet.' });
  if (!needAccount(req, res)) return;
  const acct = accountOf(req);
  try {
    grantPro(acct.key, { source: 'stripe', ...(await confirmCheckout(req.body?.sessionId, acct.key)) });
    res.json(planStatus(acct.key, acct));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/pro/portal', proLimiter, async (req, res) => {
  const acct = accountOf(req);
  const info = proInfo(acct.key);
  const base = returnBase(req);
  if (!stripeEnabled() || !info?.customer || !base) return res.status(400).json({ error: 'Kein Abo zum Verwalten gefunden.' });
  try { res.json({ url: await createPortal(info.customer, base) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/pro/redeem', proLimiter, (req, res) => {
  if (!needAccount(req, res)) return;
  const acct = accountOf(req);
  const r = redeemCode(acct.key, String(req.body?.code || '').slice(0, 80));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json(planStatus(acct.key, acct));
});

// ---------- Code-Vorschau (HTML/SVG im Sandbox-iframe) ----------
router.post('/preview', lightLimiter, (req, res) => {
  const r = createPreview(req.body?.kind, req.body?.code);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ url: r.url });
});

// ---------- Token: Datenanalyse ----------
// Die Auswertung läuft im Browser; die Oberfläche bucht die analysierten Wörter vorher hier ab.
router.post('/tokens/analyze', lightLimiter, (req, res) => {
  const acct = accountOf(req);
  const words = Math.min(500000, Math.max(0, Math.floor(Number(req.body?.words) || 0)));
  const q = charge(acct.key, cost('analyzedWords', words), { unlimited: acct.unlimited, kind: 'analysis' });
  if (!q.ok) return res.status(q.status).json({ error: q.error });
  res.json({ charged: q.charged, ...planStatus(acct.key, acct) });
});

// ---------- Chat (SSE) ----------
// Ereignisse:  {delta, demo}  {meta:{tokens,tps,…}}  {notice:'trimmed'|'images_ignored'|'memory'}  [DONE]
router.post('/chat/stream', chatLimiter, async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages[] erforderlich' });
  }
  if (activeChats >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Der Server bearbeitet gerade andere Anfragen. Bitte gleich erneut senden.' });
  }

  // Token: Frage vorab abbuchen, Antwort nach dem Streamen (nach tatsächlich erzeugten Wörtern)
  const acct = accountOf(req);
  const lastUser = [...body.messages].reverse().find(m => m?.role === 'user');
  const ask = cost('words', countWords(lastUser?.content));
  const pre = canAfford(acct.key, ask, acct);
  if (!pre.ok) return res.status(pre.status).json({ error: pre.error, tokens: planStatus(acct.key, acct).tokens });
  charge(acct.key, ask, { unlimited: acct.unlimited, strict: false, kind: 'chat' });

  const cfg = getConfig();
  let system = typeof body.system === 'string' && body.system.trim() ? body.system.trim().slice(0, Number(process.env.MAX_SYSTEM_CHARS) || 30000) : cfg.systemPrompt;
  let usedMemory = false;
  if (memoryEnabled() && body.memory !== false) {
    const mem = memoryPrompt(memKey(req));
    if (mem) { system = `${system}\n\n${mem}`; usedMemory = true; }
  }
  const temperature = Number.isFinite(body.temperature) ? Math.min(1.5, Math.max(0, body.temperature)) : undefined;
  const requested = typeof body.model === 'string' ? body.model.slice(0, 120) : undefined;
  const target = resolveModel(requested, cfg);
  const ctx = buildContext({ messages: body.messages, budgetTokens: contextBudget(cfg, system, target.provider), model: target.model });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);

  activeChats += 1;
  let replyText = '';
  record('chat', memKey(req));
  try {
    if (ctx.trimmed) send({ notice: 'trimmed', dropped: ctx.dropped });
    if (usedMemory) send({ notice: 'memory' });
    ctx.notices.forEach(n => send({ notice: n }));
    await streamAiResponse(
      { messages: ctx.messages, model: requested, system, temperature },
      (delta, meta) => { replyText += delta; send({ delta, demo: meta?.demo || false }); },
      ac.signal,
      (meta) => { send({ meta }); if (meta?.tokens) record('tokens', '', meta.tokens); },
    );
  } catch (e) {
    record('errors');
    console.error('stream error', e);
  } finally {
    clearInterval(ping);
    activeChats -= 1;
    const spent = charge(acct.key, cost('words', countWords(replyText)), { unlimited: acct.unlimited, strict: false, kind: 'chat' });
    if (!res.writableEnded && spent.ok) { try { res.write(`data: ${JSON.stringify({ tokens: planStatus(acct.key, acct).tokens })}\n\n`); } catch {} }
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// ---------- Links lesen ----------
router.post('/read', searchLimiter, async (req, res) => {
  if (!searchEnabled()) return res.status(403).json({ error: 'Das Lesen von Links ist abgeschaltet.' });
  record('search', memKey(req));
  try { res.json(await readPage(String(req.body?.url || '').slice(0, 2000))); }
  catch (e) { res.status(502).json({ error: `Der Link konnte nicht gelesen werden: ${e.message}` }); }
});

// ---------- Bibliothek ----------
const libLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Zu viele Anfragen. Bitte kurz warten.' });
const libOff = (res) => res.status(403).json({ error: 'Die Bibliothek ist auf dem Server abgeschaltet.' });
router.get('/library', libLimiter, (req, res) => {
  if (!library.libraryEnabled()) return libOff(res);
  const key = accountOf(req).key;
  res.json({ docs: library.list(key), ...library.stats(key) });
});
router.post('/library', libLimiter, (req, res) => {
  if (!library.libraryEnabled()) return libOff(res);
  const r = library.add(accountOf(req).key, req.body?.name, req.body?.text);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json(r);
});
router.delete('/library/:id', libLimiter, (req, res) => {
  if (!library.libraryEnabled()) return libOff(res);
  const ok = library.remove(accountOf(req).key, String(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});
router.post('/library/search', libLimiter, (req, res) => {
  if (!library.libraryEnabled()) return libOff(res);
  const budget = Math.min(12000, Math.max(500, Number(req.body?.budget) || 4000));
  res.json(library.search(accountOf(req).key, String(req.body?.query || '').slice(0, 500), budget));
});

// ---------- Geräte-Abgleich ----------
const syncLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: 'Zu viele Abgleiche. Bitte kurz warten.' });
const syncOff = (res) => res.status(403).json({ error: 'Der Abgleich ist auf dem Server abgeschaltet.' });
router.get('/sync', syncLimiter, (req, res) => {
  if (!syncEnabled()) return syncOff(res);
  const key = accountOf(req).key;
  syncPrune(key);
  res.json(syncPull(key, req.query.since));
});
router.post('/sync', syncLimiter, (req, res) => {
  if (!syncEnabled()) return syncOff(res);
  const r = syncPush(accountOf(req).key, req.body);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.delete('/sync', syncLimiter, (req, res) => res.json({ ok: syncWipe(accountOf(req).key) }));

// ---------- Server-Übersicht (nur Besitzer) ----------
function dirStats(dir, depth = 0) {
  let files = 0, bytes = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) { const r = dirStats(p, depth + 1); files += r.files; bytes += r.bytes; }
      else if (e.isFile()) { files += 1; bytes += fs.statSync(p).size; }
    }
  } catch { /* Ordner fehlt */ }
  return { files, bytes };
}

router.get('/admin/status', lightLimiter, async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Nur für den Besitzer.' });
  const dataDir = process.env.AICORE_DATA_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  const mb = (n) => Math.round(n / 1048576);
  res.json({
    version: VERSION, node: process.version, platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(process.uptime()),
    memory: { processMB: mb(process.memoryUsage().rss), freeMB: mb(os.freemem()), totalMB: mb(os.totalmem()) },
    load: os.loadavg().map(n => Math.round(n * 100) / 100), cpus: os.cpus().length,
    data: { all: dirStats(dataDir), shares: dirStats(path.join(dataDir, 'shares')), videos: dirStats(path.join(dataDir, 'videos')) },
    auth: authEnabled() ? 'an' : 'AUS',
    features: { search: searchEnabled(), image: imageEnabled(), video: videoEnabled(), share: shareEnabled(), stripe: stripeEnabled(), codes: codesEnabled(), apiKeys: apiKeys().length },
    searchProvider: process.env.BRAVE_API_KEY ? 'Brave' : process.env.SEARXNG_URL ? 'SearXNG' : 'DuckDuckGo/Wikipedia',
    trustProxy: String(process.env.TRUST_PROXY || 'loopback'),
    activeChats, metrics: snapshot(14),
  });
});

// ---------- Modelle und Meldungen verwalten (nur Besitzer) ----------
const ownerOnly = (req, res) => { if (isOwner(req)) return true; res.status(403).json({ error: 'Nur für den Besitzer.' }); return false; };
router.get('/admin/models', lightLimiter, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const cfg = getConfig();
  const { models, status } = await listAllModels(cfg);
  res.json({
    enabled: Boolean(cfg.ollamaEnabled), reachable: status.ollama?.reachable ?? false,
    installed: models.filter(m => m.provider === 'ollama').map(m => ({ name: m.label, size: m.size || 0, loaded: Boolean(m.loaded) })),
    suggested: SUGGESTED, pull: pullStatus(), disk: diskFree(),
  });
});
router.post('/admin/models/pull', lightLimiter, (req, res) => {
  if (!ownerOnly(req, res)) return;
  if (!getConfig().ollamaEnabled) return res.status(400).json({ error: 'Ollama ist nicht eingerichtet.' });
  try { res.status(202).json(startPull(String(req.body?.name || '').trim(), getConfig())); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/admin/models/pull', lightLimiter, (req, res) => { if (ownerOnly(req, res)) res.json({ ok: cancelPull() }); });
router.post('/admin/models/delete', lightLimiter, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  try { await deleteModel(String(req.body?.name || '').trim(), getConfig()); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/admin/logs', lightLimiter, (req, res) => {
  if (!ownerOnly(req, res)) return;
  res.json({ logs: getLogs({ level: ['all', 'warn', 'error'].includes(req.query.level) ? req.query.level : 'all', limit: Number(req.query.limit) || 100 }) });
});

// ---------- OpenAI-kompatible Schnittstelle (/v1) für andere Programme ----------
// Schlüssel in der .env: API_KEYS=name:schluessel (mindestens 16 Zeichen). Ohne Schlüssel ist /v1 aus.
export const openaiRouter = Router();
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_PER_MINUTE) || 30, message: 'Zu viele Anfragen. Bitte kurz warten.', keyFn: (req) => req.apiKeyName || req.ip });

openaiRouter.use((req, res, next) => {
  const keys = apiKeys();
  if (!keys.length) return res.status(404).json(errorBody('Die API ist nicht eingerichtet (API_KEYS in der .env).', 'not_found'));
  const name = checkApiKey(req.headers.authorization, keys);
  if (!name) return res.status(401).json(errorBody('Ungültiger oder fehlender API-Schlüssel.', 'authentication_error', 'invalid_api_key'));
  req.apiKeyName = name;
  next();
});
openaiRouter.use(apiLimiter);

openaiRouter.get('/models', async (req, res) => {
  const { models } = await listAllModels(getConfig());
  res.json(modelList(models.map(m => m.id)));
});

openaiRouter.post('/chat/completions', async (req, res) => {
  const r = toInternal(req.body);
  if (r.error) return res.status(400).json(errorBody(r.error));
  if (activeChats >= MAX_CONCURRENT) return res.status(429).json(errorBody('Der Server bearbeitet gerade andere Anfragen. Bitte gleich erneut senden.', 'rate_limit_error'));

  const cfg = getConfig();
  const system = r.system || cfg.systemPrompt;   // Erinnerungen der Konten werden hier bewusst nie mitgeschickt
  const target = resolveModel(r.model, cfg);
  const ctx = buildContext({ messages: r.messages, budgetTokens: contextBudget(cfg, system, target.provider), model: target.model });
  const id = completionId(), created = Math.floor(Date.now() / 1000), modelId = r.model || `${target.provider}/${target.model}`;
  const keep = process.env.API_KEEP_THINK === 'true';
  const filter = createThinkFilter();
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const promptTokens = estimateTokens(system) + ctx.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  let out = '', demo = false;
  const usage = () => ({ prompt_tokens: promptTokens, completion_tokens: estimateTokens(out), total_tokens: promptTokens + estimateTokens(out) });

  activeChats += 1;
  record('api', req.apiKeyName);
  if (r.stream) {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
    send(chunk({ id, created, model: modelId, role: 'assistant', content: '' }));
    try {
      await streamAiResponse({ messages: ctx.messages, model: r.model, system, temperature: r.temperature }, (delta, meta) => {
        if (meta?.demo) { demo = true; return; }   // Demo-Text ist keine echte Antwort
        const text = keep ? delta : filter.push(delta);
        if (text) { out += text; send(chunk({ id, created, model: modelId, content: text })); }
      }, ac.signal);
      const tail = keep ? '' : filter.end();
      if (tail) { out += tail; send(chunk({ id, created, model: modelId, content: tail })); }
      if (demo) send(errorBody('Das Modell ist nicht erreichbar.', 'server_error'));
      send(chunk({ id, created, model: modelId, finish: 'stop' }));
      if (r.includeUsage) send({ ...chunk({ id, created, model: modelId }), choices: [], usage: usage() });
    } catch (e) { record('errors'); console.error('[api] stream', e.message); send(errorBody('Interner Fehler', 'server_error')); }
    finally { activeChats -= 1; record('apiTokens', '', estimateTokens(out)); if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); } }
    return;
  }
  try {
    await streamAiResponse({ messages: ctx.messages, model: r.model, system, temperature: r.temperature }, (delta, meta) => {
      if (meta?.demo) { demo = true; return; }   // Demo-Text ist keine echte Antwort
      out += keep ? delta : filter.push(delta);
    }, ac.signal);
    if (!keep) out += filter.end();
    if (demo) return res.status(503).json(errorBody('Das Modell ist nicht erreichbar.', 'server_error'));
    res.json(completion({ id, created, model: modelId, text: out.trim(), usage: usage() }));
  } catch (e) { record('errors'); console.error('[api]', e.message); if (!res.headersSent) res.status(500).json(errorBody('Interner Fehler', 'server_error')); }
  finally { activeChats -= 1; record('apiTokens', '', estimateTokens(out)); }
});

openaiRouter.use((req, res) => res.status(404).json(errorBody('Unbekannte Adresse.', 'not_found')));
