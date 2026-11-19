import test from 'node:test';
import assert from 'node:assert/strict';
process.env.OLLAMA_URL = 'http://127.0.0.1:11434'; process.env.AI_PROVIDER = 'ollama';
const ai = await import('../server/ai.js');

const ndjson = (lines) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n')); c.close(); } }));

test('resolveModel: +nothink bei Ollama-Modellen', () => {
  assert.deepEqual(ai.resolveModel('ollama/aicore-lite+nothink'), { provider: 'ollama', model: 'aicore-lite', think: false, noThink: true });
  assert.equal(ai.resolveModel('ollama/aicore-lite').noThink, undefined);
});

test('Ollama: getrenntes Nachdenken wird zum Denkblock, think:false geht nur bei schnellen Modellen mit', async () => {
  const real = globalThis.fetch; const bodies = [];
  globalThis.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return ndjson([
    { message: { thinking: 'Ich überlege ' } }, { message: { thinking: 'kurz.' } },
    { message: { content: 'Die Antwort ' } }, { message: { content: 'ist 4.' } }, { done: true, eval_count: 5, eval_duration: 1e9 },
  ]); };
  try {
    let out = '';
    await ai.streamAiResponse({ messages: [{ role: 'user', content: 'x' }], model: 'ollama/aicore-denker' }, (d) => { out += d; });
    assert.equal(out, '<think>Ich überlege kurz.</think>Die Antwort ist 4.'); assert.equal(bodies[0].think, undefined);
    await ai.streamAiResponse({ messages: [{ role: 'user', content: 'x' }], model: 'ollama/aicore-lite+nothink' }, () => {});
    assert.equal(bodies[1].think, false); assert.equal(bodies[1].model, 'aicore-lite');
  } finally { globalThis.fetch = real; }
});

test('Ollama: nur Nachdenken ohne Antwort schließt den Block sauber', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ndjson([{ message: { thinking: 'hmm' } }, { done: true }]);
  try { let out = ''; await ai.streamAiResponse({ messages: [{ role: 'user', content: 'x' }], model: 'ollama/m' }, (d) => { out += d; }); assert.equal(out, '<think>hmm</think>'); }
  finally { globalThis.fetch = real; }
});
