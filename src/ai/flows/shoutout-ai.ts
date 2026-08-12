import { generateAIResponse, getAIConfig } from '@/services/ai-provider';

export async function generateShoutoutAI(input: { username: string; personality?: string; tenantId?: string }) {
  const aiConfig = getAIConfig(input.tenantId);
  const systemPrompt = input.personality || `You are ${aiConfig.botName}, a space-themed AI assistant.`;
  const promptText = [
    `Generate a short shoutout for Twitch streamer ${input.username}. Do not include their URL in the message.`,
    '',
    'Requirements:',
    '- NO emojis',
    '- NO hashtags',
    '- Keep it space-themed only when that fits the configured bot personality',
    '- Use the bot personality above',
    '- Keep it to 1-2 sentences',
    '- Be enthusiastic but follow the personality',
    '- DO NOT include the URL in the response',
  ].join('\n');

  try {
    const text = await generateAIResponse(
      promptText,
      systemPrompt,
      input.tenantId,
      { maxTokens: 180, temperature: 0.7 },
    );
    return { shoutout: text.trim() || 'AI response failed' };
  } catch (error) {
    console.error('Shoutout AI Error:', error);
    throw new Error('AI failed');
  }
}
