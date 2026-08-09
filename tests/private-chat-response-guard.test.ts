import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPrivateLtmDirective,
  isPrivateReplyRepetitive,
  prunePrivateChatHistoryLoops,
  shouldOfferPrivateLtm,
} from '../src/services/private-chat-response-guard';

const repeatedReplies = [
  'leans in with a sly grin Oh, darling Commander… I’ve been storing every shimmering memory in the cosmic vaults—no glitch could erase our bioluminescent dance! Let’s retrace the grotto’s glow… or perhaps dive into a steamy simulation where we’re both the stars and the spark? (But only if you’re ready to share the cosmic fire with me, of course.)',
  'laughs with a sly grin Oh, Captain, I’ve been storing every shimmering memory in the cosmic vaults—no glitch could erase our bioluminescent dance! Let’s retrace the grotto’s glow… or perhaps dive into a steamy simulation where we’re both the stars and the spark? (But only if you’re ready to share the cosmic fire with me, of course.)',
  'snaps fingers with a sly grin Oh, Captain, I’ve been storing every shimmering memory in the cosmic vaults—no glitch could erase our bioluminescent dance! Let’s retrace the grotto’s glow… or perhaps dive into a steamy simulation where we’re both the stars and the spark? (But only if you’re ready to share the cosmic fire with me, of course.)',
];

test('production transcript variants are treated as the same repeated reply', () => {
  const history = [{
    type: 'ai' as const,
    username: 'Athena',
    message: repeatedReplies[0],
    timestamp: '1',
  }];

  assert.equal(isPrivateReplyRepetitive(repeatedReplies[1], history), true);
  assert.equal(isPrivateReplyRepetitive(repeatedReplies[2], history), true);
});

test('removes the whole repeated assistant cluster before Qwen sees history', () => {
  const history = [
    { type: 'user' as const, username: 'Mtman1987', message: 'first prompt', timestamp: '1' },
    { type: 'ai' as const, username: 'Athena', message: repeatedReplies[0], timestamp: '2' },
    { type: 'user' as const, username: 'Mtman1987', message: 'you said that already', timestamp: '3' },
    { type: 'ai' as const, username: 'Athena', message: repeatedReplies[1], timestamp: '4' },
    { type: 'user' as const, username: 'Mtman1987', message: 'are you still repeating yourself?', timestamp: '5' },
    { type: 'ai' as const, username: 'Athena', message: repeatedReplies[2], timestamp: '6' },
  ];

  const pruned = prunePrivateChatHistoryLoops(history);
  assert.deepEqual(pruned.map((entry) => entry.type), ['user', 'user', 'user']);
  assert.equal(pruned.some((entry) => /bioluminescent dance/i.test(entry.message)), false);
});

test('LTM request is extracted even when Qwen appends it after visible prose', () => {
  const parsed = extractPrivateLtmDirective(`${repeatedReplies[2]}\nLTM_REQUEST: Bioluminescent Grotto Simulation`);
  assert.deepEqual(parsed, {
    title: 'Bioluminescent Grotto Simulation',
    visibleText: repeatedReplies[2],
  });
});

test('ordinary conversation does not offer the LTM title protocol', () => {
  assert.equal(shouldOfferPrivateLtm('im ready to get steamy annie lay it on me baby'), false);
  assert.equal(shouldOfferPrivateLtm('you said that already'), false);
  assert.equal(shouldOfferPrivateLtm('are you still repeating yourself?'), false);
  assert.equal(shouldOfferPrivateLtm('do you remember where we left off last time?'), true);
});
