import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPrivateChatResponseText,
  requestPrivateChatCompletion,
} from '../src/services/private-chat-ai';
import { isEdenContentPolicyRejection } from '../src/services/eden-policy';
import { removeLatestMatchingPrivateAiMessage } from '../src/lib/private-chat-store';

test('extracts text from string and structured EdenAI message content', () => {
  assert.equal(extractPrivateChatResponseText({
    choices: [{ message: { content: '  hello  ' } }],
  }), 'hello');
  assert.equal(extractPrivateChatResponseText({
    choices: [{ message: { content: [{ text: 'hello ' }, { text: 'again' }] } }],
  }), 'hello again');
});

test('retries a successful EdenAI response that contains no visible text', async () => {
  const requests: RequestInit[] = [];
  const responses = [
    { choices: [{ finish_reason: 'length', message: { content: null } }], usage: { completion_tokens: 1024 } },
    { choices: [{ finish_reason: 'stop', message: { content: 'Recovered response' } }] },
  ];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(init || {});
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  };

  const result = await requestPrivateChatCompletion({
    apiKey: 'test-key',
    systemPrompt: 'system',
    prompt: 'prompt',
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, 'Recovered response');
  assert.equal(requests.length, 2);
  const body = JSON.parse(String(requests[0].body));
  assert.equal(body.max_tokens, 2400);
  assert.equal(body.reasoning_effort, 'minimal');
  assert.deepEqual(body.fallbacks, ['openai/gpt-4.1-mini']);
});

test('returns a filtered result immediately so the route can remove old history', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'content_filter', message: { content: null } }],
    }), { status: 200 });
  };

  const result = await requestPrivateChatCompletion({
    apiKey: 'test-key',
    systemPrompt: 'system',
    prompt: 'prompt containing old history',
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, '');
  assert.equal(result.filtered, true);
  assert.equal(result.finishReason, 'content_filter');
  assert.equal(calls, 1);
});

test('recognizes EdenAI policy rejection errors as filtered results', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: {
      message: 'Content rejected due to the violation of the following policies: sexual, sexual/minors.',
      code: 'invalid_parameter',
    },
  }), { status: 400 });

  const result = await requestPrivateChatCompletion({
    apiKey: 'test-key',
    systemPrompt: 'system',
    prompt: 'prompt containing old history',
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.filtered, true);
  assert.equal(result.finishReason, 'content_filter');
  assert.equal(result.upstreamStatus, 400);
  assert.equal(isEdenContentPolicyRejection(400, JSON.stringify({
    error: {
      message: 'Content rejected due to the violation of the following policies: violence.',
      code: 'invalid_parameter',
    },
  })), true);
  assert.equal(isEdenContentPolicyRejection(500, 'Content rejected due to the violation code invalid_parameter'), false);
});


test('removes only the newest matching Athena turn from private history', () => {
  const history = [
    { type: 'user' as const, username: 'Commander', message: 'Try it.', timestamp: '1' },
    { type: 'ai' as const, username: 'Athena', message: 'Repeated reply.', timestamp: '2' },
    { type: 'user' as const, username: 'Commander', message: 'Again.', timestamp: '3' },
    { type: 'ai' as const, username: 'Athena', message: 'Repeated reply.', timestamp: '4' },
  ];

  const result = removeLatestMatchingPrivateAiMessage(history, 'Repeated reply.');
  assert.equal(result.removed, true);
  assert.deepEqual(result.messages.map((entry) => entry.timestamp), ['1', '2', '3']);
  assert.equal(removeLatestMatchingPrivateAiMessage(history, 'Missing reply.').removed, false);
});
