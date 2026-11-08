import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.AICORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aicore-tok-'));
const plan = await import('../server/plan.js');
const H = 3600000;

test('Preise: deine Werte sind die Standardwerte', () => {
  const c = plan.costs();
  assert.deepEqual(c, { word: 0.25, image: 45.9, videoSecond: 15.9, fileWord: 0.5, analyzeWord: 0.75, musicSecond: 10 });
  assert.deepEqual(plan.tokenPlan(false), { max: 4000, resetHours: 4 });
  assert.deepEqual(plan.tokenPlan(true), { max: 10000, resetHours: 2 });
});

test('Wörter zählen', () => {
  assert.equal(plan.wordCount('  Hallo   schöne\nWelt  '), 3); assert.equal(plan.wordCount(''), 0); assert.equal(plan.wordCount(null), 0);
});

test('Gratis: 4 000 Token am Start, Abzug ohne Rundungsfehler, Fenster beginnt bei der ersten Nutzung', () => {
  const t0 = 1_000_000_000_000;
  let s = plan.tokenStatus('a', { now: t0 });
  assert.equal(s.max, 4000); assert.equal(s.left, 4000); assert.equal(s.resetAt, null);
  for (let i = 0; i < 3; i++) plan.spendTokens('a', 0.25 * 10 + 45.9, { now: t0 });   // 3 × (10 Wörter + 1 Bild)
  s = plan.tokenStatus('a', { now: t0 });
  assert.equal(s.used, 3 * 48.4); assert.equal(s.left, 4000 - 145.2); assert.equal(s.resetAt, t0 + 4 * H);
});

test('Gratis: Limit greift, nichts wird bei Ablehnung abgezogen, nach 4 Stunden wieder 4 000', () => {
  const t0 = 2_000_000_000_000;
  assert.equal(plan.spendTokens('b', 3990, { now: t0 }).ok, true);
  const no = plan.spendTokens('b', 45.9, { now: t0 + H });
  assert.equal(no.status, 402); assert.match(no.error, /10 übrig/); assert.match(no.error, /3 Std \d+ Min|3 Std/); assert.match(no.error, /Pro/);
  assert.equal(plan.tokenStatus('b', { now: t0 + H }).left, 10);
  assert.equal(plan.spendTokens('b', 45.9, { now: t0 + 4 * H - 1 }).ok, false);          // eine Millisekunde vorher
  assert.equal(plan.spendTokens('b', 45.9, { now: t0 + 4 * H }).ok, true);               // Fenster vorbei
  assert.equal(plan.tokenStatus('b', { now: t0 + 4 * H }).used, 45.9);
});

test('Pro: 10 000 Token, Zurücksetzen nach 2 Stunden', () => {
  const t0 = 3_000_000_000_000;
  plan.grantPro('c', { until: t0 + 30 * 24 * H, source: 'code' });
  let s = plan.tokenStatus('c', { now: t0 });
  assert.equal(s.max, 10000); assert.equal(s.resetHours, 2);
  assert.equal(plan.spendTokens('c', 9990, { now: t0 }).ok, true);
  assert.equal(plan.spendTokens('c', 100, { now: t0 + H }).ok, false);
  assert.equal(plan.spendTokens('c', 100, { now: t0 + 2 * H }).ok, true);
  assert.equal(plan.tokenStatus('c', { now: t0 + 2 * H }).used, 100);
});

test('Antwort ist schon geschrieben: bis zur Obergrenze abziehen, nie darüber; Rückgabe bei Fehlschlag', () => {
  const t0 = 4_000_000_000_000;
  plan.spendTokens('d', 3990, { now: t0 });
  const r = plan.spendTokens('d', 50, { now: t0, strict: false });
  assert.equal(r.ok, true); assert.equal(plan.tokenStatus('d', { now: t0 }).left, 0);
  plan.refundTokens('d', 45.9, { now: t0 }); assert.equal(plan.tokenStatus('d', { now: t0 }).used, 3954.1);
  plan.refundTokens('d', 99999, { now: t0 }); assert.equal(plan.tokenStatus('d', { now: t0 }).used, 0);
});

test('Besitzer und abgeschaltetes System: keine Grenze', () => {
  assert.equal(plan.spendTokens('e', 999999, { unlimited: true }).ok, true);
  assert.equal(plan.tokenStatus('e', { unlimited: true }).unlimited, true);
  process.env.TOKENS = 'false';
  try { assert.equal(plan.spendTokens('f', 999999).ok, true); assert.equal(plan.tokenStatus('f').enabled, false); }
  finally { delete process.env.TOKENS; }
});

test('Preise lassen sich in der .env ändern (auch mit Komma)', () => {
  process.env.TOKEN_COST_IMAGE = '50,5'; process.env.FREE_TOKENS = '1000';
  try { assert.equal(plan.costs().image, 50.5); assert.equal(plan.tokenPlan(false).max, 1000); }
  finally { delete process.env.TOKEN_COST_IMAGE; delete process.env.FREE_TOKENS; }
});
