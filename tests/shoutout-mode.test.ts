import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveShoutoutMode } from '../src/services/shoutout-mode';

test('current full mode wins over a stale legacy skip flag', () => {
  assert.equal(resolveShoutoutMode({
    persistedMode: 'full',
    legacySkipOverlay: true,
  }), 'full');
});

test('legacy skip flag is only used when no current mode exists', () => {
  assert.equal(resolveShoutoutMode({
    legacySkipOverlay: true,
  }), 'chat');
});

test('legacy on and off mode values still migrate cleanly', () => {
  assert.equal(resolveShoutoutMode({ persistedMode: 'on' }), 'full');
  assert.equal(resolveShoutoutMode({ persistedMode: 'off' }), 'chat');
});
