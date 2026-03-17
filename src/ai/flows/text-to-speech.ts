import { generateTTS } from '@/services/tts-provider';

export type TextToSpeechInput = {
  text: string;
  voice?: string; // Ignored - uses user config
};

export type TextToSpeechOutput = {
  audioDataUri: string;
};

export async function textToSpeech(input: TextToSpeechInput): Promise<TextToSpeechOutput> {
  try {
    // Preprocess text for better pronunciation
    const processedText = input.text.replace(/\bMt\./g, 'M.T.');
    const audioDataUri = await generateTTS(processedText);
    return { audioDataUri };
  } catch (error) {
    console.error('TTS error:', error);
    throw error;
  }
}

export const textToSpeechFlow = textToSpeech;
