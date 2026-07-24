import test from 'node:test';
import assert from 'node:assert/strict';

import { extractShoutoutRequestTarget } from '../src/services/shoutout-matcher';

test('extracts targets from natural shoutout requests', () => {
  assert.equal(extractShoutoutRequestTarget('shoutout @coriumboy95'), 'coriumboy95');
  assert.equal(extractShoutoutRequestTarget('Athena, can you please give a shout out to coriumboy95?'), 'coriumboy95');
  assert.equal(extractShoutoutRequestTarget('please run a shoutout for CoriumBoy95'), 'CoriumBoy95');
});

test('does not execute ordinary discussion about shoutout sources', () => {
  assert.equal(
    extractShoutoutRequestTarget('ok mama brb tts and shoutout all need refreshed in the obs sources'),
    null,
  );
  assert.equal(extractShoutoutRequestTarget('the shoutout overlay is not playing clips'), null);
});
