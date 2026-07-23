import { generateTTS } from '@/services/tts-provider';

export type TextToSpeechInput = {
  text: string;
  voice?: string;
  tenantId?: string;
};

export type TextToSpeechOutput = {
  audioDataUri: string;
};

export async function textToSpeech(input: TextToSpeechInput): Promise<TextToSpeechOutput> {
  try {
    const processedText = input.text.replace(/\bMt\./g, 'M.T.');
    const audioDataUri = await generateTTS(processedText, input.voice, input.tenantId, {
      requireActiveConsumer: true,
    });
    return { audioDataUri };
  } catch (error) {
    console.error('TTS error:', error);
    throw error;
  }
}

export const textToSpeechFlow = textToSpeech;
