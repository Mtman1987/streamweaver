import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyAdultModeAction,
  getEffectiveQwenBaseUrl,
  getEffectiveQwenModel,
  parseAdultModeCommand,
  SPMT_PRIVATE_QWEN_BASE_URL,
  SPMT_PRIVATE_QWEN_MODEL,
} from '../src/lib/private-chat-settings-store';
import {
  QWEN_MAX_REPLY_CHARACTERS,
  buildQwenMessages,
  requestQwenPrivateChatCompletion,
  resolveQwenEndpoint,
  sanitizeQwenReply,
} from '../src/services/qwen-private-chat';

test('recognizes private adult-mode controls without treating ordinary conversation as a toggle', () => {
  assert.equal(parseAdultModeCommand('adult mode on', 'Athena'), 'on');
  assert.equal(parseAdultModeCommand('Athena, adult mode off', 'Athena'), 'off');
  assert.equal(parseAdultModeCommand('spmt adult status', 'Athena'), 'status');
  assert.equal(parseAdultModeCommand('!adult toggle', 'Athena'), 'toggle');
  assert.equal(parseAdultModeCommand('Athena, tell me about the adult mode design', 'Athena'), null);

  assert.equal(applyAdultModeAction(false, 'on'), true);
  assert.equal(applyAdultModeAction(true, 'off'), false);
  assert.equal(applyAdultModeAction(false, 'toggle'), true);
  assert.equal(applyAdultModeAction(true, 'status'), true);
});

test('uses the existing SPMT Qwen worker and model without tenant or env setup', () => {
  assert.equal(getEffectiveQwenBaseUrl({ adultMode: true }), SPMT_PRIVATE_QWEN_BASE_URL);
  assert.equal(getEffectiveQwenModel({ adultMode: true }), SPMT_PRIVATE_QWEN_MODEL);
  assert.deepEqual(
    resolveQwenEndpoint(undefined, { production: true }),
    {
      ok: true,
      endpoint: 'http://spmt-llm-worker.internal:8080/v1/chat/completions',
    },
  );

  const publicHttp = resolveQwenEndpoint('http://qwen.example.com/v1', { production: true });
  assert.equal(publicHttp.ok, false);
  if (!publicHttp.ok) assert.match(publicHttp.error, /private network/i);
});

test('real Discord DMs hand off to the private-chat route that selects Qwen in Adult Mode', async () => {
  const discordRoute = await readFile(
    new URL('../src/app/api/discord/chat/route.ts', import.meta.url),
    'utf8',
  );
  const privateRoute = await readFile(
    new URL('../src/app/api/private-chat/respond/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(discordRoute, /if \(isPrivateDiscordLane\)/);
  assert.match(discordRoute, /\/api\/private-chat\/respond/);
  assert.match(privateRoute, /if \(privateSettings\.adultMode\)/);
  assert.match(privateRoute, /requestQwenPrivateChatCompletion/);
});

test('builds Qwen chat messages without embedding the transcript or latest message twice', () => {
  const messages = buildQwenMessages({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue from there.',
    history: [
      { type: 'user', username: 'Commander', message: 'First turn', timestamp: '1' },
      { type: 'ai', username: 'Athena', message: 'First answer', timestamp: '2' },
      { type: 'user', username: 'Commander', message: 'Continue from there.', timestamp: '3' },
    ],
    memoryIndex: ['favorite scene'],
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Return only the assistant character next turn/i);
  assert.deepEqual(messages.slice(1).map((entry) => entry.content), [
    'First turn',
    'First answer',
    'Continue from there.',
  ]);
  assert.equal(messages.filter((entry) => entry.content.includes('Continue from there.')).length, 1);
  assert.equal(messages.some((entry) => /Conversation so far:/i.test(entry.content)), false);
});

test('collapses repeated Qwen blocks and stops generated multi-turn transcripts', () => {
  const repeated = [
    'Athena: I step closer and answer quietly.',
    '',
    'I step closer and answer quietly.',
    '',
    'I step closer and answer quietly.',
    '',
    'User: repeats the next prompt',
  ].join('\n');

  assert.equal(
    sanitizeQwenReply({
      text: repeated,
      username: 'User',
      botName: 'Athena',
      latestUserMessage: 'Please continue the scene from where we stopped.',
    }),
    'I step closer and answer quietly.',
  );
});

test('strips Qwen thinking blocks before the private reply is stored or sent', () => {
  const cleaned = sanitizeQwenReply({
    text: '<think>private chain of thought that must not be sent</think>Final visible answer.',
    username: 'Commander',
    botName: 'Athena',
  });
  assert.equal(cleaned, 'Final visible answer.');
});

test('removes one or many copies of the previous assistant turn before keeping new text', () => {
  const previous = 'I cross the room slowly, stop beside you, and answer in a quiet voice without breaking eye contact.';
  const raw = [
    previous,
    previous,
    previous,
    'Then I give a completely new response that moves the scene forward.',
  ].join('\n\n');

  assert.equal(
    sanitizeQwenReply({
      text: raw,
      username: 'Commander',
      botName: 'Athena',
      recentAssistantMessages: [previous],
    }),
    'Then I give a completely new response that moves the scene forward.',
  );
});

test('removes a punctuation-reformatted copy of the previous assistant turn', () => {
  const previous = 'I step closer, lower my voice, and wait for your answer before continuing.';
  const raw = 'I step closer — lower my voice — and wait for your answer before continuing.\n\nA new continuation follows.';

  assert.equal(
    sanitizeQwenReply({
      text: raw,
      username: 'Commander',
      botName: 'Athena',
      recentAssistantMessages: [previous],
    }),
    'A new continuation follows.',
  );
});

test('repairs cumulative assistant history before it is sent back to Qwen', () => {
  const first = 'First assistant turn with enough words to qualify as a known echo for cleanup.';
  const second = 'Second assistant turn that advances the conversation instead of replaying the first.';
  const messages = buildQwenMessages({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue.',
    history: [
      { type: 'user', username: 'Commander', message: 'Begin.', timestamp: '1' },
      { type: 'ai', username: 'Athena', message: first, timestamp: '2' },
      { type: 'user', username: 'Commander', message: 'Next.', timestamp: '3' },
      { type: 'ai', username: 'Athena', message: `${first}\n\n${second}`, timestamp: '4' },
    ],
  });

  const assistantMessages = messages
    .filter((entry) => entry.role === 'assistant')
    .map((entry) => entry.content);
  assert.deepEqual(assistantMessages, [first, second]);
});

test('removes a long exact echo of the latest user message', () => {
  const latest = 'Please continue exactly from the last private scene without restating my request.';
  const cleaned = sanitizeQwenReply({
    text: `${latest}\n\nAthena answers with a new line.`,
    username: 'Commander',
    botName: 'Athena',
    latestUserMessage: latest,
  });
  assert.equal(cleaned, 'Athena answers with a new line.');
});

test('caps private Qwen output below the Discord embed description limit', () => {
  const cleaned = sanitizeQwenReply({
    text: `${Array.from({ length: 500 }, (_, index) => `Sentence ${index} adds distinct useful detail.`).join(' ')} Final sentence.`,
    username: 'Commander',
    botName: 'Athena',
  });
  assert.ok(cleaned.length <= QWEN_MAX_REPLY_CHARACTERS);
  assert.match(cleaned, /\.\.\.$/);
});

test('sends current-worker anti-repetition controls with no model authorization header', async () => {
  let requestedUrl = '';
  let requestedBody: any = null;
  let requestedHeaders: HeadersInit | undefined;
  const completion = await requestQwenPrivateChatCompletion({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue.',
    history: [],
    runtime: { production: true },
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body || '{}'));
      requestedHeaders = init?.headers;
      return new Response(JSON.stringify({
        choices: [{
          message: { content: 'A fresh response.' },
          finish_reason: 'stop',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(requestedUrl, 'http://spmt-llm-worker.internal:8080/v1/chat/completions');
  assert.equal(requestedBody.model, 'spmt-qwen3-4b');
  assert.equal(requestedBody.temperature, 0.7);
  assert.equal(requestedBody.top_p, 0.8);
  assert.equal(requestedBody.top_k, 20);
  assert.equal(requestedBody.repeat_penalty, 1.12);
  assert.equal(requestedBody.repetition_penalty, 1.12);
  assert.equal(requestedBody.thinking_budget_tokens, 0);
  assert.equal(requestedBody.max_tokens, 900);
  assert.match(requestedBody.messages.at(-1).content, /^Continue\.\n\n\/no_think$/);
  assert.equal(requestedBody.prompt, undefined);
  assert.equal(new Headers(requestedHeaders).has('authorization'), false);
  assert.equal(completion.text, 'A fresh response.');
  assert.equal(completion.provider, 'self-hosted-qwen');
});

test('retries once without assistant history when Qwen returns only the previous reply', async () => {
  const previous = 'This previous assistant reply is deliberately long enough to trigger known-echo removal during sanitization.';
  let calls = 0;
  const requestBodies: any[] = [];

  const completion = await requestQwenPrivateChatCompletion({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue with something new.',
    history: [
      { type: 'ai', username: 'Athena', message: previous, timestamp: '1' },
    ],
    runtime: { production: true },
    fetchImpl: async (_input, init) => {
      calls++;
      requestBodies.push(JSON.parse(String(init?.body || '{}')));
      const content = calls === 1 ? previous : 'A genuinely new reply after the anti-repetition retry.';
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(calls, 2);
  assert.equal(completion.text, 'A genuinely new reply after the anti-repetition retry.');
  assert.equal(requestBodies[0].repeat_penalty, 1.12);
  assert.equal(requestBodies[1].repeat_penalty, 1.15);
  assert.equal(requestBodies[1].messages.some((entry: any) => entry.role === 'assistant'), false);
  assert.match(requestBodies[1].messages[0].content, /prior generation was discarded/i);
});

test('private Qwen configuration is not exposed as user-editable env or URL fields', async () => {
  const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const settingsPage = await readFile(
    new URL('../src/app/(app)/private-chat/page.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(envExample, /PRIVATE_QWEN_/);
  assert.doesNotMatch(settingsPage, /qwen-url|Qwen API base URL|PRIVATE_QWEN_/);
  assert.match(settingsPage, /Private Discord DMs use the Qwen worker that already runs for SPMT/);
});
