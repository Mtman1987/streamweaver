import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readAICostPolicy } from '@/services/ai-cost-policy';

export const runtime = 'nodejs';
export const maxDuration = 55;

type Result = {
  provider: string;
  model: string;
  capability: 'AI text';
  status: string;
  ms: number;
  detail?: string;
};

type Candidate = {
  model: string;
  request: (signal: AbortSignal) => Promise<Response>;
  usable: (body: any) => boolean;
};

const TIMEOUT_MS = 7_000;
const MIN_REPEAT_INTERVAL_MS = 10_000;
const lastRunByUser = new Map<string, number>();
const prompt = 'Reply with exactly: TEST_OK';

function secret(name: string): string {
  return String(process.env[name] || '').trim();
}

function safeDetail(value: unknown): string {
  return String(value || '')
    .replace(/(x-goog-api-key|authorization|api[_-]?key|token|secret|bearer)\s*[:=]?\s*[^\s,;"]+/gi, '$1=[REDACTED]')
    .replace(/sk-or-v1-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 220);
}

function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return 'AUTH/PERMISSION';
  if (status === 402 || status === 429) return 'QUOTA/RATE LIMIT';
  if (status === 404 || status === 405) return 'MODEL/ENDPOINT UNAVAILABLE';
  if (status === 408 || status >= 500) return 'PROVIDER/TIMEOUT ERROR';
  return 'REQUEST REJECTED';
}

function errorDetail(body: any, status: number): string {
  const message = body?.error?.message || body?.message || body?.error?.type || '';
  return safeDetail(['HTTP ' + status, message].filter(Boolean).join(' — '));
}

async function runCandidate(provider: string, candidate: Candidate): Promise<Result> {
  const started = Date.now();
  try {
    const response = await candidate.request(AbortSignal.timeout(TIMEOUT_MS));
    const body = await response.json().catch(() => null);
    if (response.ok && candidate.usable(body)) {
      const selectedModel = provider === 'OpenRouter' && body?.model
        ? 'Router selected ' + safeDetail(body.model)
        : 'Returned non-empty text using the expected chat-completions format.';
      return { provider, model: candidate.model, capability: 'AI text', status: 'PASS', ms: Date.now() - started, detail: selectedModel };
    }
    if (response.ok) {
      return {
        provider, model: candidate.model, capability: 'AI text',
        status: 'EMPTY/INVALID OUTPUT', ms: Date.now() - started,
        detail: 'HTTP succeeded but the expected non-empty text response was missing.',
      };
    }
    return {
      provider, model: candidate.model, capability: 'AI text',
      status: classifyStatus(response.status), ms: Date.now() - started,
      detail: errorDetail(body, response.status),
    };
  } catch (error) {
    return {
      provider, model: candidate.model, capability: 'AI text',
      status: 'REQUEST ERROR', ms: Date.now() - started,
      detail: error instanceof Error ? error.name : 'Request failed',
    };
  }
}

function skipped(provider: string, model: string, status: string, detail: string): Result {
  return { provider, model, capability: 'AI text', status, ms: 0, detail };
}

function chatCandidate(
  model: string,
  endpoint: string,
  key: string,
  platform: 'openai-compatible' | 'gemini',
  extraHeaders: Record<string, string> = {},
): Candidate {
  if (platform === 'gemini') {
    return {
      model,
      request: signal => fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 24, temperature: 0 },
          }),
          signal,
          redirect: 'error',
        },
      ),
      usable: body => Array.isArray(body?.candidates?.[0]?.content?.parts)
        && body.candidates[0].content.parts.some((part: any) => typeof part?.text === 'string' && part.text.trim().length > 0),
    };
  }

  return {
    model,
    request: signal => fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 24,
        temperature: 0,
        stream: false,
      }),
      signal,
      redirect: 'error',
    }),
    usable: body => typeof body?.choices?.[0]?.message?.content === 'string'
      && body.choices[0].message.content.trim().length > 0,
  };
}

async function testProvider(
  provider: string,
  keyName: string,
  models: Candidate[],
): Promise<Result[]> {
  const key = secret(keyName);
  if (!key) {
    return [skipped(provider, models[0]?.model || '—', 'NOT CONFIGURED', keyName + ' is not configured.')];
  }

  const results: Result[] = [];
  for (const candidate of models) {
    const boundCandidate = candidate.model === 'openrouter/free'
      ? candidate
      : candidate;
    const result = await runCandidate(provider, boundCandidate);
    results.push(result);
    if (result.status === 'PASS') {
      for (const remaining of models.slice(results.length)) {
        results.push(skipped(provider, remaining.model, 'SKIPPED — FALLBACK NOT NEEDED', 'An earlier candidate returned usable output.'));
      }
      break;
    }
    // Auth/config and quota failures usually apply to the credential, not just
    // this model. Avoid turning a diagnostic into a retry storm.
    if (['AUTH/PERMISSION', 'QUOTA/RATE LIMIT'].includes(result.status)) {
      for (const remaining of models.slice(results.length)) {
        results.push(skipped(provider, remaining.model, 'SKIPPED — CREDENTIAL/QUOTA FAILURE', 'Stopped after the credential or quota failure above.'));
      }
      break;
    }
  }
  return results;
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sign in to StreamWeaver first.' }, { status: 401 });
  if (session.username.toLowerCase() !== 'mtman1987') {
    return NextResponse.json({ error: 'This diagnostic is restricted to the owner account.' }, { status: 403 });
  }

  const now = Date.now();
  const previous = lastRunByUser.get(session.username) || 0;
  if (now - previous < MIN_REPEAT_INTERVAL_MS) {
    return NextResponse.json({ error: 'A test just ran. Wait ten seconds before starting another sweep.' }, { status: 429 });
  }
  lastRunByUser.set(session.username, now);

  const geminiKey = secret('GEMINI_API_KEY');
  const geminiVerified = readAICostPolicy().geminiFreeTierVerified;
  const groqKey = secret('GROQ_API_KEY');
  const cerebrasKey = secret('CEREBRAS_API_KEY');
  const openRouterKey = secret('OPENROUTER_API_KEY');
  const mistralKey = secret('MISTRAL_API_KEY');

  const jobs: Promise<Result[]>[] = [];
  if (!geminiKey) {
    jobs.push(Promise.resolve([skipped('Gemini', 'gemini-3.5-flash-lite', 'NOT CONFIGURED', 'GEMINI_API_KEY is not configured.')]));
  } else if (!geminiVerified) {
    jobs.push(Promise.resolve([skipped('Gemini', 'gemini-3.5-flash-lite', 'SKIPPED — FREE TIER NOT VERIFIED', 'The application policy does not mark this Gemini credential/project as verified free-tier. The test will not call Google until that is explicitly verified.')]));
  } else {
    jobs.push(testProvider('Gemini', 'GEMINI_API_KEY', [
      chatCandidate('gemini-3.5-flash-lite', '', geminiKey, 'gemini'),
      chatCandidate('gemini-3.8-flash', '', geminiKey, 'gemini'),
      chatCandidate('gemini-3.7-flash', '', geminiKey, 'gemini'),
      chatCandidate('gemini-3.6-flash', '', geminiKey, 'gemini'),
    ]));
  }

  jobs.push(testProvider('Groq', 'GROQ_API_KEY', [
    chatCandidate('openai/gpt-oss-20b', 'https://api.groq.com/openai/v1/chat/completions', groqKey, 'openai-compatible'),
    chatCandidate('openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', groqKey, 'openai-compatible'),
  ]));
  jobs.push(testProvider('Cerebras', 'CEREBRAS_API_KEY', [
    chatCandidate('gpt-oss-120b', 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, 'openai-compatible'),
    chatCandidate('qwen-3.8-27b', 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, 'openai-compatible'),
  ]));
  jobs.push(testProvider('OpenRouter', 'OPENROUTER_API_KEY', [
    chatCandidate('openrouter/free', 'https://openrouter.ai/api/v1/chat/completions', openRouterKey, 'openai-compatible', {
      'http-referer': 'https://streamweaver-new.fly.dev',
      'x-title': 'StreamWeaver free model diagnostics',
    }),
  ]));
  jobs.push(testProvider('Mistral', 'MISTRAL_API_KEY', [
    chatCandidate('mistral-small-latest', 'https://api.mistral.ai/v1/chat/completions', mistralKey, 'openai-compatible'),
  ]));

  const results = (await Promise.all(jobs)).flat();
  return NextResponse.json({
    startedAt: new Date(now).toISOString(),
    finishedAt: new Date().toISOString(),
    testedCredentialCount: [geminiKey, groqKey, cerebrasKey, openRouterKey, mistralKey].filter(Boolean).length,
    results,
    note: 'Runs small, bounded AI-text probes against the configured free-chain providers only. Each provider tries compatible model IDs in order and stops on the first usable response, credential failure, quota failure, or timeout. Raw provider bodies and secret values are never returned. Gemini is not called unless its free-tier policy flag is explicitly verified.',
  });
}
