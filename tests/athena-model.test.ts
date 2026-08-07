import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAthenaModel } from '../src/services/athena-model';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('Athena sends the shared SPMT key to Local Qwen over the existing HTTP endpoint', async () => {
  const previousBase = process.env.SPMT_LLM_BASE_URL;
  const previousSharedKey = process.env.SPMT_API_KEY;
  const previousPlatformKey = process.env.SPMT_PLATFORM_API_KEY;
  const previousLocalKey = process.env.SPMT_LLM_API_KEY;
  const previousModel = process.env.SPMT_LLM_MODEL;

  process.env.SPMT_LLM_BASE_URL = 'http://spmt-llm-worker.internal:8080/v1';
  process.env.SPMT_API_KEY = 'shared-spmt-key';
  delete process.env.SPMT_PLATFORM_API_KEY;
  delete process.env.SPMT_LLM_API_KEY;
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
      allowFallback: false,
    });

    assert.equal(requestedUrl, 'http://spmt-llm-worker.internal:8080/v1/chat/completions');
    assert.equal(requestedAuthorization, 'Bearer shared-spmt-key');
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

test('the dedicated Local Qwen key takes precedence over shared service keys', async () => {
  const previousBase = process.env.SPMT_LLM_BASE_URL;
  const previousSharedKey = process.env.SPMT_API_KEY;
  const previousLocalKey = process.env.SPMT_LLM_API_KEY;

  process.env.SPMT_LLM_BASE_URL = 'http://worker.internal:8080/v1';
  process.env.SPMT_API_KEY = 'shared-key';
  process.env.SPMT_LLM_API_KEY = 'dedicated-worker-key';

  let authorization = '';
  const fetchImpl = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    authorization = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 });
  };

  try {
    await requestAthenaModel({
      messages: [{ role: 'user', content: 'test' }],
      fetchImpl: fetchImpl as typeof fetch,
      allowFallback: false,
    });
    assert.equal(authorization, 'Bearer dedicated-worker-key');
  } finally {
    restoreEnv('SPMT_LLM_BASE_URL', previousBase);
    restoreEnv('SPMT_API_KEY', previousSharedKey);
    restoreEnv('SPMT_LLM_API_KEY', previousLocalKey);
  }
});
