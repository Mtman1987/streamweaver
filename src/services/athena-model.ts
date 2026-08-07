const DEFAULT_LOCAL_MODEL = 'spmt-qwen3-4b';
const DEFAULT_EDEN_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 120_000;

export type AthenaModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

export type AthenaModelResult = {
  text: string;
  provider: 'local-qwen' | 'edenai';
  model: string;
  usage?: unknown;
};

type FetchLike = typeof fetch;

function localBaseUrl(): string {
  return String(process.env.SPMT_LLM_BASE_URL || '').trim().replace(/\/$/, '');
}

function localModel(): string {
  return String(
    process.env.ATHENA_CHAT_LOCAL_MODEL ||
    process.env.SPMT_LLM_MODEL ||
    DEFAULT_LOCAL_MODEL,
  ).trim() || DEFAULT_LOCAL_MODEL;
}

function localWorkerKey(): string {
  return String(
    process.env.SPMT_LLM_API_KEY ||
    process.env.SPMT_API_KEY ||
    process.env.SPMT_PLATFORM_API_KEY ||
    process.env.LLM_WORKER_TOKEN ||
    process.env.LLAMA_API_KEY ||
    '',
  ).trim();
}

function extractText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
      : '';
  return String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

function abortSignal(timeoutMs: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

async function requestLocal(input: {
  messages: AthenaModelMessage[];
  temperature: number;
  maxTokens: number;
  model?: string;
  fetchImpl: FetchLike;
}): Promise<AthenaModelResult> {
  const base = localBaseUrl();
  if (!base) throw new Error('SPMT_LLM_BASE_URL is not configured');
  const model = String(input.model || localModel()).trim() || localModel();
  const key = localWorkerKey();
  const response = await input.fetchImpl(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      stream: false,
    }),
    signal: abortSignal(DEFAULT_TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch {}
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `Local Qwen returned ${response.status}: ${raw.slice(0, 300)}`);
  }
  const text = extractText(payload);
  if (!text) throw new Error('Local Qwen returned an empty response');
  return { text, provider: 'local-qwen', model, usage: payload?.usage };
}

async function requestEden(input: {
  messages: AthenaModelMessage[];
  temperature: number;
  maxTokens: number;
  fetchImpl: FetchLike;
}): Promise<AthenaModelResult> {
  const key = String(process.env.EDENAI_API_KEY || '').trim();
  if (!key) throw new Error('EdenAI fallback is not configured');
  const model = String(process.env.ATHENA_EDEN_FALLBACK_MODEL || DEFAULT_EDEN_MODEL).trim() || DEFAULT_EDEN_MODEL;
  const response = await input.fetchImpl('https://api.edenai.run/v3/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      fallbacks: ['openai/gpt-4.1-mini'],
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      max_completion_tokens: input.maxTokens,
      reasoning_effort: 'minimal',
      stream: false,
    }),
    signal: abortSignal(DEFAULT_TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch {}
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `EdenAI returned ${response.status}: ${raw.slice(0, 300)}`);
  }
  const text = extractText(payload);
  if (!text) throw new Error('EdenAI returned an empty response');
  return { text, provider: 'edenai', model, usage: payload?.usage };
}

export async function requestAthenaModel(input: {
  messages: AthenaModelMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  fetchImpl?: FetchLike;
  allowFallback?: boolean;
}): Promise<AthenaModelResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const temperature = Number.isFinite(Number(input.temperature))
    ? Math.max(0, Math.min(2, Number(input.temperature)))
    : 0.7;
  const maxTokens = Number.isFinite(Number(input.maxTokens))
    ? Math.max(32, Math.min(4096, Math.floor(Number(input.maxTokens))))
    : 1200;

  try {
    return await requestLocal({
      messages: input.messages,
      temperature,
      maxTokens,
      model: input.model,
      fetchImpl,
    });
  } catch (localError) {
    console.warn('[Athena Model] Local Qwen request failed', {
      error: localError instanceof Error ? localError.message : String(localError),
      fallbackEnabled: input.allowFallback !== false,
    });
    if (input.allowFallback === false) throw localError;
    return requestEden({ messages: input.messages, temperature, maxTokens, fetchImpl });
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function requestAthenaJson(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
  fetchImpl?: FetchLike;
}): Promise<{ data: Record<string, unknown>; model: AthenaModelResult }> {
  const model = await requestAthenaModel({
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
    ],
    temperature: 0,
    maxTokens: input.maxTokens || 500,
    fetchImpl: input.fetchImpl,
  });
  const data = extractJsonObject(model.text);
  if (!data) throw new Error('Athena decision model returned invalid JSON');
  return { data, model };
}

export function getAthenaModelStatus() {
  return {
    localReady: Boolean(localBaseUrl()),
    localBaseUrl: localBaseUrl() || null,
    localModel: localModel(),
    localAuthenticationConfigured: Boolean(localWorkerKey()),
    edenFallbackReady: Boolean(String(process.env.EDENAI_API_KEY || '').trim()),
  };
}
