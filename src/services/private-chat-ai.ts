const PRIVATE_CHAT_MODEL = 'google/gemini-2.5-flash';
const PRIVATE_CHAT_MAX_TOKENS = 2400;
const PRIVATE_CHAT_ATTEMPTS = 2;
const DEFAULT_LOCAL_MODEL = 'spmt-qwen3-4b';

type FetchLike = typeof fetch;

export type PrivateChatCompletionResult = {
  text: string;
  provider?: 'local-qwen' | 'edenai';
  model?: string;
  upstreamStatus?: number;
  upstreamError?: string;
  filtered?: boolean;
  finishReason?: string;
};

export function extractPrivateChatResponseText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((part: any) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    })
    .join('')
    .trim();
}

async function requestLocalQwenCompletion(input: {
  baseUrl: string;
  model?: string;
  systemPrompt: string;
  prompt: string;
  fetchImpl: FetchLike;
}): Promise<PrivateChatCompletionResult> {
  const baseUrl = String(input.baseUrl || '').trim().replace(/\/$/, '');
  if (!baseUrl) return { text: '' };
  const model = String(input.model || DEFAULT_LOCAL_MODEL).trim() || DEFAULT_LOCAL_MODEL;
  try {
    const response = await input.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      // SPMT authenticates the caller before this private-network hop. The
      // Qwen worker does not need a second user-facing or generated API key.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: PRIVATE_CHAT_MAX_TOKENS,
        temperature: 0.8,
        stream: false,
      }),
    });
    const rawBody = await response.text();
    if (!response.ok) {
      return {
        text: '',
        provider: 'local-qwen',
        model,
        upstreamStatus: response.status,
        upstreamError: rawBody,
      };
    }
    let data: any = {};
    try {
      data = JSON.parse(rawBody);
    } catch {}
    return {
      text: extractPrivateChatResponseText(data),
      provider: 'local-qwen',
      model,
    };
  } catch (error) {
    return {
      text: '',
      provider: 'local-qwen',
      model,
      upstreamError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestPrivateChatCompletion(input: {
  apiKey: string;
  systemPrompt: string;
  prompt: string;
  localBaseUrl?: string;
  localModel?: string;
  fetchImpl?: FetchLike;
}): Promise<PrivateChatCompletionResult> {
  const fetchImpl = input.fetchImpl || fetch;

  if (input.localBaseUrl) {
    const local = await requestLocalQwenCompletion({
      baseUrl: input.localBaseUrl,
      model: input.localModel,
      systemPrompt: input.systemPrompt,
      prompt: input.prompt,
      fetchImpl,
    });
    if (local.text) return local;
    console.warn('[Private Chat API] Local Qwen failed; trying explicit EdenAI fallback', {
      upstreamStatus: local.upstreamStatus || null,
      upstreamError: local.upstreamError ? local.upstreamError.slice(0, 300) : null,
    });
    if (!input.apiKey) return local;
  }

  if (!input.apiKey) {
    return { text: '', provider: 'edenai', upstreamError: 'EdenAI API key is not configured' };
  }

  for (let attempt = 1; attempt <= PRIVATE_CHAT_ATTEMPTS; attempt++) {
    const response = await fetchImpl('https://api.edenai.run/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PRIVATE_CHAT_MODEL,
        fallbacks: ['openai/gpt-4.1-mini'],
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: PRIVATE_CHAT_MAX_TOKENS,
        max_completion_tokens: PRIVATE_CHAT_MAX_TOKENS,
        reasoning_effort: 'minimal',
        stream: false,
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      if (/content[_ ]filter|content rejected|policy violation|violation of the following policies/i.test(rawBody)) {
        console.warn('[Private Chat API] EdenAI rejected prompt content', {
          attempt,
          upstreamStatus: response.status,
        });
        return {
          text: '',
          provider: 'edenai',
          model: PRIVATE_CHAT_MODEL,
          upstreamStatus: response.status,
          upstreamError: rawBody,
          filtered: true,
          finishReason: 'content_filter',
        };
      }
      return {
        text: '',
        provider: 'edenai',
        model: PRIVATE_CHAT_MODEL,
        upstreamStatus: response.status,
        upstreamError: rawBody,
      };
    }

    let data: any = {};
    try {
      data = JSON.parse(rawBody);
    } catch {}

    const text = extractPrivateChatResponseText(data);
    if (text) return { text, provider: 'edenai', model: PRIVATE_CHAT_MODEL };

    const choice = data?.choices?.[0];
    const finishReason = String(choice?.finish_reason || '');
    const details = {
      attempt,
      finishReason: finishReason || null,
      contentType: Array.isArray(choice?.message?.content) ? 'array' : typeof choice?.message?.content,
      completionTokens: data?.usage?.completion_tokens || null,
      reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens || null,
    };
    if (attempt < PRIVATE_CHAT_ATTEMPTS) {
      console.log('[Private Chat API] EdenAI returned no visible text; retrying', details);
    } else {
      console.warn('[Private Chat API] EdenAI returned no visible text after retries', details);
    }

    if (finishReason === 'content_filter') {
      return { text: '', provider: 'edenai', model: PRIVATE_CHAT_MODEL, filtered: true, finishReason };
    }
  }

  return { text: '', provider: 'edenai', model: PRIVATE_CHAT_MODEL };
}
