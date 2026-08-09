import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCIDENTAL_ATHENA_GLOBAL_DEFAULT,
  COMMUNITY_BOT_NAME,
  COMMUNITY_BOT_PERSONALITY,
  isAccidentalAthenaGlobalDefault,
} from '../src/lib/bot-personality-defaults';

test('shared bot defaults remain community-oriented and are not Athena', () => {
  assert.equal(COMMUNITY_BOT_NAME, 'StreamWeaver87');
  assert.match(COMMUNITY_BOT_PERSONALITY, /Space Mountain/);
  assert.match(COMMUNITY_BOT_PERSONALITY, /passengers/);
  assert.doesNotMatch(COMMUNITY_BOT_PERSONALITY, /You are Athena/);
});

test('only the exact accidental Athena global default is recognized for migration', () => {
  assert.equal(isAccidentalAthenaGlobalDefault(ACCIDENTAL_ATHENA_GLOBAL_DEFAULT), true);
  assert.equal(isAccidentalAthenaGlobalDefault(`\r\n${ACCIDENTAL_ATHENA_GLOBAL_DEFAULT}\r\n`), true);
  assert.equal(isAccidentalAthenaGlobalDefault('You are Athena, a tenant-owned custom personality.'), false);
  assert.equal(isAccidentalAthenaGlobalDefault(COMMUNITY_BOT_PERSONALITY), false);
});
