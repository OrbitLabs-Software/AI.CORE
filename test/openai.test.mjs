import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-m-'));
const o = await import('../server/openai.js');
const metrics = await import('../server/metrics.js');
const owner = await import('../server/owner.js');

test('API-Schlüssel: Namen, Mindestlänge, Prüfung', () => {
  const keys = o.parseApiKeys('vscode:abcdefghijklmnop1234, zuhause:zzzzzzzzzzzzzzzz9999,kurz:abc,abcdefghijklmnop0000');
  assert.deepEqual(keys.map(k => k.name), ['vscode', 'zuhause', 'key4']);
  assert.equal(o.checkApiKey('Bearer abcdefghijklmnop1234', keys), 'vscode');
  assert.equal(o.checkApiKey('bearer zzzzzzzzzzzzzzzz9999', keys), 'zuhause');
  assert.equal(o.checkApiKey('Bearer falsch', keys), null);
  assert.equal(o.checkApiKey('abcdefghijklmnop1234', keys), null);
  assert.equal(o.checkApiKey(undefined, keys), null);
});

test('toInternal: System, Rollen, Bilder, Fehler', () => {
  const r = o.toInternal({ model: 'ollama/qwen', temperature: 9, stream: true, stream_options: { include_usage: true }, messages: [
    { role: 'system', content: 'Sei kurz.' }, { role: 'user', content: 'Hallo' }, { role: 'assistant', content: 'Hi' },
    { role: 'user', content: [{ type: 'text', text: 'Was ist das?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'https://evil/x.png' } }] }] });
  assert.equal(r.system, 'Sei kurz.'); assert.equal(r.model, 'ollama/qwen'); assert.equal(r.temperature, 1.5);
  assert.equal(r.stream, true); assert.equal(r.includeUsage, true);
  assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(r.messages[2].attachments.length, 1);                 // nur das eingebettete Bild, keine fremde Adresse
  assert.match(o.toInternal({ messages: [] }).error, /messages/);
  assert.match(o.toInternal({ messages: [{ role: 'user', content: 'x' }], tools: [{}] }).error, /Werkzeug/);
  assert.match(o.toInternal({ messages: [{ role: 'tool', content: 'x' }] }).error, /Rolle/);
  assert.match(o.toInternal({ messages: [{ role: 'assistant', content: 'x' }] }).error, /letzte Nachricht/);
  assert.equal(o.toInternal({ messages: [{ role: 'user', content: 'x' }], model: 'default' }).model, undefined);
});

test('Denk-Filter entfernt <think> auch über Stückgrenzen', () => {
  const run = (parts) => { const f = o.createThinkFilter(); return parts.map(p => f.push(p)).join('') + f.end(); };
  assert.equal(run(['<think>Überlegung</think>Antwort']), 'Antwort');
  assert.equal(run(['Vorher <thi', 'nk>geheim</th', 'ink>\n\nNachher']), 'Vorher Nachher');
  assert.equal(run(['Ein <b', 'ei> Test']), 'Ein <bei> Test');
  assert.equal(run(['<think>nie beendet']), '');
  assert.equal(run(['Text ohne Denken']), 'Text ohne Denken');
});

test('Antwort-Formate wie bei OpenAI', () => {
  const c = o.chunk({ id: 'x', created: 1, model: 'm', content: 'Hi' });
  assert.equal(c.object, 'chat.completion.chunk'); assert.equal(c.choices[0].delta.content, 'Hi'); assert.equal(c.choices[0].finish_reason, null);
  assert.equal(o.chunk({ id: 'x', created: 1, model: 'm', finish: 'stop' }).choices[0].finish_reason, 'stop');
  const full = o.completion({ id: 'x', created: 1, model: 'm', text: 'Antwort', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
  assert.equal(full.choices[0].message.content, 'Antwort');
  assert.deepEqual(o.modelList(['a', 'b'], 5).data.map(m => m.id), ['a', 'b']);
  assert.match(o.completionId(), /^chatcmpl-[a-f0-9]{24}$/);
});

test('Zähler: summieren pro Tag, Konten zählen einmal, 14-Tage-Ansicht', () => {
  const now = Date.UTC(2026, 10, 4, 12);
  metrics.record('chat', 'abc', 1, now); metrics.record('chat', 'abc', 1, now); metrics.record('chat', 'def', 1, now);
  metrics.record('tokens', 'abc', 250, now); metrics.record('search', 'abc', 1, now - 86400000);
  metrics.record('ungueltig', 'abc', 1, now); metrics.record('chat', 'abc', -5, now);
  const s = metrics.snapshot(14, now);
  assert.equal(s.rows.length, 14);
  assert.equal(s.rows.at(-1).chat, 3); assert.equal(s.rows.at(-1).users, 2); assert.equal(s.rows.at(-1).tokens, 250);
  assert.equal(s.rows.at(-2).search, 1);
  assert.equal(s.totals.chat, 3);
  metrics.flush();
  assert.ok(fs.existsSync(path.join(process.env.AICORE_DATA_DIR, 'metrics.json')));
});

test('Besitzer: OWNER_UIDS, sonst ALLOWED_UIDS', () => {
  process.env.ALLOWED_UIDS = 'Alice1, bob2'; delete process.env.OWNER_UIDS;
  assert.equal(owner.isOwnerSession({ sub: 'alice1' }), true);
  process.env.OWNER_UIDS = 'chef9';
  assert.equal(owner.isOwnerSession({ sub: 'alice1' }), false);
  assert.equal(owner.isOwnerSession({ sub: 'CHEF9' }), true);
  assert.equal(owner.isOwnerSession(null), false);
});
