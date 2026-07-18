import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPrivateChatResponseText,
  requestPrivateChatCompletion,
} from '../src/services/private-chat-ai';

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
  assert.equal(JSON.parse(String(requests[0].body)).max_tokens, 1600);
});
