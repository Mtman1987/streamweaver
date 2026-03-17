'use server';

export type TargetLanguage = 'es' | 'fr' | 'ru';

export interface TranslationResult {
  translatedText: string;
  targetLanguage: TargetLanguage;
  originalText: string;
  error?: string;
}

export interface DetectedLanguageResult {
  language: TargetLanguage | 'en' | null;
}

export async function translateToLanguage(text: string, targetLanguage: TargetLanguage | 'en'): Promise<TranslationResult> {
  const apiKey = process.env.EDENAI_API_KEY;
  
  if (!apiKey) {
    return {
      translatedText: text,
      targetLanguage: targetLanguage as TargetLanguage,
      originalText: text,
      error: 'Translation API not configured'
    };
  }

  const languageCodes: Record<TargetLanguage | 'en', string> = {
    'es': 'es',
    'fr': 'fr',
    'ru': 'ru',
    'en': 'en'
  };

  try {
    const response = await fetch('https://api.edenai.run/v2/translation/automatic_translation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        providers: 'google',
        text: text,
        source_language: 'auto-detect',
        target_language: languageCodes[targetLanguage]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Translation API failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const translatedText = data?.google?.text?.trim();
    
    if (!translatedText) {
      throw new Error('No translation result');
    }

    return {
      translatedText,
      targetLanguage: targetLanguage as TargetLanguage,
      originalText: text
    };
  } catch (error: any) {
    console.error('Translation error:', error);
    return {
      translatedText: text,
      targetLanguage: targetLanguage as TargetLanguage,
      originalText: text,
      error: error.message
    };
  }
}

export async function detectLanguage(text: string): Promise<DetectedLanguageResult> {
  const normalized = text.trim();
  if (!normalized) {
    return { language: null };
  }

  if (/[а-яё]/i.test(normalized)) {
    return { language: 'ru' };
  }

  if (/[ñ¡¿]/i.test(normalized)) {
    return { language: 'es' };
  }

  return { language: 'en' };
}
