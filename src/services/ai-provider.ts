import { readUserConfigSync } from '@/lib/user-config';
import { BOT_NO_SELF_PROMOTION_POLICY } from '@/lib/bot-conduct-policy';
import { isSpmtLocalLlmEnabled, requestSpmtLocalLlm } from '@/services/spmt-local-llm';

export type AIProvider = 'gemini' | 'edenai' | 'openai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_EDENAI_MODEL = 'google/gemini-2.5-flash';
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

async function generateEdenAIResponse(
  prompt: string,
  systemPrompt: string,
  config: AIConfig,
  options?: AIResponseOptions,
): Promise<string> {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options?.maxTokens ?? 200,
      temperature: options?.temperature ?? 0.7,
      stream: false,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data?.error?.message || data?.error || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`EdenAI request failed: ${detail}`);
  }

  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('EdenAI returned an empty response.');
  return text;
}
