import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Capability = 'AI text' | 'TTS audio' | 'Voice response';
type Result = { credential: string; capability: Capability; status: string; ms?: number; detail?: string };
const TIMEOUT_MS = 12_000;
const lastRunByUser = new Map<string, number>();

function secret(name: string): string {
  return String(process.env[name] || '').trim();
}
function httpStatus(status: number): string {
  if (status >= 200 && status < 300) return 'PASS';
  if (status === 401 || status === 403) return 'AUTH/PERMISSION';
  if (status === 402 || status === 429) return 'QUOTA/RATE LIMIT';
  if (status === 404 || status === 405) return 'ENDPOINT/MODEL UNAVAILABLE';
  if (status >= 500) return 'PROVIDER ERROR';
  return 'FAILED';
}
async function probe(
  credential: string,
  capability: Capability,
  call: (signal: AbortSignal) => Promise<{ response: Response; valid: (body: any, contentType: string) => boolean }>,
): Promise<Result> {
  const started = Date.now();
  try {
    const { response, valid } = await call(AbortSignal.timeout(TIMEOUT_MS));
    const contentType = response.headers.get('content-type') || '';
    let body: any = null;
    if (contentType.includes('json')) body = await response.json().catch(() => null);
    const ok = response.ok && valid(body, contentType);
    return {
      credential, capability, status: ok ? 'PASS' : httpStatus(response.status),
      ms: Date.now() - started,
      ...(!ok ? { detail: response.ok ? 'HTTP succeeded but usable output was not detected' : 'HTTP ' + response.status } : {}),
    };
  } catch (error) {
    return { credential, capability, status: 'ERROR', ms: Date.now() - started, detail: error instanceof Error ? error.name : 'Request failed' };
  }
}
function postJson(
  url: string, headers: Record<string, string>, body: unknown,
  valid: (body: any, contentType: string) => boolean,
) {
  return (signal: AbortSignal) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal, redirect: 'error',
  }).then(response => ({ response, valid }));
}
function openAiText(key: string) {
  return probe('OPENAI_API_KEY', 'AI text', postJson('https://api.openai.com/v1/chat/completions', {
    authorization: 'Bearer ' + key,
  }, { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with exactly: TEST_OK' }], max_tokens: 12 },
  body => typeof body?.choices?.[0]?.message?.content === 'string' && body.choices[0].message.content.length > 0));
}
function openAiTts(key: string) {
  return probe('OPENAI_API_KEY', 'TTS audio', signal => fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Short voice capability test.' }),
    signal, redirect: 'error',
  }).then(response => ({ response, valid: (_body: any, type: string) => type.startsWith('audio/') })));
}
function geminiText(name: string, key: string) {
  return probe(name, 'AI text', postJson('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    'x-goog-api-key': key,
  }, { contents: [{ parts: [{ text: 'Reply with exactly: TEST_OK' }] }], generationConfig: { maxOutputTokens: 16 } },
  body => typeof body?.candidates?.[0]?.content?.parts?.[0]?.text === 'string' && body.candidates[0].content.parts[0].text.length > 0));
}
function geminiTts(name: string, key: string) {
  return probe(name, 'TTS audio', postJson('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', {
    'x-goog-api-key': key,
  }, { contents: [{ parts: [{ text: 'Say clearly: voice capability test.' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } },
  body => Array.isArray(body?.candidates?.[0]?.content?.parts) && body.candidates[0].content.parts.some((part: any) => Boolean(part?.inlineData?.data))));
}
function anthropicText(key: string) {
  return probe('ANTHROPIC_API_KEY', 'AI text', postJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01',
  }, { model: 'claude-haiku-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with exactly: TEST_OK' }] },
  body => Array.isArray(body?.content) && body.content.some((part: any) => typeof part?.text === 'string' && part.text.length > 0)));
}
function edenText(key: string) {
  return probe('EDENAI_API_KEY', 'AI text', postJson('https://api.edenai.run/v3/chat/completions', {
    authorization: 'Bearer ' + key,
  }, { model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: 'Reply with exactly: TEST_OK' }], max_tokens: 16 },
  body => Boolean(body?.choices?.[0]?.message?.content || body?.message?.content)));
}
function deepgramTts(key: string) {
  return probe('DEEPGRAM_API_KEY', 'TTS audio', signal => fetch('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en', {
    method: 'POST', headers: { authorization: 'Token ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Short voice capability test.' }), signal, redirect: 'error',
  }).then(response => ({ response, valid: (_body: any, type: string) => type.startsWith('audio/') })));
}
function inworldTts(name: string, key: string, auth: 'basic' | 'bearer') {
  return probe(name, 'TTS audio', signal => fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: { authorization: (auth === 'basic' ? 'Basic ' : 'Bearer ') + key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Short voice capability test.', voiceId: 'Ashley', modelId: 'inworld-tts-1' }),
    signal, redirect: 'error',
  }).then(response => ({ response, valid: (body: any, type: string) => type.startsWith('audio/') || Boolean(body?.audioContent) })));
}
function voiceResult(name: string, textResult?: Result, ttsResult?: Result): Result {
  const ok = textResult?.status === 'PASS' && ttsResult?.status === 'PASS';
  const tested = [textResult, ttsResult].filter(Boolean);
  return {
    credential: name, capability: 'Voice response',
    status: ok ? 'PASS (text + speech)' : tested.length ? 'PARTIAL/FAILED' : 'NOT TESTED',
    ...(tested.length ? { ms: tested.reduce((sum, item) => sum + (item?.ms || 0), 0) } : {}),
    detail: ok ? 'Generated an AI answer and synthesized speech in separate calls' : 'Composite test requires both AI text and TTS to pass',
  };
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
    return NextResponse.json({ error: 'Please wait one minute between full test runs.' }, { status: 429 });
  }
  lastRunByUser.set(session.username, now);

  const keys = {
    OPENAI_API_KEY: secret('OPENAI_API_KEY'),
    GEMINI_API_KEY: secret('GEMINI_API_KEY'),
    GOOGLE_GENAI_API_KEY: secret('GOOGLE_GENAI_API_KEY'),
    ANTHROPIC_API_KEY: secret('ANTHROPIC_API_KEY'),
    EDENAI_API_KEY: secret('EDENAI_API_KEY'),
    DEEPGRAM_API_KEY: secret('DEEPGRAM_API_KEY'),
    INWORLD_BASE64_API_KEY: secret('INWORLD_BASE64_API_KEY'),
    INWORLD_JWT_API_KEY: secret('INWORLD_JWT_API_KEY'),
  };
  const jobs: Promise<Result>[] = [];
  if (keys.OPENAI_API_KEY) jobs.push(openAiText(keys.OPENAI_API_KEY), openAiTts(keys.OPENAI_API_KEY));
  if (keys.GEMINI_API_KEY) jobs.push(geminiText('GEMINI_API_KEY', keys.GEMINI_API_KEY), geminiTts('GEMINI_API_KEY', keys.GEMINI_API_KEY));
  if (keys.GOOGLE_GENAI_API_KEY) jobs.push(geminiText('GOOGLE_GENAI_API_KEY', keys.GOOGLE_GENAI_API_KEY), geminiTts('GOOGLE_GENAI_API_KEY', keys.GOOGLE_GENAI_API_KEY));
  if (keys.ANTHROPIC_API_KEY) jobs.push(anthropicText(keys.ANTHROPIC_API_KEY));
  if (keys.EDENAI_API_KEY) jobs.push(edenText(keys.EDENAI_API_KEY));
  if (keys.DEEPGRAM_API_KEY) jobs.push(deepgramTts(keys.DEEPGRAM_API_KEY));
  if (keys.INWORLD_BASE64_API_KEY) jobs.push(inworldTts('INWORLD_BASE64_API_KEY', keys.INWORLD_BASE64_API_KEY, 'basic'));
  if (keys.INWORLD_JWT_API_KEY) jobs.push(inworldTts('INWORLD_JWT_API_KEY', keys.INWORLD_JWT_API_KEY, 'bearer'));

  const results = await Promise.all(jobs);
  const byName = (name: string, capability: Capability) => results.find(r => r.credential === name && r.capability === capability);
  for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_API_KEY', 'EDENAI_API_KEY']) {
    if (keys[name as keyof typeof keys]) results.push(voiceResult(name, byName(name, 'AI text'), byName(name, 'TTS audio')));
  }
  if (keys.ANTHROPIC_API_KEY) results.push({ credential: 'ANTHROPIC_API_KEY', capability: 'TTS audio', status: 'NOT OFFERED BY PROVIDER API', detail: 'Anthropic Messages API is text-only; this key has no Anthropic TTS endpoint to test.' });
  if (keys.DEEPGRAM_API_KEY) results.push({ credential: 'DEEPGRAM_API_KEY', capability: 'AI text', status: 'NOT A GENERAL LLM API', detail: 'Deepgram is tested for speech synthesis.' });
  for (const name of ['INWORLD_BASE64_API_KEY', 'INWORLD_JWT_API_KEY']) {
    if (keys[name as keyof typeof keys]) results.push({ credential: name, capability: 'AI text', status: 'NOT TESTED', detail: 'Inworld text-inference authentication is distinct; this sweep probes the voice endpoint only.' });
  }
  return NextResponse.json({
    startedAt: new Date(now).toISOString(),
    finishedAt: new Date().toISOString(),
    testedCredentialCount: Object.values(keys).filter(Boolean).length,
    results,
    note: 'Only credential names, status, latency, and generic diagnostics are returned. Secret values and raw provider response bodies are never returned.',
  });
}
