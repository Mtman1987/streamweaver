import fs from 'node:fs';

const helper = `export type OpenAiFallbackMessage = { role: 'user' | 'assistant'; content: string };
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
`;
fs.writeFileSync('src/services/openai-fallback.ts', helper, 'utf8');

function patchFile(path, transform) {
  const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after, 'utf8');
  console.log(after === before ? `OpenAI fallback already applied: ${path}` : `Patched OpenAI fallback: ${path}`);
}

patchFile('src/services/ai-provider.ts', (source) => {
  const importMarker = "import { isSpmtLocalLlmEnabled, requestSpmtLocalLlm } from '@/services/spmt-local-llm';\n";
  const openAiImport = "import { isOpenAiFallbackConfigured, generateOpenAiFallbackResponse } from '@/services/openai-fallback';\n";
  if (!source.includes(openAiImport)) {
    if (!source.includes(importMarker)) throw new Error('AI provider import marker missing.');
    source = source.replace(importMarker, importMarker + openAiImport);
  }
  if (source.includes("console.log(`[AI Provider] OpenAI fallback served tenant")) return source;
  const marker = `  if (!isSpmtLocalLlmEnabled()) {
    throw new Error(\`AI generation failed. EdenAI primary: \${edenFailure} Local Qwen fallback is disabled.\`);
  }
`;
  if (!source.includes(marker)) throw new Error('AI provider local fallback marker missing.');
  const replacement = `  let openAiFailure = '';
  const configuredProvider = getAIConfig(tenantId);
  const configuredOpenAiKey = configuredProvider.provider === 'openai' ? configuredProvider.apiKey : '';
  if (isOpenAiFallbackConfigured(configuredOpenAiKey)) {
    try {
      const response = await generateOpenAiFallbackResponse(prompt, governedPrompt(systemPrompt), {
        ...options,
        apiKey: configuredOpenAiKey || undefined,
        model: configuredProvider.provider === 'openai' ? configuredProvider.model : undefined,
      });
      console.log(\`[AI Provider] OpenAI fallback served tenant \${tenantId || 'global'}\`);
      return response;
    } catch (error) {
      openAiFailure = error instanceof Error ? error.message : String(error);
      console.warn(\`[AI Provider] OpenAI fallback failed for tenant \${tenantId || 'global'}; trying local Qwen:\`, openAiFailure);
    }
  }

  if (!isSpmtLocalLlmEnabled()) {
    throw new Error(\`AI generation failed. EdenAI primary: \${edenFailure} OpenAI fallback: \${openAiFailure || 'not configured'} Local Qwen fallback is disabled.\`);
  }
`;
  return source.replace(marker, replacement);
});

patchFile('src/app/api/private-chat/respond/route.ts', (source) => {
  // The shared EdenAI/OpenAI path already handles private replies when Qwen is offline.
  if (source.includes('const rawPrimary = await generateAIResponse(')) return source;
  const importMarker = "import { generateEdenAIFallbackResponse } from '@/services/ai-provider';\n";
  const openAiImport = "import { isOpenAiFallbackConfigured, requestOpenAiFallback } from '@/services/openai-fallback';\n";
  if (!source.includes(openAiImport)) {
    if (!source.includes(importMarker)) throw new Error('Private chat OpenAI import marker missing.');
    source = source.replace(importMarker, importMarker + openAiImport);
  }
  source = source.replace(
    "provider: 'edenai-primary' | 'self-hosted-qwen-adult';",
    "provider: 'edenai-primary' | 'self-hosted-qwen-adult' | 'openai-adult-bridge';",
  );
  if (source.includes("const preferQwen = process.env.PRIVATE_QWEN_PREFERRED === 'true';")) return source;

  const start = source.indexOf('  if (input.adultMode) {');
  const end = source.indexOf('\n\n  const edenSystem = [', start);
  if (start < 0 || end < 0) throw new Error('Private chat Adult Mode block markers missing.');
  const block = `  if (input.adultMode) {
    const preferQwen = process.env.PRIVATE_QWEN_PREFERRED === 'true';

    const tryOpenAi = async (): Promise<PrivateCompletionResult | null> => {
      if (!isOpenAiFallbackConfigured()) return null;
      try {
        const historyMessages = input.history.slice(-24).map((entry) => ({
          role: entry.type === 'ai' ? 'assistant' as const : 'user' as const,
          content: String(entry.message || '').trim(),
        })).filter((entry) => entry.content);
        const completion = await requestOpenAiFallback({
          instructions: input.systemPrompt,
          messages: [...historyMessages, { role: 'user', content: input.message }],
          options: { maxTokens: 900, model: process.env.PRIVATE_OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini' },
        });
        const text = sanitizeQwenReply({ text: completion.text, username: input.username, botName: input.botName, latestUserMessage: input.message }).trim();
        if (!text) throw new Error('OpenAI returned no usable private reply.');
        return { text, provider: 'openai-adult-bridge' };
      } catch (error) {
        console.warn('[Private Chat API] OpenAI Adult Mode bridge failed:', safeModelError(error instanceof Error ? error.message : String(error)));
        return null;
      }
    };

    if (!preferQwen) {
      const openAi = await tryOpenAi();
      if (openAi) return openAi;
    }

    const qwen = await requestQwenPrivateChatCompletion({
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      systemPrompt: input.systemPrompt,
      username: input.username,
      botName: input.botName,
      message: input.message,
      history: input.history,
      memoryIndex: input.memoryIndex,
      memoryContext: input.memoryContext,
      adultMode: true,
    });

    if (!qwen.upstreamStatus && !qwen.upstreamError && qwen.text.trim()) {
      return { text: qwen.text.trim(), provider: 'self-hosted-qwen-adult' };
    }

    if (preferQwen) {
      const openAi = await tryOpenAi();
      if (openAi) return openAi;
    }

    const qwenError = safeModelError(qwen.upstreamError || (qwen.upstreamStatus ? \`HTTP \${qwen.upstreamStatus}\` : 'empty response'));
    return { text: '', provider: 'self-hosted-qwen-adult', error: \`Adult Mode providers unavailable. Local Qwen: \${qwenError}\` };
  }`;
  source = source.slice(0, start) + block + source.slice(end);

  source = source.replace(
    "`${botName} will use the owner-hosted SPMT Qwen model with the adult private-chat policy.`,\n            'EdenAI is not used while Adult Mode is on.',",
    "process.env.PRIVATE_QWEN_PREFERRED === 'true'\n              ? `${botName} will prefer local Qwen and use OpenAI only if Qwen is unavailable.`\n              : `${botName} will use the temporary OpenAI bridge while local Qwen is offline; Qwen remains available as fallback.`,\n            'EdenAI is not used while Adult Mode is on.',",
  );
  return source;
});
