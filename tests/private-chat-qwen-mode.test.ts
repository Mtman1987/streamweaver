import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAdultModeAction,
  parseAdultModeCommand,
} from '../src/lib/private-chat-settings-store';
import {
  QWEN_ADULT_ROLEPLAY_POLICY,
  QWEN_MAX_REPLY_CHARACTERS,
  buildQwenMessages,
  isTooSimilarToRecentAssistantReplies,
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

test('normalizes a hosted Qwen base URL to OpenAI-compatible chat completions', () => {
  assert.deepEqual(
    resolveQwenEndpoint('https://qwen.example.com/v1', { production: true }),
    {
      ok: true,
      endpoint: 'https://qwen.example.com/v1/chat/completions',
    },
  );

  const insecure = resolveQwenEndpoint('http://qwen.example.com/v1', { production: true });
  assert.equal(insecure.ok, false);
  if (!insecure.ok) assert.match(insecure.error, /must use HTTPS/i);
});

test('accepts the built-in Fly private Qwen worker without an environment flag', () => {
  assert.deepEqual(
    resolveQwenEndpoint('http://spmt-llm-worker.internal:8080/v1', { production: true }),
    {
      ok: true,
      endpoint: 'http://spmt-llm-worker.internal:8080/v1/chat/completions',
    },
  );
});

test('builds Qwen chat messages without embedding the transcript a second time', () => {
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
  assert.equal(messages[0].content.includes(QWEN_ADULT_ROLEPLAY_POLICY), false);
});

test('Adult Mode changes only the Qwen policy and keeps the same message path', () => {
  const base = {
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue.',
    history: [],
  };
  const normal = buildQwenMessages(base);
  const adult = buildQwenMessages({ ...base, adultMode: true });
  assert.equal(normal[0].content.includes(QWEN_ADULT_ROLEPLAY_POLICY), false);
  assert.equal(adult[0].content.includes(QWEN_ADULT_ROLEPLAY_POLICY), true);
  assert.match(adult[0].content, /do not refuse or step out of character merely because the scene is sexual/i);
  assert.match(adult[0].content, /accept the premise and advance it with a concrete in-character/i);
  assert.match(adult[0].content, /willing to take initiative/i);
  assert.deepEqual(normal.slice(1), adult.slice(1));
});

test('detects cross-turn paraphrase loops without flagging a genuinely new turn', () => {
  const history = [{
    type: 'ai' as const,
    username: 'Athena',
    message: 'I step closer with a crooked smile and lower my voice as the room goes quiet.',
    timestamp: '1',
  }];
  assert.equal(
    isTooSimilarToRecentAssistantReplies(
      'I step closer with a crooked smile and lower my voice while the room goes quiet.',
      history,
    ),
    true,
  );
  assert.equal(
    isTooSimilarToRecentAssistantReplies(
      'That changes my mind. I sit beside you and ask what you actually want next.',
      history,
    ),
    false,
  );
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

test('cleans a repeated assistant message already present in private history', () => {
  const messages = buildQwenMessages({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Next turn.',
    history: [
      {
        type: 'ai',
        username: 'Athena',
        message: 'A prior answer. A prior answer. A prior answer.',
        timestamp: '1',
      },
    ],
  });
  assert.equal(messages[1].content, 'A prior answer.');
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

test('sends Qwen-specific anti-repetition sampling parameters', async () => {
  let requestedUrl = '';
  let requestedBody: any = null;
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    apiKey: 'secret',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Continue.',
    history: [],
    runtime: { production: true },
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body || '{}'));
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

  assert.equal(requestedUrl, 'https://qwen.example.com/v1/chat/completions');
  assert.equal(requestedBody.model, 'Qwen/private-roleplay');
  assert.equal(requestedBody.temperature, 0.68);
  assert.equal(requestedBody.top_p, 0.88);
  assert.equal(requestedBody.top_k, 35);
  assert.equal(requestedBody.repetition_penalty, 1.08);
  assert.equal(requestedBody.presence_penalty, 0.12);
  assert.equal(requestedBody.frequency_penalty, 0.16);
  assert.ok(requestedBody.max_tokens <= 1200);
  assert.equal(requestedBody.messages.at(-1).content, 'Continue.');
  assert.equal(requestedBody.prompt, undefined);
  assert.equal(completion.text, 'A fresh response.');
  assert.equal(completion.provider, 'self-hosted-qwen');
});

test('automatically regenerates a reply that repeats a recent assistant turn', async () => {
  const requestBodies: any[] = [];
  const responses = [
    'I step closer with a crooked smile and lower my voice as the room goes quiet.',
    'I pause by the window, let the silence settle, and answer the actual question.',
  ];
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{
      type: 'ai',
      username: 'Athena',
      message: 'I step closer with a crooked smile and lower my voice as the room goes quiet.',
      timestamp: '1',
    }],
    runtime: { production: true },
    fetchImpl: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({
        choices: [{ message: { content: responses.shift() }, finish_reason: 'stop' }],
      }), { status: 200 });
    },
  });

  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[1].messages[0].content, /previous draft was rejected/i);
  assert.equal(completion.text, 'I pause by the window, let the silence settle, and answer the actual question.');
});

test('tries a third draft when the first retry is still repetitive', async () => {
  let calls = 0;
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      const content = calls < 3
        ? repeated
        : 'I answer the question plainly, then wait to see which direction you choose.';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });

  assert.equal(calls, 3);
  assert.equal(completion.text, 'I answer the question plainly, then wait to see which direction you choose.');
});

test('fails closed before fetch when the hosted Qwen endpoint is missing', async () => {
  let fetchCalled = false;
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: '',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Private prompt',
    history: [],
    runtime: { production: true },
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}');
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(completion.text, '');
  assert.match(completion.upstreamError || '', /Qwen endpoint configuration is unavailable/i);
});


test('does not leak the third rejected repetitive draft', async () => {
  let calls = 0;
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: repeated } }] }), { status: 200 });
    },
  });

  assert.equal(calls, 3);
  assert.equal(completion.text, '');
  assert.match(completion.upstreamError || '', /only repetitive replies after 3 attempts/i);
});

test('does not leak an already rejected draft when a retry request fails', async () => {
  let calls = 0;
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      if (calls == 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: repeated } }] }), { status: 200 });
      }
      throw new Error('retry transport failed');
    },
  });

  assert.equal(calls, 2);
  assert.equal(completion.text, '');
  assert.match(completion.upstreamError || '', /retry transport failed/i);
});

test('drops near-duplicate assistant turns from the Qwen history prompt', () => {
  const messages = buildQwenMessages({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Give me a new answer.',
    history: [
      { type: 'user', username: 'Commander', message: 'Start.', timestamp: '1' },
      { type: 'ai', username: 'Athena', message: 'I step closer with a crooked smile and lower my voice as the room goes quiet.', timestamp: '2' },
      { type: 'user', username: 'Commander', message: 'And then?', timestamp: '3' },
      { type: 'ai', username: 'Athena', message: 'I step closer with a crooked smile and lower my voice while the room goes quiet.', timestamp: '4' },
    ],
  });

  const assistantMessages = messages.filter((entry) => entry.role === 'assistant');
  assert.equal(assistantMessages.length, 1);
});

test('uses stronger anti-loop sampling on regeneration attempts', async () => {
  const bodies: any[] = [];
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || '{}')));
      const content = bodies.length === 1
        ? repeated
        : 'I stop, change direction completely, and answer the new point instead.';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });

  assert.equal(completion.text, 'I stop, change direction completely, and answer the new point instead.');
  assert.equal(bodies[0].repetition_penalty, 1.08);
  assert.equal(bodies[1].repetition_penalty, 1.10);
  assert.ok(bodies[1].temperature > bodies[0].temperature);
  assert.ok(bodies[1].frequency_penalty > bodies[0].frequency_penalty);
});
