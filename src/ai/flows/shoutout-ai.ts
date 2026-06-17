import { getAIConfig } from '@/services/ai-provider';

export async function generateShoutoutAI(input: { username: string; personality?: string; tenantId?: string }) {
  const aiConfig = getAIConfig(input.tenantId);
  const edenaiKey = aiConfig.provider === 'edenai'
    ? aiConfig.apiKey
    : process.env.EDENAI_API_KEY || '';
  
  if (!edenaiKey) {
    throw new Error('EDENAI_API_KEY is not configured');
  }

  const promptText = `${input.personality || `You are ${aiConfig.botName}, a space-themed AI assistant.`}

Generate a short shoutout for Twitch streamer ${input.username}. Do not include their URL in the message.

Requirements:
- NO emojis
- NO hashtags  
- Keep it space-themed
- Use the bot personality above
- Keep it to 1-2 sentences
- Be enthusiastic but follow the personality
- DO NOT include the URL in the response`;
  
  try {
    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: input.personality || `You are ${aiConfig.botName}, a space-themed AI assistant.` },
          { role: 'user', content: promptText },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.error('[Shoutout AI] EdenAI error:', response.status, details);
      throw new Error('AI failed');
    }

    const data = await response.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    return { shoutout: text || 'AI response failed' };
  } catch (error) {
    console.error('Shoutout AI Error:', error);
    throw new Error('AI failed');
  }
}
