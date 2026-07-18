const PRIVATE_CHAT_MODEL = 'google/gemini-2.5-flash';
const PRIVATE_CHAT_MAX_TOKENS = 1600;
const PRIVATE_CHAT_ATTEMPTS = 2;

type FetchLike = typeof fetch;

export type PrivateChatCompletionResult = {
  text: string;
  upstreamStatus?: number;
  upstreamError?: string;
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

export async function requestPrivateChatCompletion(input: {
  apiKey: string;
  systemPrompt: string;
  prompt: string;
  fetchImpl?: FetchLike;
}): Promise<PrivateChatCompletionResult> {
  const fetchImpl = input.fetchImpl || fetch;

  for (let attempt = 1; attempt <= PRIVATE_CHAT_ATTEMPTS; attempt++) {
    const response = await fetchImpl('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PRIVATE_CHAT_MODEL,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: PRIVATE_CHAT_MAX_TOKENS,
        stream: false,
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      return {
        text: '',
        upstreamStatus: response.status,
        upstreamError: rawBody,
      };
    }

    let data: any = {};
    try {
      data = JSON.parse(rawBody);
    } catch {}

    const text = extractPrivateChatResponseText(data);
    if (text) return { text };

    const choice = data?.choices?.[0];
    console.warn('[Private Chat API] EdenAI returned no visible text', {
      attempt,
      finishReason: choice?.finish_reason || null,
      contentType: Array.isArray(choice?.message?.content) ? 'array' : typeof choice?.message?.content,
      completionTokens: data?.usage?.completion_tokens || null,
      reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens || null,
    });
  }

  return { text: '' };
}
