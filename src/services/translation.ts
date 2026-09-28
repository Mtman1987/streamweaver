'use server';

import { generateAIResponse } from './ai-provider';

export type TargetLanguage = 'es' | 'fr' | 'ru' | 'de' | 'ja';

export interface TranslationResult {
  translatedText: string;
  targetLanguage: TargetLanguage;
  originalText: string;
  error?: string;
}

export interface DetectedLanguageResult {
  language: TargetLanguage | 'en' | null;
}

const LANGUAGE_NAMES: Record<TargetLanguage | 'en', string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  ru: 'Russian',
  de: 'German',
  ja: 'Japanese',
};

function cleanTranslation(value: string): string {
  return String(value || '')
    .replace(/^\s*```(?:text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\s*(?:translation|translated text|english|spanish|french|russian|german|japanese)\s*:\s*/i, '')
    .trim();
}

export async function translateToLanguage(
  text: string,
  targetLanguage: TargetLanguage | 'en',
  tenantId?: string,
): Promise<TranslationResult> {
  const originalText = String(text || '').trim();
  if (!originalText) {
    return {
      translatedText: '',
      targetLanguage: targetLanguage as TargetLanguage,
      originalText,
      error: 'No text to translate',
    };
  }

  const targetName = LANGUAGE_NAMES[targetLanguage];
  try {
    const translatedText = cleanTranslation(await generateAIResponse(
      [
        `Translate the following public chat message into ${targetName}.`,
        'Return only the translated message. Do not explain, label, quote, censor, or answer it.',
        'Preserve usernames, @mentions, URLs, emoji, emotes, punctuation, and proper names unless normal grammar requires otherwise.',
        'If the message is already in the target language, return it unchanged.',
        `Message: ${JSON.stringify(originalText)}`,
      ].join('\n'),
      'You are Stella\'s translation engine. Translate faithfully and output only the requested translation.',
      tenantId,
      { maxTokens: 300, maxCharacters: 2400, temperature: 0.1 },
    ));

    if (!translatedText) throw new Error('Translation provider returned an empty response');

    return {
      translatedText,
      targetLanguage: targetLanguage as TargetLanguage,
      originalText,
    };
  } catch (error: any) {
    console.error('[Translation] Provider fallback failed:', error);
    return {
      translatedText: originalText,
      targetLanguage: targetLanguage as TargetLanguage,
      originalText,
      error: error?.message || String(error),
    };
  }
}

export async function detectLanguage(text: string): Promise<DetectedLanguageResult> {
  const normalized = text.trim();
  if (!normalized) return { language: null };

  if (/[а-яё]/i.test(normalized)) return { language: 'ru' };
  if (/[ñ¡¿]/i.test(normalized)) return { language: 'es' };

  return { language: 'en' };
}
