import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAthenaModel } from '../src/services/athena-model';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('Athena calls private Local Qwen without forwarding SPMT tokens or inventing a worker key', async () => {
  const previousBase = process.env.SPMT_LLM_BASE_URL;
  const previousSharedKey = process.env.SPMT_API_KEY;
  const previousPlatformKey = process.env.SPMT_PLATFORM_API_KEY;
  const previousLocalKey = process.env.SPMT_LLM_API_KEY;
  const previousModel = process.env.SPMT_LLM_MODEL;

  process.env.SPMT_LLM_BASE_URL = 'http://spmt-llm-worker.internal:8080/v1';
  process.env.SPMT_API_KEY = 'legacy-shared-key-that-must-not-be-forwarded';
  process.env.SPMT_PLATFORM_API_KEY = 'legacy-platform-key-that-must-not-be-forwarded';
  process.env.SPMT_LLM_API_KEY = 'invented-worker-key-that-must-not-be-used';
  process.env.SPMT_LLM_MODEL = 'spmt-qwen3-4b';

  let requestedUrl = '';
  let requestedAuthorization = '';
  let requestBody: any = null;
  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get('authorization') || '';
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Local Athena response' } }],
      usage: { total_tokens: 12 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await requestAthenaModel({
      messages: [
        { role: 'system', content: 'You are Athena.' },
        { role: 'user', content: 'Hello.' },
      ],
      fetchImpl: fetchImpl as typeof fetch,
    });

    assert.equal(requestedUrl, 'http://spmt-llm-worker.internal:8080/v1/chat/completions');
    assert.equal(requestedAuthorization, '');
    assert.equal(requestBody.model, 'spmt-qwen3-4b');
    assert.equal(requestBody.stream, false);
    assert.equal(result.provider, 'local-qwen');
    assert.equal(result.text, 'Local Athena response');
  } finally {
    restoreEnv('SPMT_LLM_BASE_URL', previousBase);
    restoreEnv('SPMT_API_KEY', previousSharedKey);
    restoreEnv('SPMT_PLATFORM_API_KEY', previousPlatformKey);
    restoreEnv('SPMT_LLM_API_KEY', previousLocalKey);
    restoreEnv('SPMT_LLM_MODEL', previousModel);
  }
});

test('production Athena rejects a public Local Qwen URL', async () => {
  const previousBase = process.env.SPMT_LLM_BASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.SPMT_LLM_BASE_URL = 'https://spmt-llm-worker.fly.dev/v1';
  process.env.NODE_ENV = 'production';
  let fetchCalled = false;

  try {
    await assert.rejects(
      requestAthenaModel({
        messages: [{ role: 'user', content: 'test' }],
        fetchImpl: (async () => {
          fetchCalled = true;
          return new Response('{}', { status: 200 });
        }) as typeof fetch,
      }),
      /private networking/i,
    );
    assert.equal(fetchCalled, false);
  } finally {
    restoreEnv('SPMT_LLM_BASE_URL', previousBase);
    restoreEnv('NODE_ENV', previousNodeEnv);
  }
});

test('unified Athena fails closed on Local Qwen errors unless cloud fallback is explicitly enabled', async () => {
  const previousBase = process.env.SPMT_LLM_BASE_URL;
  const previousEdenKey = process.env.EDENAI_API_KEY;

  process.env.SPMT_LLM_BASE_URL = 'http://worker.internal:8080/v1';
  process.env.EDENAI_API_KEY = 'eden-key-that-must-not-be-used';

  const requestedUrls: string[] = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ error: { message: 'local unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await assert.rejects(
      requestAthenaModel({
        messages: [{ role: 'user', content: 'private context' }],
        fetchImpl: fetchImpl as typeof fetch,
      }),
      /local unavailable/i,
    );
    assert.deepEqual(requestedUrls, ['http://worker.internal:8080/v1/chat/completions']);
  } finally {
    restoreEnv('SPMT_LLM_BASE_URL', previousBase);
    restoreEnv('EDENAI_API_KEY', previousEdenKey);
  }
});
