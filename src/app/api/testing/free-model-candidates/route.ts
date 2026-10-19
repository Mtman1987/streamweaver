import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Result = {
  provider: string;
  model: string;
  capability: 'AI text' | 'TTS audio';
  status: string;
  ms: number;
  detail?: string;
};

const TIMEOUT_MS = 12_000;
const lastRunByUser = new Map<string, number>();

function secret(name: string): string {
  return String(process.env[name] || '').trim();
}

function safeDetail(value: unknown): string {
  return String(value || '')
    .replace(/(x-goog-api-key|authorization|api[_-]?key|token|secret|bearer)\s*[:=]?\s*[^\s,;"]+/gi, '$1=[REDACTED]')
    .replace(/sk-or-v1-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 220);
}

function classify(status: number): string {
  if (status >= 200 && status < 300) return 'PASS';
  if (status === 401 || status === 403) return 'AUTH/PERMISSION';
  if (status === 402 || status === 429) return 'QUOTA/RATE LIMIT';
  if (status === 404 || status === 405) return 'MODEL/ENDPOINT UNAVAILABLE';
  if (status >= 500) return 'PROVIDER ERROR';
  return 'REQUEST REJECTED';
}

async function test(
  provider: string,
  model: string,
  capability: Result['capability'],
  request: (signal: AbortSignal) => Promise<Response>,
  usable: (body: any, contentType: string) => boolean,
): Promise<Result> {
  const started = Date.now();
  try {
    const response = await request(AbortSignal.timeout(TIMEOUT_MS));
    const contentType = response.headers.get('content-type') || '';
    let body: any = null;
    if (contentType.includes('json')) body = await response.json().catch(() => null);
    else if (contentType.startsWith('audio/')) body = { audioBytes: (await response.arrayBuffer()).byteLength };
    const valid = response.ok && usable(body, contentType);
    if (valid) {
      const selected = provider === 'OpenRouter' && body?.model ? 'Router selected ' + safeDetail(body.model) : '';
      return { provider, model, capability, status: 'PASS', ms: Date.now() - started, ...(selected ? { detail: selected } : {}) };
    }
    const apiError = body?.error || body?.message;
    const diagnostic = apiError
      ? [apiError.code, apiError.status, apiError.message || apiError].filter(Boolean).join(' ')
      : '';
    return {
      provider, model, capability, status: response.ok ? 'EMPTY/INVALID OUTPUT' : classify(response.status),
      ms: Date.now() - started,
      detail: safeDetail([ 'HTTP ' + response.status, diagnostic ].filter(Boolean).join(' — ')),
    };
  } catch (error) {
    return { provider, model, capability, status: 'REQUEST ERROR', ms: Date.now() - started, detail: error instanceof Error ? error.name : 'Request failed' };
  }
}

function geminiText(key: string, model: string): Promise<Result> {
  return test('Gemini', model, 'AI text', signal => fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: TEST_OK' }] }],
        generationConfig: { maxOutputTokens: 96, temperature: 0 },
      }),
      signal,
      redirect: 'error',
    },
  ), body => typeof body?.candidates?.[0]?.content?.parts?.[0]?.text === 'string'
    && body.candidates[0].content.parts[0].text.trim().length > 0);
}

function geminiTts(key: string, model: string): Promise<Result> {
  return test('Gemini', model, 'TTS audio', signal => fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say clearly: short voice capability test.' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      }),
      signal,
      redirect: 'error',
    },
  ), body => Array.isArray(body?.candidates?.[0]?.content?.parts)
    && body.candidates[0].content.parts.some((part: any) => Boolean(part?.inlineData?.data)));
}

function openRouterFree(key: string): Promise<Result> {
  return test('OpenRouter', 'openrouter/free', 'AI text', signal => fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'http-referer': 'https://streamweaver-new.fly.dev', 'x-title': 'StreamWeaver free model test' },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: 'Reply with exactly: TEST_OK' }],
        max_tokens: 96,
        temperature: 0,
        stream: false,
      }),
      signal,
      redirect: 'error',
    },
  ), body => typeof body?.choices?.[0]?.message?.content === 'string'
    && body.choices[0].message.content.trim().length > 0);
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sign in to StreamWeaver first.' }, { status: 401 });
  if (session.username.toLowerCase() !== 'mtman1987') {
    return NextResponse.json({ error: 'This temporary diagnostic is restricted to the owner account.' }, { status: 403 });
  }

  const now = Date.now();
  const previous = lastRunByUser.get(session.username) || 0;
  if (now - previous < 60_000) {
    return NextResponse.json({ error: 'Please wait one minute between candidate test runs.' }, { status: 429 });
  }
  lastRunByUser.set(session.username, now);

  const geminiKey = secret('GEMINI_API_KEY');
  const openRouterKey = secret('OPENROUTER_API_KEY');
  const jobs: Promise<Result>[] = [];

  if (geminiKey) {
    // Known-good baseline plus two current model candidates. Keep requests tiny.
    jobs.push(geminiText(geminiKey, 'gemini-3.5-flash-lite'));
    jobs.push(geminiText(geminiKey, 'gemini-3.6-flash'));
    jobs.push(geminiText(geminiKey, 'gemini-3.8-flash'));
    jobs.push(geminiTts(geminiKey, 'gemini-3.8-flash-lite-tts'));
  } else {
    for (const model of ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash']) {
      jobs.push(Promise.resolve({ provider: 'Gemini', model, capability: 'AI text', status: 'NOT CONFIGURED', ms: 0, detail: 'GEMINI_API_KEY is not configured.' }));
    }
    jobs.push(Promise.resolve({ provider: 'Gemini', model: 'gemini-3.8-flash-lite-tts', capability: 'TTS audio', status: 'NOT CONFIGURED', ms: 0, detail: 'GEMINI_API_KEY is not configured.' }));
  }

  if (openRouterKey) {
    jobs.push(openRouterFree(openRouterKey));
  } else {
    jobs.push(Promise.resolve({ provider: 'OpenRouter', model: 'openrouter/free', capability: 'AI text', status: 'NOT CONFIGURED', ms: 0, detail: 'OPENROUTER_API_KEY is not configured.' }));
  }

  const results = await Promise.all(jobs);
  return NextResponse.json({
    startedAt: new Date(now).toISOString(),
    finishedAt: new Date().toISOString(),
    testedCredentialCount: Number(Boolean(geminiKey)) + Number(Boolean(openRouterKey)),
    results,
    note: 'Focused free-model test only: Gemini free-tier candidates and OpenRouter free router. No OpenAI, EdenAI, Deepgram, Inworld, or other paid/quota-failing providers are called. Secret values and raw response bodies are never returned.',
  });
}
