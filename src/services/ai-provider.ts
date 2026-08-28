import { readUserConfigSync } from '@/lib/user-config';
import { BOT_NO_SELF_PROMOTION_POLICY } from '@/lib/bot-conduct-policy';
import { isSpmtLocalLlmEnabled, requestSpmtLocalLlm } from '@/services/spmt-local-llm';

export type AIProvider = 'gemini' | 'edenai' | 'openai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_EDENAI_MODEL = 'google/gemini-2.5-flash';
const EDENAI_CHAT_COMPLETIONS_URL = 'https://api.edenai.run/v3/chat/completions';
const DEFAULT_EDENAI_MAX_TOKENS = 400;
const MAX_EDENAI_CONTINUATION_TOKENS = 400;
const MAX_EDENAI_CONTINUATION_ATTEMPTS = 2;
const DEFAULT_AI_MAX_CHARACTERS = 12_000;
const LOCAL_LLM_CIRCUIT_OPEN_MS = 5 * 60 * 1000;

let localLlmCircuitOpenUntil = 0;
let localLlmCircuitReason = '';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  personalityName: string;
  botName: string;
}

export interface AIResponseOptions {
  maxTokens?: number;
  maxCharacters?: number;
  temperature?: number;
}

export function getAIConfig(tenantId?: string): AIConfig {
  const config = readUserConfigSync(tenantId);

  const provider = (config.AI_PROVIDER as AIProvider) || 'edenai';
  const personalityName = config.AI_PERSONALITY_NAME || 'Captain';
  const botName = config.AI_BOT_NAME || 'StreamWeaver87';

  let apiKey = '';
  let model = '';

  switch (provider) {
    case 'gemini':
      apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
      model = normalizeGeminiModel(config.AI_MODEL || DEFAULT_GEMINI_MODEL);
      break;
    case 'edenai':
      apiKey = config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
      model = normalizeEdenAIModel(config.AI_MODEL || DEFAULT_EDENAI_MODEL);
      break;
    case 'openai':
      apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
      model = config.AI_MODEL || 'gpt-4o-mini';
      break;
  }

  return { provider, model, apiKey, personalityName, botName };
}

function getEdenFallbackConfig(tenantId?: string): AIConfig {
  const config = readUserConfigSync(tenantId);
  return {
    provider: 'edenai',
    model: normalizeEdenAIModel(
      (config.AI_PROVIDER === 'edenai' ? config.AI_MODEL : '') || DEFAULT_EDENAI_MODEL,
    ),
    apiKey: config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '',
    personalityName: config.AI_PERSONALITY_NAME || 'Captain',
    botName: config.AI_BOT_NAME || 'StreamWeaver87',
  };
}

function normalizeGeminiModel(model: string): string {
  if (!model) return DEFAULT_GEMINI_MODEL;
  if (model === 'gemini-2.0-flash' || model.startsWith('gemini-2.0-flash-')) {
    return DEFAULT_GEMINI_MODEL;
  }
  return model;
}

function normalizeEdenAIModel(model: string): string {
  if (!model) return DEFAULT_EDENAI_MODEL;
  if (model === 'google/gemini-2.0-flash' || model.startsWith('google/gemini-2.0-flash-')) {
    return DEFAULT_EDENAI_MODEL;
  }
  return model;
}

function governedPrompt(systemPrompt?: string): string {
  return [systemPrompt, BOT_NO_SELF_PROMOTION_POLICY].filter(Boolean).join('\n\n');
}

function isTransientLocalLlmFailure(message: string): boolean {
  return /aborted|aborterror|timeout|timed out|fetch failed|econnrefused|econnreset|socket|502|503|504/i.test(message);
}

function localLlmCircuitIsOpen(): boolean {
  if (Date.now() >= localLlmCircuitOpenUntil) {
    localLlmCircuitOpenUntil = 0;
    localLlmCircuitReason = '';
    return false;
  }
  return true;
}

function openLocalLlmCircuit(reason: string): void {
  localLlmCircuitOpenUntil = Date.now() + LOCAL_LLM_CIRCUIT_OPEN_MS;
  localLlmCircuitReason = reason;
}

function closeLocalLlmCircuit(): void {
  localLlmCircuitOpenUntil = 0;
  localLlmCircuitReason = '';
}

/**
 * Shared bot AI entry point.
 *
 * Emergency quality routing is intentionally global and tenant-neutral:
 *   1. EdenAI first for normal tenant text generation;
 *   2. owner-hosted SPMT Qwen only when EdenAI is unavailable, rate-limited,
 *      out of credits, missing a usable key, or otherwise fails.
 *
 * The local circuit breaker remains in place so an unavailable Qwen fallback
 * does not add the same timeout to every EdenAI failure.
 */
export async function generateAIResponse(
  prompt: string,
  systemPrompt?: string,
  tenantId?: string,
  options?: AIResponseOptions,
): Promise<string> {
  let edenFailure = '';

  try {
    const response = await generateEdenAIFallbackResponse(prompt, systemPrompt, tenantId, options);
    console.log(`[AI Provider] EdenAI served tenant ${tenantId || 'global'}`);
    return response;
  } catch (error) {
    edenFailure = error instanceof Error ? error.message : String(error);
    console.warn(`[AI Provider] EdenAI primary failed for tenant ${tenantId || 'global'}; falling back to local Qwen:`, edenFailure);
  }

  if (!isSpmtLocalLlmEnabled()) {
    throw new Error(`AI generation failed. EdenAI primary: ${edenFailure} Local Qwen fallback is disabled.`);
  }

  if (localLlmCircuitIsOpen()) {
    throw new Error([
      'AI generation failed.',
      `EdenAI primary: ${edenFailure}`,
      `Local Qwen fallback circuit is open${localLlmCircuitReason ? ` after: ${localLlmCircuitReason}` : ''}`,
    ].join(' '));
  }

  const system = governedPrompt(systemPrompt);
  try {
    const local = await requestSpmtLocalLlm(prompt, system, options);
    closeLocalLlmCircuit();
    console.log(`[AI Provider] Local Qwen fallback served tenant ${tenantId || 'global'} with ${local.model}`);
    return local.text;
  } catch (error) {
    const localFailure = error instanceof Error ? error.message : String(error);
    if (isTransientLocalLlmFailure(localFailure)) {
      openLocalLlmCircuit(localFailure);
      console.warn(`[AI Provider] Local Qwen fallback temporarily unavailable; opening circuit for 5 minutes: ${localFailure}`);
    }
    throw new Error([
      'AI generation failed.',
      `EdenAI primary: ${edenFailure}`,
      `Local Qwen fallback: ${localFailure}`,
    ].join(' '));
  }
}

export async function generateEdenAIFallbackResponse(
  prompt: string,
  systemPrompt?: string,
  tenantId?: string,
  options?: AIResponseOptions,
): Promise<string> {
  const config = getEdenFallbackConfig(tenantId);
  if (!config.apiKey) {
    throw new Error('No EdenAI API key is configured.');
  }
  return generateEdenAIResponse(prompt, governedPrompt(systemPrompt), config, options);
}

type EdenAIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type EdenAICompletion = {
  text: string;
  finishReason: string;
};

function normalizeFinishReason(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function hitOutputLimit(finishReason: string): boolean {
  return [
    'length',
    'max_tokens',
    'max_output_tokens',
    'token_limit',
    'max_token_limit',
  ].includes(normalizeFinishReason(finishReason));
}

function looksIncompleteCompletion(text: string, finishReason = ''): boolean {
  const value = String(text || '').trim();
  if (!value) return true;
  if (hitOutputLimit(finishReason)) return true;
  if (/(?:\.\.\.|…)[\"')\]}]*\s*$/.test(value)) return true;
  if (/[,;:\-–—][\"')\]}]*\s*$/.test(value)) return true;
  if (/\b(?:and|but|because|so|to|of|with|that|which|who|when|while|if|then)[\"')\]}]*\s*$/i.test(value)) return true;
  return value.length >= 80 && !/[.!?][\"')\]}]*\s*$/.test(value);
}

function joinContinuation(existing: string, continuation: string): string {
  const left = String(existing || '').trimEnd();
  const right = String(continuation || '')
    .replace(/^\s*(?:continuation|continued)\s*:?\s*/i, '')
    .trimStart();
  if (!left) return right;
  if (!right) return left;

  const maxOverlap = Math.min(160, left.length, right.length);
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  for (let size = maxOverlap; size >= 12; size--) {
    if (leftLower.slice(-size) === rightLower.slice(0, size)) {
      return left + right.slice(size);
    }
  }

  if (left.endsWith('-')) return left.slice(0, -1) + right;
  return left + (/^[,.;:!?]/.test(right) ? '' : ' ') + right;
}

function maxCharacters(options?: AIResponseOptions): number {
  const requested = Number(options?.maxCharacters || DEFAULT_AI_MAX_CHARACTERS);
  if (!Number.isFinite(requested)) return DEFAULT_AI_MAX_CHARACTERS;
  return Math.max(512, Math.min(50_000, Math.floor(requested)));
}

function capAtCompleteSentence(text: string, limit: number): string {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;

  const candidate = value.slice(0, limit);
  let sentenceEnd = -1;
  for (const match of candidate.matchAll(/[.!?](?:[\"')\]}]+)?(?=\s|$)/g)) {
    sentenceEnd = (match.index || 0) + match[0].length;
  }
  if (sentenceEnd >= Math.floor(limit * 0.6)) {
    return candidate.slice(0, sentenceEnd).trim();
  }
  return `${candidate.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

async function requestEdenAICompletion(
  messages: EdenAIChatMessage[],
  config: AIConfig,
  options?: AIResponseOptions,
): Promise<EdenAICompletion> {
  const response = await fetch(EDENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options?.maxTokens ?? DEFAULT_EDENAI_MAX_TOKENS,
      temperature: options?.temperature ?? 0.7,
      stream: false,
    }),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data?.error?.message || data?.error || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`EdenAI request failed: ${detail}`);
  }

  const choice = data?.choices?.[0];
  const text = String(choice?.message?.content || '').trim();
  if (!text) throw new Error('EdenAI returned an empty response.');
  return {
    text,
    finishReason: normalizeFinishReason(choice?.finish_reason),
  };
}

async function generateEdenAIResponse(
  prompt: string,
  systemPrompt: string,
  config: AIConfig,
  options?: AIResponseOptions,
): Promise<string> {
  const messages: EdenAIChatMessage[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const characterLimit = maxCharacters(options);
  const first = await requestEdenAICompletion(messages, config, options);
  let text = first.text;
  let finishReason = first.finishReason;
  let continuationAttempts = 0;

  while (
    looksIncompleteCompletion(text, finishReason)
    && continuationAttempts < MAX_EDENAI_CONTINUATION_ATTEMPTS
    && text.length < characterLimit - 128
  ) {
    continuationAttempts += 1;
    console.warn(
      `[AI Provider] EdenAI returned an incomplete completion (finish_reason=${finishReason || 'unknown'}, characters=${text.length}); requesting continuation ${continuationAttempts}/${MAX_EDENAI_CONTINUATION_ATTEMPTS}.`,
    );

    const remainingCharacters = characterLimit - text.length;
    const continuationMaxTokens = Math.max(
      64,
      Math.min(
        MAX_EDENAI_CONTINUATION_TOKENS,
        options?.maxTokens ?? DEFAULT_EDENAI_MAX_TOKENS,
        Math.ceil(remainingCharacters / 3),
      ),
    );
    const continuation = await requestEdenAICompletion(
      [
        ...messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content: 'Continue exactly where your previous answer stopped. Finish the thought in complete sentences. Do not repeat earlier text, add a heading, or mention that you are continuing.',
        },
      ],
      config,
      { ...options, maxTokens: continuationMaxTokens },
    );
    text = joinContinuation(text, continuation.text);
    finishReason = continuation.finishReason;
  }

  if (looksIncompleteCompletion(text, finishReason)) {
    throw new Error(
      `EdenAI returned an incomplete response after ${continuationAttempts} continuation attempt(s) (finish_reason=${finishReason || 'unknown'}).`,
    );
  }

  return capAtCompleteSentence(text, characterLimit);
}
