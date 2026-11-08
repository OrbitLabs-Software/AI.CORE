import { install as installLogBuffer } from './logbuffer.js';
installLogBuffer();
import { trustProxySetting } from './proxy.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config(); // vor den Modulen laden, die die Umgebung lesen

const { router, openaiRouter, VERSION } = await import('./routes.js');
const { getConfig, warmUpModel, listOllamaModels } = await import('./ai.js');
const { securityHeaders, sameOriginGuard, cors, authEnabled, passwordEnabled, requireAuth } = await import('./security.js');
const { previewHandler } = await import('./preview.js');
const { firebaseEnabled, hasAllowRules } = await import('./firebaseAuth.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // im Heimnetz erreichbar

app.disable('x-powered-by');
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
app.use(securityHeaders);
app.use(express.json({ limit: '12mb' }));
app.use('/api', cors, sameOriginGuard, router);
app.use('/v1', cors, openaiRouter);
app.get('/preview/:id', requireAuth, previewHandler);

// Nur das Frontend wird ausgeliefert — nicht server/, data/, .env oder package.json.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/src', express.static(path.join(ROOT, 'src'), { maxAge: '5m' }));
app.use('/public', express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));
// App-Installation (PWA): Manifest, Symbole und Service Worker liegen im Wurzelverzeichnis der Seite.
app.use(express.static(path.join(ROOT, 'pwa'), { maxAge: '1h', setHeaders: (res, file) => {
  if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
} }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
app.get('*', (req, res) => {
  // Punkt-Dateien (.env, .git …) und Dateien mit Endung gibt es nicht.
  if (req.path.split('/').some(seg => seg.startsWith('.')) || path.extname(req.path)) return res.status(404).send('Nicht gefunden');
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Anfrage zu groß' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Datei zu groß (max. 20 MB)' });
  console.error('[server]', err?.message || err);
  res.status(500).json({ error: 'Serverfehler' });
});

const server = app.listen(PORT, HOST, () => {
  const cfg = getConfig();
  console.log(`\n  AI Core ${VERSION} läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (Host: ${HOST})`);
  const sources = [cfg.ollamaEnabled && `Ollama ${cfg.ollamaUrl} (${cfg.ollamaModel})`, cfg.cloudEnabled && `Cloud ${cfg.cloudLabel} (${cfg.cloudModels.join(', ')})`, cfg.anthropicEnabled && 'Anthropic'].filter(Boolean);
  console.log(`  Quellen: ${sources.join(' + ') || 'keine (Demo-Modus)'} · Standard: ${cfg.provider}`);
  const methods = [passwordEnabled() && 'Passwort', firebaseEnabled() && 'Firebase'].filter(Boolean);
  console.log(`  Anmeldung: ${authEnabled() ? methods.join(' + ') : 'AUS (nur im vertrauenswürdigen Heimnetz verwenden)'}`);
  if (firebaseEnabled() && !hasAllowRules()) {
    console.log('  ACHTUNG: Firebase ist aktiv, aber ALLOWED_UIDS und ALLOWED_EMAILS sind leer — niemand kommt herein.');
  }
  console.log();
  if (cfg.ollamaEnabled && cfg.warmUp) preload(cfg);
});

// Modell beim Start laden, damit die erste Antwort nicht minutenlang dauert.
async function preload(cfg, attempt = 1) {
  try {
    await listOllamaModels(cfg);
    console.log(`  Lade Modell ${cfg.ollamaModel} in den Speicher …`);
    await warmUpModel(cfg.ollamaModel, cfg);
    console.log(`  Modell ${cfg.ollamaModel} ist bereit.`);
  } catch (e) {
    if (attempt < 6) setTimeout(() => preload(cfg, attempt + 1), 15000 * attempt).unref();
    else console.warn(`  Vorwärmen nicht möglich: ${e.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
