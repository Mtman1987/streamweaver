'use server';

import { textToSpeech } from './text-to-speech';

import { getAIConfig } from '@/services/ai-provider';

// Copied from text-to-speech.ts to avoid 'use server' export error
const allVoices = [
    'Achernar', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 
    'Callirrhoe', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 
    'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima', 
    'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 
    'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'
];

export type ChatWithAthenaInput = {
  username: string;
  message: string;
  personality?: string;
  voice?: string;
};

export type ChatWithAthenaOutput = {
  audioDataUri: string;
};

export async function chatWithAthena(input: ChatWithAthenaInput): Promise<ChatWithAthenaOutput> {
  // This function is deprecated - use /api/ai/chat-with-memory instead
  throw new Error('This function is deprecated. Use /api/ai/chat-with-memory instead.');
}
