import { readUserConfigSync } from '@/lib/user-config';
import { BOT_NO_SELF_PROMOTION_POLICY } from '@/lib/bot-conduct-policy';
import { isSpmtLocalLlmEnabled, requestSpmtLocalLlm } from '@/services/spmt-local-llm';

export type AIProvider = 'gemini' | 'edenai' | 'openai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_EDENAI_MODEL = 'google/gemini-2.5-flash';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  personalityName: string; // e.g., "Commander", "Boss", "Captain"
  botName: string; // e.g., "Athena", "StreamBot", "Assistant"
}

export interface AIResponseOptions {
  maxTokens?: number;
  temperature?: number;
}

export function getAIConfig(tenantId?: string): AIConfig {
  const config = readUserConfigSync(tenantId);

  // Keep the tenant's legacy provider configuration available for settings and
  // compatibility. Normal runtime generation now uses the owner-hosted SPMT
  // LLM first and EdenAI only as the fallback provider.
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

/**
 * Shared bot AI entry point.
 *
 * Provider order is intentionally global and tenant-neutral:
 *   1. owner-hosted SPMT Qwen worker over Fly private networking;
 *   2. EdenAI only when the local worker fails or is deliberately disabled.
 *
 * This keeps every StreamWeaver tenant on the same bot runtime without making
 * Athena, MountainView, Discord, or any other surface its own AI provider.
 */
export async function generateAIResponse(
  prompt: string,
  systemPrompt?: string,
  tenantId?: string,
  options?: AIResponseOptions,
): Promise<string> {
  const system = governedPrompt(systemPrompt);
  let localFailure = '';

  if (isSpmtLocalLlmEnabled()) {
    try {
      const local = await requestSpmtLocalLlm(prompt, system, options);
      console.log(`[AI Provider] SPMT local LLM served tenant ${tenantId || 'global'} with ${local.model}`);
      return local.text;
    } catch (error) {
      localFailure = error instanceof Error ? error.message : String(error);
      console.warn(`[AI Provider] SPMT local LLM failed for tenant ${tenantId || 'global'}; falling back to EdenAI:`, localFailure);
    }
  }

  try {
    return await generateEdenAIFallbackResponse(prompt, systemPrompt, tenantId, options);
  } catch (error) {
    const fallbackFailure = error instanceof Error ? error.message : String(error);
    throw new Error([
      'AI generation failed.',
      localFailure ? `Local LLM: ${localFailure}` : '',
      `EdenAI fallback: ${fallbackFailure}`,
    ].filter(Boolean).join(' '));
  }
}

/** EdenAI-only recovery path for callers that already attempted the local LLM. */
export async function generateEdenAIFallbackResponse(
  prompt: string,
  systemPrompt?: string,
  tenantId?: string,
  options?: AIResponseOptions,
): Promise<string> {
  const config = getEdenFallbackConfig(tenantId);
  if (!config.apiKey) {
    throw new Error('No EdenAI fallback API key is configured.');
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
