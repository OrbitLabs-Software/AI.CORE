import test from 'node:test';
import assert from 'node:assert/strict';
import { trustProxySetting as t } from '../server/proxy.js';

test('TRUST_PROXY: Standard ist loopback, false/true werden erkannt, Listen bleiben erhalten', () => {
  assert.equal(t(undefined), 'loopback');
  assert.equal(t(''), 'loopback');
  assert.equal(t('loopback'), 'loopback');
  assert.equal(t('false'), false);
  assert.equal(t('TRUE'), true);
  assert.equal(t('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
});
