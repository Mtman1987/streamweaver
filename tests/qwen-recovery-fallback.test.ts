import assert from 'node:assert/strict';
import test from 'node:test';
import { requestQwenPrivateChatCompletion } from '../src/services/qwen-private-chat';

const styleHistory = [
  { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) I will keep it slow and steady, like a comet tail through the stars.', timestamp: '1' },
  { type: 'user' as const, username: 'Mt', message: 'continue', timestamp: '2' },
  { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) Stay slow and steady while that comet tail crosses the stars.', timestamp: '3' },
  { type: 'user' as const, username: 'Mt', message: 'different words please', timestamp: '4' },
  { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) We can move slow and steady beneath the stars.', timestamp: '5' },
];

test('returns the least-repetitive usable draft instead of a 3-attempt error for style overlap', async () => {
  const drafts = [
    '(leans in, breath warm) I keep it slow and steady beneath the stars while answering the upgrade question with several concrete details about what changed today.',
    '(leans in, breath warm) I keep it slow and steady, but the useful answer is that the upgrade changed my response handling and model selection rather than the station itself.',
    '(leans in, breath warm) I keep it slow and steady while explaining that the new response guard now retries wording without throwing away an otherwise useful answer.',
  ];
  let calls = 0;

  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Did the upgrade make any difference?',
    history: styleHistory,
    runtime: { production: true },
    fetchImpl: async () => {
      const content = drafts[calls++] || drafts.at(-1)!;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });

  assert.equal(calls, 3);
  assert.ok(completion.text);
  assert.doesNotMatch(completion.upstreamError || '', /only repetitive replies/i);
  assert.ok(drafts.includes(completion.text));
});

test('returns a usable style-overlap draft if the retry transport fails', async () => {
  let calls = 0;
  const firstDraft = '(leans in, breath warm) I keep it slow and steady beneath the stars while still giving you the direct answer you asked for about the upgrade.';

  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Did the upgrade help?',
    history: styleHistory,
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: firstDraft } }] }), { status: 200 });
      }
      throw new Error('retry transport failed');
    },
  });

  assert.equal(calls, 2);
  assert.equal(completion.text, firstDraft);
  assert.doesNotMatch(completion.upstreamError || '', /retry transport failed/i);
});
