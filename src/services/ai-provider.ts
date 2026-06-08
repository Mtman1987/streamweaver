import { readUserConfigSync } from '@/lib/user-config';

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
  
  const provider = (config.AI_PROVIDER as AIProvider) || 'gemini';
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

export async function generateAIResponse(
  prompt: string,
  systemPrompt?: string,
  tenantId?: string,
  options?: AIResponseOptions
): Promise<string> {
  const config = getAIConfig(tenantId);
  
  if (!config.apiKey) {
    throw new Error(`No API key configured for ${config.provider}`);
  }
  
  switch (config.provider) {
    case 'gemini':
      return generateGeminiResponse(prompt, systemPrompt, config, options);
    case 'edenai':
      return generateEdenAIResponse(prompt, systemPrompt, config, options);
    case 'openai':
      return generateOpenAIResponse(prompt, systemPrompt, config, options);
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

async function generateGeminiResponse(
  prompt: string,
  systemPrompt: string = '',
  config: AIConfig,
  options?: AIResponseOptions
): Promise<string> {
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.8,
        maxOutputTokens: options?.maxTokens ?? 200,
      }
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('[Gemini] API Error:', response.status, JSON.stringify(data));
    return 'AI response failed';
  }
  
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('[Gemini] Unexpected response format:', JSON.stringify(data));
    return 'AI response failed';
  }
  
  return data.candidates[0].content.parts[0].text;
}

async function generateEdenAIResponse(
  prompt: string,
  systemPrompt: string = '',
  config: AIConfig,
  options?: AIResponseOptions
): Promise<string> {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  
  const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options?.maxTokens ?? 200,
      stream: false
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('[EdenAI] API Error:', response.status, JSON.stringify(data));
    return 'AI response failed';
  }
  
  if (!data.choices?.[0]?.message?.content) {
    console.error('[EdenAI] Unexpected response format:', JSON.stringify(data));
    return 'AI response failed';
  }
  
  return data.choices[0].message.content;
}

async function generateOpenAIResponse(
  prompt: string,
  systemPrompt: string = '',
  config: AIConfig,
  options?: AIResponseOptions
): Promise<string> {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options?.maxTokens ?? 200,
      temperature: options?.temperature ?? 0.7,
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('[OpenAI] API Error:', response.status, JSON.stringify(data));
    return 'AI response failed';
  }
  
  if (!data.choices?.[0]?.message?.content) {
    console.error('[OpenAI] Unexpected response format:', JSON.stringify(data));
    return 'AI response failed';
  }
  
  return data.choices[0].message.content;
}
