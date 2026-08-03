import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOT_NO_SELF_PROMOTION_POLICY,
  visitorChannelConductPolicy,
} from '../src/lib/bot-conduct-policy';

test('shared bot policy prohibits unsolicited promotion and links', () => {
  assert.match(BOT_NO_SELF_PROMOTION_POLICY, /Never self-promote/);
  assert.match(BOT_NO_SELF_PROMOTION_POLICY, /Never post promotional links/);
  assert.match(BOT_NO_SELF_PROMOTION_POLICY, /unless a human explicitly asks/);
});

test('visitor policy requires respect for the host streamer', () => {
  const policy = visitorChannelConductPolicy('captain_streamer');
  assert.match(policy, /guest in captain_streamer's Twitch chat/);
  assert.match(policy, /utmost respect/);
  assert.match(policy, /never imply ownership/);
});
