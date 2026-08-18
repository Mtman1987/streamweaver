import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  THE_COUNT_CHARACTER,
  THE_COUNT_NAME,
  THE_COUNT_OWNER_TITLE,
  THE_COUNT_STABLE_ID,
  messageInvokesTheCount,
} from '../src/lib/the-count';
import { VOIDWALKER_TITLE, getVoidwalkerSystemPrompt } from '../src/lib/voidwalker';

const repoRoot = path.resolve(process.cwd());

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('The Count is a built-in lore character with the black-hole mystery identity', () => {
  assert.equal(THE_COUNT_STABLE_ID, 'unknown:the_count');
  assert.equal(THE_COUNT_NAME, 'The Count');
  assert.equal(THE_COUNT_OWNER_TITLE, 'Voidwalker');
  assert.equal(THE_COUNT_CHARACTER.currentName, THE_COUNT_NAME);
  assert.match(THE_COUNT_CHARACTER.summary || '', /black-hole/i);
  assert.ok(THE_COUNT_CHARACTER.personalityNotes?.some((note) => /riddle|puzzle/i.test(note)));
  assert.equal(messageInvokesTheCount('Count, give me a riddle'), true);
  assert.equal(messageInvokesTheCount('Hey The Count?'), true);
  assert.equal(messageInvokesTheCount('discount points'), false);
});

test('world lore injects The Count without adding an editable owner field to lore', () => {
  const loreSource = read('src/lib/world-lore-store.ts');
  const countSource = read('src/lib/the-count.ts');
  assert.match(loreSource, /THE_COUNT_CHARACTER/);
  assert.match(loreSource, /withSystemCharacters/);
  assert.doesNotMatch(countSource, /owner\s*:/i);
});

test('Count runtime patch keeps random rotation normal and gates only personal invocation', () => {
  const patch = read('scripts/patch-the-count-easter-egg.mjs');
  assert.match(patch, /getSpmtEasterEggEntitlement/);
  assert.match(patch, /entitlement\.eggs\.blackHole/);
  assert.match(patch, /messageInvokesTheCount/);
  assert.match(patch, /character\.stableId !== THE_COUNT_STABLE_ID/);
  assert.match(patch, /context: isTheCountName\(botName\) \? 'discord-cross-bot' : 'discord'/);
  assert.match(patch, /THE_COUNT_PERSONALITY/);
  assert.match(patch, /THE_COUNT_OWNER_TITLE/);
  assert.match(patch, /theCountAvatarUrl/);
  assert.doesNotMatch(patch, /weight|weighted/i);
});

test('Count entitlement lookup is fail-closed and uses canonical SPMT state', () => {
  const source = read('src/lib/spmt-easter-eggs.ts');
  assert.match(source, /SPMT_SYSTEM_KEY/);
  assert.match(source, /\/api\/internal\/easter-eggs\/entitlement/);
  assert.match(source, /blackHole/);
  assert.match(source, /EMPTY_ENTITLEMENT/);
  assert.match(source, /title: payload\?\.title === 'Voidwalker'/);
});

test('Voidwalker is a shared non-editable identity flag derived from the three-egg entitlement', () => {
  const helper = read('src/lib/voidwalker.ts');
  const patch = read('scripts/patch-the-count-easter-egg.mjs');
  assert.equal(VOIDWALKER_TITLE, 'Voidwalker');
  assert.match(getVoidwalkerSystemPrompt(), /all three hidden Space Mountain anomalies/i);
  assert.match(helper, /entitlement\.title === VOIDWALKER_TITLE/);
  assert.match(helper, /context\.startsWith\('discord'\)/);
  assert.match(helper, /context\.startsWith\('twitch'\)/);
  assert.match(patch, /const userIsVoidwalker = userIsCommander \? false : await isVoidwalker/);
  assert.match(patch, /const voidwalkerContext = userIsVoidwalker/);
  assert.match(patch, /commanderContext,\\n      voidwalkerContext/);
});
