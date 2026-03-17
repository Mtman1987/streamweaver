import { readUserConfigSync } from '@/lib/user-config';

export type AIProvider = 'gemini' | 'edenai' | 'openai';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  personalityName: string; // e.g., "Commander", "Boss", "Captain"
  botName: string; // e.g., "Athena", "StreamBot", "Assistant"
}

export function getAIConfig(): AIConfig {
  const config = readUserConfigSync();
  
  const provider = (config.AI_PROVIDER as AIProvider) || 'gemini';
  const personalityName = config.AI_PERSONALITY_NAME || 'Commander';
  const botName = config.AI_BOT_NAME || 'AI Bot';
  
  let apiKey = '';
  let model = '';
  
  switch (provider) {
    case 'gemini':
      apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
      model = config.AI_MODEL || 'gemini-2.0-flash';
      break;
    case 'edenai':
      apiKey = config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
      model = config.AI_MODEL || 'openai/gpt-4o-mini';
      break;
    case 'openai':
      apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
      model = config.AI_MODEL || 'gpt-4o-mini';
      break;
  }
  
  return { provider, model, apiKey, personalityName, botName };
}

export async function generateAIResponse(prompt: string, systemPrompt?: string): Promise<string> {
  const config = getAIConfig();
  
  if (!config.apiKey) {
    throw new Error(`No API key configured for ${config.provider}`);
  }
  
  switch (config.provider) {
    case 'gemini':
      return generateGeminiResponse(prompt, systemPrompt, config);
    case 'edenai':
      return generateEdenAIResponse(prompt, systemPrompt, config);
    case 'openai':
      return generateOpenAIResponse(prompt, systemPrompt, config);
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

async function generateGeminiResponse(prompt: string, systemPrompt: string = '', config: AIConfig): Promise<string> {
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 200 }
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

async function generateEdenAIResponse(prompt: string, systemPrompt: string = '', config: AIConfig): Promise<string> {
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
      max_tokens: 200,
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

async function generateOpenAIResponse(prompt: string, systemPrompt: string = '', config: AIConfig): Promise<string> {
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
      max_tokens: 200
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
