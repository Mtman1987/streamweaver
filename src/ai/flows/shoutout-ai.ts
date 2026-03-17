import { generateAIResponse, getAIConfig } from '@/services/ai-provider';

export async function generateShoutoutAI(input: { username: string; personality?: string }) {
  const aiConfig = getAIConfig();
  
  const promptText = `${input.personality || `You are ${aiConfig.botName}, a space-themed AI assistant.`}

Generate a shoutout for Twitch streamer ${input.username}. DO NOT include their URL in the message.

Requirements:
- NO emojis
- NO hashtags  
- Keep it space-themed
- Use the bot personality above
- Write 400-500 characters (about twice as long as usual)
- Be enthusiastic but follow the personality
- DO NOT include the URL in the response`;
  
  try {
    const text = await generateAIResponse(promptText);
    return { shoutout: text || 'AI response failed' };
  } catch (error) {
    console.error('Shoutout AI Error:', error);
    throw new Error('AI failed');
  }
}