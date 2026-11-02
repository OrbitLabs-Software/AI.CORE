import fs from 'fs';
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
} from './security.js';
import { keyFor, listMemories, addMemory, deleteMemory, clearMemories, memoryPrompt, memoryEnabled, MAX_ITEMS } from './memory.js';
import { createPreview } from './preview.js';
import { createShare, readShare, deleteShare, shareEnabled } from './share.js';
import { generateImage, imageEnabled } from './image.js';
import { startVideo, videoStatus, videoFile, videoEnabled } from './video.js';

export const VERSION = '3.2.0';

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
router.get('/config', (req, res) => {
  const cfg = getConfig();
  res.json({ version: VERSION, provider: cfg.provider, features: { image: imageEnabled(), video: videoEnabled(), share: shareEnabled() }, ...authInfo(req) });
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
    res.json(await processUploadedFile(req.file));
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

// ---------- Bilder ----------
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: 'Zu viele Bilder in kurzer Zeit. Bitte kurz warten.' });
let imageBusy = false;
router.post('/image', imageLimiter, async (req, res) => {
  if (!imageEnabled()) return res.status(501).json({ error: 'Bilderzeugung ist nicht eingerichtet (IMAGE_API_KEY in der .env).' });
  const prompt = String(req.body?.prompt || '').trim().slice(0, 1500);
  if (!prompt) return res.status(400).json({ error: 'Bitte beschreibe das Bild.' });
  if (imageBusy) return res.status(429).json({ error: 'Es wird gerade ein Bild erzeugt. Bitte gleich erneut.' });
  imageBusy = true;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const { b64, mime } = await generateImage(prompt, ac.signal);
    res.json({ image: `data:${mime};base64,${b64}` });
  } catch (e) {
    if (!ac.signal.aborted) { console.warn('[image]', e.message); res.status(502).json({ error: e.message || 'Bild fehlgeschlagen' }); }
  } finally { imageBusy = false; }
});

// ---------- Videos ----------
const videoLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 4, message: 'Zu viele Videos in kurzer Zeit. Bitte später erneut.' });
router.post('/video', videoLimiter, async (req, res) => {
  if (!videoEnabled()) return res.status(501).json({ error: 'Videoerstellung ist nicht eingerichtet (VIDEO_API_KEY in der .env).' });
  const prompt = String(req.body?.prompt || '').trim().slice(0, 1500);
  if (!prompt) return res.status(400).json({ error: 'Bitte beschreibe das Video.' });
  try { res.status(202).json({ id: await startVideo(prompt) }); }
  catch (e) { console.warn('[video]', e.message); res.status(502).json({ error: e.message }); }
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

// ---------- Code-Vorschau (HTML/SVG im Sandbox-iframe) ----------
router.post('/preview', lightLimiter, (req, res) => {
  const r = createPreview(req.body?.kind, req.body?.code);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ url: r.url });
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
  try {
    if (ctx.trimmed) send({ notice: 'trimmed', dropped: ctx.dropped });
    if (usedMemory) send({ notice: 'memory' });
    ctx.notices.forEach(n => send({ notice: n }));
    await streamAiResponse(
      { messages: ctx.messages, model: requested, system, temperature },
      (delta, meta) => send({ delta, demo: meta?.demo || false }),
      ac.signal,
      (meta) => send({ meta }),
    );
  } catch (e) {
    console.error('stream error', e);
  } finally {
    clearInterval(ping);
    activeChats -= 1;
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});
