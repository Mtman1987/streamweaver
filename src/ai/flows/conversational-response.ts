
'use server';

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ConversationalResponseInput {
  message: string;
  personality?: string;
}

export interface ConversationalResponseOutput {
  response: string;
}

export async function conversationalResponse(input: ConversationalResponseInput): Promise<ConversationalResponseOutput> {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const systemPrompt = input.personality 
      ? `You are an AI assistant with the following personality:\n${input.personality}`
      : 'You are a helpful AI assistant for a streamer. Your name is StreamWeave.';
    
    const prompt = `${systemPrompt}\n\nProvide a concise, friendly, and conversational response to the following message from the streamer.\n\nUser Message:\n"${input.message}"`;
    
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    return { response };
  } catch (error) {
    console.error('Failed to generate conversational response:', error);
    return { response: 'Sorry, I had trouble processing that message.' };
  }
}

export async function conversationalResponseFlow(input: ConversationalResponseInput): Promise<ConversationalResponseOutput> {
  return await conversationalResponse(input);
}
