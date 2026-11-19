import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const cat = await import('../server/catalog.js');
const TEXT = 'aicore-lite|AI Core Lite|free|schnell,aicore-pro|AI Core Pro|pro|gründlich,cloud/deepseek-flash|AI Core Ultra|pro|am stärksten,kaputt,|ohne name|free';

test('Katalog lesen: Namen, Stufen, neutrale Kennungen; Kaputtes wird übersprungen', () => {
  const c = cat.parseCatalog(TEXT);
  assert.deepEqual(c.map(e => [e.publicId, e.name, e.tier, e.rawId]), [
    ['core/ai-core-lite', 'AI Core Lite', 'free', 'ollama/aicore-lite'],
    ['core/ai-core-pro', 'AI Core Pro', 'pro', 'ollama/aicore-pro'],
    ['core/ai-core-ultra', 'AI Core Ultra', 'pro', 'cloud/deepseek-flash'],
  ]);
  assert.equal(cat.catalogOn(cat.parseCatalog('')), false);
  assert.equal(cat.parseCatalog('a|Gleich|free,b|Gleich|pro').map(e => e.slug).join(), 'gleich,gleich-2');
});

test('Liste für den Browser enthält keine Namen der Basismodelle und sperrt Pro-Modelle für Gratis', () => {
  const c = cat.parseCatalog(TEXT);
  const installed = [{ id: 'ollama/aicore-lite', loaded: true }, { id: 'ollama/aicore-pro' }, { id: 'cloud/deepseek-flash' }, { id: 'ollama/deepseek-r1:7b' }];
  const free = cat.publicModels(installed, { pro: false }, c);
  assert.deepEqual(free.map(m => [m.label, m.locked, m.group]), [['AI Core Lite', false, 'Kostenlos'], ['AI Core Pro', true, 'Pro'], ['AI Core Ultra', true, 'Pro']]);
  const text = JSON.stringify(free);
  assert.ok(!/aicore-lite|deepseek|ollama|cloud\//.test(text), text);
  assert.ok(cat.publicModels(installed, { pro: true }, c).every(m => !m.locked));
  assert.equal(cat.publicModels([{ id: 'ollama/aicore-lite' }], { pro: false }, c).length, 1);   // nicht installiert = nicht sichtbar
  assert.equal(cat.defaultPublic(free), 'core/ai-core-lite');
});

test('Kennung zurückübersetzen; Stufe prüfen; fremde Kennungen gelten nicht', () => {
  const c = cat.parseCatalog(TEXT);
  assert.deepEqual(cat.unalias('core/ai-core-pro', c), { id: 'ollama/aicore-pro', tier: 'pro', name: 'AI Core Pro' });
  assert.equal(cat.unalias('ollama/aicore-pro', c), null);           // rohe Namen werden nicht angenommen
  assert.equal(cat.unalias('core/gibt-es-nicht', c), null);
  assert.equal(cat.allowed(cat.unalias('core/ai-core-pro', c), { pro: false }), false);
  assert.equal(cat.allowed(cat.unalias('core/ai-core-pro', c), { pro: true }), true);
  assert.equal(cat.allowed(cat.unalias('core/ai-core-lite', c), { pro: false }), true);
});

test('Persönlichkeit wird genau einmal angehängt', () => {
  const once = cat.withIdentity('Du bist hilfreich.');
  assert.match(once, /Du bist AI Core/); assert.equal(cat.withIdentity(once), once);
  assert.doesNotMatch(cat.IDENTITY_RULE, /deepseek|qwen|llama/i);
});

test('Mitgelieferter Katalog: passt zu models.list, Namen eindeutig, Gruppen, Bildmodell wird als solches erkannt', async () => {
  const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf-8').split('\n').find(l => l.startsWith('MODEL_CATALOG='));
  const c = cat.parseCatalog(env.slice('MODEL_CATALOG='.length));
  const list = fs.readFileSync(new URL('../deploy/models/models.list', import.meta.url), 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')[0].trim());
  assert.ok(c.length >= 15, `nur ${c.length} Modelle`);
  assert.equal(new Set(c.map(e => e.slug)).size, c.length);
  for (const e of c) assert.ok(list.includes(e.baseId.replace('ollama/', '')), `${e.baseId} fehlt in models.list`);
  for (const n of list) assert.ok(c.some(e => e.baseId === `ollama/${n}`), `${n} fehlt im Katalog`);
  assert.deepEqual([...new Set(c.map(e => e.category))], ['Kostenlos', 'Allrounder', 'Denken', 'Programmieren', 'Bilder']);
  assert.deepEqual(c.filter(e => e.tier === 'free').map(e => e.name), ['AI Core Lite']);
  for (const v of c.filter(e => e.category === 'Bilder')) assert.match(v.baseId.replace('ollama/', ''), /(llava|vision|minicpm-v|moondream|gemma3|qwen2\.5vl|qwen3-vl|[-_]vl\b)/i);
  const visionRaw = c.find(e => e.name === 'AI Core Vision').baseId.replace('ollama/', '');
  assert.match(visionRaw, /(llava|vision|minicpm-v|moondream|gemma3|qwen2\.5vl|qwen3-vl|[-_]vl\b)/i);          // dieselbe Erkennung wie server/context.js
  const pub = cat.publicModels(c.map(e => ({ id: e.rawId })), { pro: false }, c);
  assert.equal(pub.find(m => m.label === 'AI Core Coder').group, 'Programmieren');
  assert.ok(!/deepseek|qwen|phi4|gemma|gpt-oss|devstral|ollama|nothink/i.test(JSON.stringify(pub)), 'Basismodell im Browser sichtbar');
});

test('Schnelle Modelle: Denken wird abgeschaltet, nur für Ollama-Modelle; Prüfung nach Installation bleibt', () => {
  const c = cat.parseCatalog('aicore-lite|AI Core Lite|free|x|Kostenlos|schnell,cloud/x|AI Core Cloud|pro|y|Denken|schnell,aicore-b|AI Core B|pro|z|Denken');
  assert.equal(c[0].rawId, 'ollama/aicore-lite+nothink'); assert.equal(c[0].baseId, 'ollama/aicore-lite');
  assert.equal(c[1].rawId, 'cloud/x'); assert.equal(c[2].rawId, 'ollama/aicore-b');
  assert.equal(cat.publicModels([{ id: 'ollama/aicore-lite' }], { pro: false }, c).length, 1);
  assert.equal(cat.unalias('core/ai-core-lite', c).id, 'ollama/aicore-lite+nothink');
});
