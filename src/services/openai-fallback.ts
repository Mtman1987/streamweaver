export type OpenAiFallbackMessage = { role: 'user' | 'assistant'; content: string };
export type OpenAiFallbackOptions = { maxTokens?: number; temperature?: number; model?: string; apiKey?: string };

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => part?.type === 'output_text')
    .map((part: any) => String(part?.text || ''))
    .join('')
    .trim();
}

function hasRefusal(payload: any): boolean {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .some((item: any) => Array.isArray(item?.content) && item.content.some((part: any) => part?.type === 'refusal'));
}

export function isOpenAiFallbackConfigured(apiKey?: string): boolean {
  return Boolean(String(apiKey || process.env.OPENAI_API_KEY || '').trim());
}

export async function requestOpenAiFallback(input: {
  instructions?: string;
  messages: OpenAiFallbackMessage[];
  options?: OpenAiFallbackOptions;
}): Promise<{ text: string; model: string }> {
  const apiKey = String(input.options?.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured.');
  const selectedModel = String(input.options?.model || process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini').trim();
  const requestedTokens = Math.max(256, Math.min(4000, Number(input.options?.maxTokens || 900)));

  async function request(model: string, maxOutputTokens: number): Promise<any> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        store: false,
        instructions: String(input.instructions || ''),
        input: input.messages,
        max_output_tokens: maxOutputTokens,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('OpenAI request failed: ' + String(payload?.error?.message || 'HTTP ' + response.status).slice(0, 300));
    return payload;
  }

  const first = await request(selectedModel, requestedTokens);
  const firstText = extractOutputText(first);
  if (firstText) return { text: firstText, model: selectedModel };
  if (hasRefusal(first)) throw new Error('OpenAI declined the response.');

  // A reasoning model can consume its output budget before emitting visible text.
  // Retry once with the verified non-reasoning model; never turn a short answer into an error.
  if (selectedModel !== 'gpt-4.1-mini') {
    console.warn('[OpenAI Fallback] No visible text from ' + selectedModel + '; retrying gpt-4.1-mini.');
    const second = await request('gpt-4.1-mini', Math.max(512, requestedTokens));
    const secondText = extractOutputText(second);
    if (secondText) return { text: secondText, model: 'gpt-4.1-mini' };
    if (hasRefusal(second)) throw new Error('OpenAI declined the response.');
  }
  throw new Error('OpenAI produced no visible response.');
}

export async function generateOpenAiFallbackResponse(prompt: string, systemPrompt?: string, options?: OpenAiFallbackOptions): Promise<string> {
  const result = await requestOpenAiFallback({ instructions: systemPrompt, messages: [{ role: 'user', content: prompt }], options });
  return result.text;
}
