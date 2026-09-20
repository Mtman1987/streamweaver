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
  const model = String(input.options?.model || process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini').trim();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      store: false,
      instructions: String(input.instructions || ''),
      input: input.messages,
      max_output_tokens: Math.max(64, Math.min(4000, Number(input.options?.maxTokens || 900))),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI request failed: ${String(payload?.error?.message || `HTTP ${response.status}`).slice(0, 300)}`);
  const text = extractOutputText(payload);
  if (!text) throw new Error('OpenAI returned an empty response.');
  return { text, model };
}

export async function generateOpenAiFallbackResponse(prompt: string, systemPrompt?: string, options?: OpenAiFallbackOptions): Promise<string> {
  const result = await requestOpenAiFallback({ instructions: systemPrompt, messages: [{ role: 'user', content: prompt }], options });
  return result.text;
}
