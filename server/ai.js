// ai.js — die einzige Stelle, die mit einem KI-Anbieter spricht.
//
// Anbieter (AI_PROVIDER in der .env):
//   ollama     -> Ollama im Heimnetz (Standard, wenn OLLAMA_URL gesetzt ist)
//   anthropic  -> Anthropic Messages API (braucht AI_API_KEY)
//   demo       -> lokale Test-Antworten ohne externe Aufrufe
//
// Fällt der gewählte Anbieter aus, antwortet der Demo-Modus und nennt den Grund,
// damit die Oberfläche nie stumm hängt.

import { approxTokens, stripThink } from './context.js';

const env = process.env;

const csv = (v, d = '') => String(v || d).split(',').map(x => x.trim()).filter(Boolean);

export function getConfig() {
  const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
  const cloudKey = env.CLOUD_API_KEY || env.DEEPSEEK_API_KEY || '';
  const cloudBase = (env.CLOUD_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const provider = (env.AI_PROVIDER || (env.OLLAMA_URL ? 'ollama' : cloudKey ? 'cloud' : env.AI_API_KEY ? 'anthropic' : 'demo')).toLowerCase();
  return {
    provider,
    ollamaUrl: (env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    ollamaEnabled: provider === 'ollama' || Boolean(env.OLLAMA_URL),
    ollamaModel: env.OLLAMA_MODEL || 'deepseek-r1:1.5b',
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE || '30m',
    numCtx: num(env.OLLAMA_NUM_CTX, 4096),
    temperature: num(env.OLLAMA_TEMPERATURE, 0.6),
    maxTokens: num(env.AI_MAX_TOKENS, 2048),
    // Cloud (OpenAI-kompatibel, Standard: DeepSeek V4.1 Flash)
    cloudKey,
    cloudBase,
    cloudEnabled: Boolean(cloudKey),
    cloudLabel: env.CLOUD_LABEL || 'DeepSeek',
    cloudModels: csv(env.CLOUD_MODELS, 'deepseek-flash'),
    cloudThinking: env.CLOUD_THINKING !== 'false',
    cloudEffort: env.CLOUD_REASONING_EFFORT || 'high',
    cloudMaxTokens: num(env.CLOUD_MAX_TOKENS, 8192),
    cloudContext: num(env.CLOUD_CONTEXT_TOKENS, 48000),
    cloudThinkingParam: env.CLOUD_THINKING_PARAM ? env.CLOUD_THINKING_PARAM === 'true' : /deepseek/i.test(cloudBase),
    // Anthropic
    anthropicKey: env.AI_API_KEY,
    anthropicEnabled: Boolean(env.AI_API_KEY),
    anthropicUrl: env.AI_API_BASE_URL || 'https://api.anthropic.com/v1/messages',
    anthropicModel: env.AI_API_MODEL || 'claude-sonnet-4-6',
    systemPrompt: env.AI_SYSTEM_PROMPT ||
      'Du bist AI Core, ein hilfreicher Assistent. Antworte standardmäßig auf Deutsch, kurz und klar. Nutze Markdown für Code und Listen.',
    timeoutMs: num(env.AI_TIMEOUT_MS, 300000), // CPU-Inferenz ist langsam
    warmUp: env.OLLAMA_WARMUP !== 'false',
    modelAdmin: env.ALLOW_MODEL_ADMIN !== 'false',
  };
}

// ---------- Modelle: Registry ----------
// Modell-IDs haben die Form "<quelle>/<modell>": ollama/deepseek-r1:1.5b, cloud/deepseek-flash,
// cloud/deepseek-flash+think (Denkmodus), anthropic/claude-sonnet-4-6.
const SOURCES = ['ollama', 'cloud', 'anthropic'];

export function defaultModelId(cfg = getConfig()) {
  if (cfg.provider === 'ollama') return `ollama/${cfg.ollamaModel}`;
  if (cfg.provider === 'cloud') return `cloud/${cfg.cloudModels[0]}`;
  if (cfg.provider === 'anthropic') return `anthropic/${cfg.anthropicModel}`;
  return 'demo/demo';
}

/** Macht aus der Anfrage des Browsers eine konkrete Quelle. Alte Namen (ohne Präfix) gehen an den Standard. */
export function resolveModel(requested, cfg = getConfig()) {
  const raw = String(requested || '');
  const i = raw.indexOf('/');
  const prefix = i > 0 ? raw.slice(0, i) : '';
  if (SOURCES.includes(prefix)) {
    const name = raw.slice(i + 1);
    if (prefix === 'cloud') {
      const think = name.endsWith('+think');
      return { provider: 'cloud', model: think ? name.slice(0, -6) : name, think };
    }
    return { provider: prefix, model: name, think: false };
  }
  // Ohne Präfix: nur echte Namen übernehmen, Platzhalter ("core-large") ignorieren
  const def = resolveModel(defaultModelId(cfg), cfg);
  if (cfg.provider === 'ollama' && raw && !raw.startsWith('core-')) return { provider: 'ollama', model: raw, think: false };
  return def;
}

const PRETTY = {
  'deepseek-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
};

/** Alle wählbaren Modelle plus Zustand der Quellen. */
export async function listAllModels(cfg = getConfig()) {
  const models = [];
  const status = {};
  if (cfg.ollamaEnabled) {
    try {
      const detailed = await listOllamaDetailed(cfg);
      const loaded = await listLoadedModels(cfg);
      status.ollama = { enabled: true, reachable: true, loaded };
      for (const m of detailed) {
        models.push({ id: `ollama/${m.name}`, label: m.name, group: 'Lokal (Tiny)', provider: 'ollama', size: m.size, loaded: loaded.includes(m.name) });
      }
    } catch (e) {
      status.ollama = { enabled: true, reachable: false, error: e.message, loaded: [] };
    }
  } else status.ollama = { enabled: false };

  if (cfg.cloudEnabled) {
    status.cloud = { enabled: true, label: cfg.cloudLabel, base: cfg.cloudBase };
    for (const m of cfg.cloudModels) {
      const label = PRETTY[m] || m;
      models.push({ id: `cloud/${m}`, label, group: `Cloud · ${cfg.cloudLabel}`, provider: 'cloud', hint: 'schnell' });
      if (cfg.cloudThinking) models.push({ id: `cloud/${m}+think`, label: `${label} · Denkmodus`, group: `Cloud · ${cfg.cloudLabel}`, provider: 'cloud', hint: 'gründlich' });
    }
  } else status.cloud = { enabled: false };

  if (cfg.anthropicEnabled) {
    status.anthropic = { enabled: true };
    models.push({ id: `anthropic/${cfg.anthropicModel}`, label: cfg.anthropicModel, group: 'Cloud · Anthropic', provider: 'anthropic' });
  } else status.anthropic = { enabled: false };

  return { models, status, defaultModel: defaultModelId(cfg) };
}

/** Wie viele Token für den Verlauf übrig bleiben (ohne Systemprompt und Antwort). */
export function contextBudget(cfg, system, provider = cfg.provider) {
  const total = provider === 'ollama' ? cfg.numCtx : cfg.cloudContext;
  const reply = provider === 'ollama' ? cfg.maxTokens : cfg.cloudMaxTokens;
  return Math.max(512, total - reply - approxTokens(system) - 64);
}

export async function streamAiResponse({ messages, model, system, temperature }, onDelta, signal, onMeta = () => {}) {
  const cfg = getConfig();
  const sys = system || cfg.systemPrompt;
  const target = resolveModel(model, cfg);
  try {
    if (target.provider === 'ollama' && cfg.ollamaEnabled) return await streamOllama(cfg, messages, target.model, sys, temperature, onDelta, signal, onMeta);
    if (target.provider === 'cloud' && cfg.cloudEnabled) return await streamCloud(cfg, messages, target, sys, temperature, onDelta, signal, onMeta);
    if (target.provider === 'anthropic' && cfg.anthropicEnabled) return await streamAnthropic(cfg, messages, sys, temperature, onDelta, signal, onMeta);
  } catch (e) {
    if (signal?.aborted) return;
    console.error(`[ai] ${target.provider} fehlgeschlagen → Demo-Modus:`, e.message);
    return streamDemo(messages, onDelta, `Die Quelle „${target.provider}“ ist nicht erreichbar (${e.message}).`);
  }
  return streamDemo(messages, onDelta, target.provider !== 'demo' ? `Die Quelle „${target.provider}“ ist nicht eingerichtet (siehe .env).` : undefined);
}

// ---------- Ollama: Verwaltung ----------
const jsonGet = async (url, ms = 4000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export async function listOllamaModels(cfg = getConfig()) {
  return (await listOllamaDetailed(cfg)).map(m => m.name);
}

export async function listOllamaDetailed(cfg = getConfig()) {
  const data = await jsonGet(`${cfg.ollamaUrl}/api/tags`);
  return (data.models || []).map(m => ({ name: m.name, size: m.size || 0, modified: m.modified_at || null }));
}

export async function listLoadedModels(cfg = getConfig()) {
  try {
    const data = await jsonGet(`${cfg.ollamaUrl}/api/ps`, 2500);
    return (data.models || []).map(m => m.name);
  } catch { return []; }
}

/** Lädt das Modell in den Arbeitsspeicher, damit die erste Antwort schnell kommt. */
export async function warmUpModel(model, cfg = getConfig()) {
  if (!cfg.ollamaEnabled) return false;
  model = String(model || '').replace(/^ollama\//, '');
  const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(cfg.timeoutMs),
    body: JSON.stringify({ model: model || cfg.ollamaModel, prompt: '', stream: false, keep_alive: cfg.ollamaKeepAlive, options: { num_ctx: cfg.numCtx } }),
  });
  return res.ok;
}

/** Lädt ein Modell herunter und meldet den Fortschritt (0-100). */
export async function pullOllamaModel(name, onProgress, signal, cfg = getConfig()) {
  const res = await fetch(`${cfg.ollamaUrl}/api/pull`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await readNdjson(res.body, (json) => {
    if (json.error) throw new Error(json.error);
    const pct = json.total ? Math.round((json.completed || 0) / json.total * 100) : null;
    onProgress({ status: json.status, percent: pct });
  });
}

async function readNdjson(body, onJson) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line) => {
    if (!line.trim()) return;
    let json;
    try { json = JSON.parse(line); } catch { return; }
    onJson(json);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);
}

// ---------- Ollama: Chat ----------
// DeepSeek-R1 arbeitet am besten OHNE System-Rolle: die Anweisung wird der ersten
// Nutzernachricht vorangestellt.
function buildOllamaMessages(system, model, messages) {
  const isR1 = /deepseek-r1/i.test(model);
  const out = messages.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.images?.length ? { images: m.images.map(i => i.data) } : {}),
  }));
  if (!isR1) return [{ role: 'system', content: system }, ...out];
  const first = out.findIndex(m => m.role === 'user');
  if (first >= 0) out[first].content = `${system}\n\n${out[first].content}`;
  return out;
}

async function streamOllama(cfg, messages, requestedModel, system, temperature, onDelta, clientSignal, onMeta) {
  const model = requestedModel || cfg.ollamaModel;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('Zeitlimit')), cfg.timeoutMs);
  clientSignal?.addEventListener('abort', () => ctrl.abort());

  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: cfg.ollamaKeepAlive,
        options: { num_ctx: cfg.numCtx, num_predict: cfg.maxTokens, temperature: temperature ?? cfg.temperature },
        messages: buildOllamaMessages(system, model, messages),
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 120)}`);
    }
    await readNdjson(res.body, (json) => {
      if (json.error) throw new Error(json.error);
      const text = json?.message?.content;
      if (text) onDelta(text, { demo: false });
      if (json.done && json.eval_count) {
        const evalMs = (json.eval_duration || 0) / 1e6;
        onMeta({
          model,
          tokens: json.eval_count,
          promptTokens: json.prompt_eval_count || 0,
          tps: evalMs > 0 ? Math.round((json.eval_count / evalMs) * 10000) / 10 : null,
          loadMs: Math.round((json.load_duration || 0) / 1e6),
          totalMs: Math.round((json.total_duration || 0) / 1e6),
        });
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Cloud (OpenAI-kompatibel, z. B. DeepSeek V4.1 Flash) ----------
function toOpenAiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.images?.length) {
      out.push({ role: m.role, content: [
        ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } })),
        { type: 'text', text: m.content },
      ] });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function streamCloud(cfg, messages, target, system, temperature, onDelta, clientSignal, onMeta) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('Zeitlimit')), cfg.timeoutMs);
  clientSignal?.addEventListener('abort', () => ctrl.abort());

  const body = {
    model: target.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: cfg.cloudMaxTokens,
    messages: toOpenAiMessages(system, messages),
  };
  if (cfg.cloudThinkingParam) {
    body.thinking = { type: target.think ? 'enabled' : 'disabled' };
    if (target.think) body.reasoning_effort = cfg.cloudEffort;
  }
  // Im Denkmodus sind Temperatur-Angaben bei DeepSeek wirkungslos, sonst weiterreichen.
  if (!target.think && temperature !== undefined) body.temperature = temperature;

  try {
    const res = await fetch(`${cfg.cloudBase}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.cloudKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch { /* ignorieren */ }
      throw new Error(`HTTP ${res.status}${detail ? ` ${String(detail).slice(0, 140)}` : ''}`);
    }

    let thinking = false;   // gerade im Denkblock?
    let usage = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let json;
      try { json = JSON.parse(payload); } catch { return; }
      if (json.error) throw new Error(json.error.message || 'Fehler der Quelle');
      if (json.usage) usage = json.usage;
      const delta = json.choices?.[0]?.delta;
      if (!delta) return;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) {
        if (!thinking) { thinking = true; onDelta('<think>', { demo: false }); }
        onDelta(reasoning, { demo: false });
      }
      if (delta.content) {
        if (thinking) { thinking = false; onDelta('</think>', { demo: false }); }
        onDelta(delta.content, { demo: false });
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handle);
    }
    handle(buffer);
    if (thinking) onDelta('</think>', { demo: false });

    const ms = Date.now() - started;
    const tokens = usage?.completion_tokens;
    if (tokens) {
      onMeta({
        model: `${target.model}${target.think ? ' (Denkmodus)' : ''}`,
        tokens,
        promptTokens: usage.prompt_tokens || 0,
        tps: ms > 0 ? Math.round((tokens / ms) * 10000) / 10 : null,
        totalMs: ms,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Anthropic ----------
async function streamAnthropic(cfg, messages, system, temperature, onDelta, signal, onMeta) {
  const started = Date.now();
  const toBlocks = (m) => m.images?.length
    ? [...m.images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: m.content }]
    : m.content;
  const response = await fetch(cfg.anthropicUrl, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.anthropicModel,
      max_tokens: cfg.maxTokens,
      stream: true,
      system,
      ...(temperature !== undefined ? { temperature: Math.min(1, temperature) } : {}),
      messages: messages.map(m => ({ role: m.role, content: toBlocks(m) })),
    }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outTokens = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();
    for (const ev of events) {
      const payload = ev.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        if (json?.delta?.text) onDelta(json.delta.text, { demo: false });
        if (json?.usage?.output_tokens) outTokens = json.usage.output_tokens;
      } catch { /* defekten SSE-Block ignorieren */ }
    }
  }
  const ms = Date.now() - started;
  if (outTokens) onMeta({ model: cfg.anthropicModel, tokens: outTokens, tps: ms ? Math.round(outTokens / ms * 10000) / 10 : null, totalMs: ms });
}

// ---------- Demo ----------
async function streamDemo(messages, onDelta, reason) {
  const last = messages[messages.length - 1]?.content || '';
  const reply = buildDemoReply(last, reason);
  for (const w of reply.split(/(\s+)/)) {
    await new Promise(r => setTimeout(r, 12 + Math.random() * 16));
    onDelta(w, { demo: true });
  }
}

function buildDemoReply(userText, reason) {
  const trimmed = stripThink(userText).trim().slice(0, 400);
  if (!trimmed) return 'Ich bin bereit, sobald du mir eine Frage stellst.';
  return (
    `**Demo-Modus** — ${reason || 'es ist kein KI-Anbieter konfiguriert (siehe `.env.example`).'}\n\n` +
    `Deine Nachricht: „${trimmed}“\n\n` +
    `Prüfe \`OLLAMA_URL\` und ob Ollama auf dem Server läuft (\`curl $OLLAMA_URL/api/tags\`).`
  );
}
