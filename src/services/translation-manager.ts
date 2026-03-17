import { detectLanguage, translateToLanguage, type TargetLanguage } from './translation';
import { readJsonFile, writeJsonFile } from './storage';

let translationModeActive = false;
let detectedLanguage: TargetLanguage | null = null;
const autoTranslateUsers = new Set<string>();
const AUTO_TRANSLATE_FILE = 'auto-translate-users.json';

async function loadAutoTranslateUsers(): Promise<void> {
  const data = await readJsonFile<{ users: string[] }>(AUTO_TRANSLATE_FILE, { users: [] });
  data.users.forEach(u => autoTranslateUsers.add(u.toLowerCase()));
  console.log('[TranslationManager] Loaded', autoTranslateUsers.size, 'auto-translate users');
}

async function saveAutoTranslateUsers(): Promise<void> {
  await writeJsonFile(AUTO_TRANSLATE_FILE, { users: Array.from(autoTranslateUsers) });
}

loadAutoTranslateUsers();

export function addUserToAutoTranslate(username: string): void {
  autoTranslateUsers.add(username.toLowerCase());
  saveAutoTranslateUsers();
  console.log('[TranslationManager] Auto-translate enabled for:', username);
}

export function removeUserFromAutoTranslate(username: string): void {
  autoTranslateUsers.delete(username.toLowerCase());
  saveAutoTranslateUsers();
  console.log('[TranslationManager] Auto-translate disabled for:', username);
}

export function isUserAutoTranslate(username: string): boolean {
  return autoTranslateUsers.has(username.toLowerCase());
}

export function getAutoTranslateUsers(): string[] {
  return Array.from(autoTranslateUsers);
}

export function setTranslationMode(active: boolean): void {
  translationModeActive = active;
  if (!active) {
    detectedLanguage = null;
  }
  console.log('[TranslationManager] Translation mode:', active ? 'ON' : 'OFF');
}

export function isTranslationActive(): boolean {
  return translationModeActive;
}

export function getDetectedLanguage(): TargetLanguage | null {
  return detectedLanguage;
}

export function setDetectedLanguage(lang: TargetLanguage | null): void {
  detectedLanguage = lang;
  console.log('[TranslationManager] Detected language set to:', lang);
}

export async function autoTranslateIncoming(message: string, username?: string): Promise<string | null> {
  // Check if this specific user should be auto-translated
  if (username && autoTranslateUsers.has(username.toLowerCase())) {
    // Detect language and translate to English
    const result = await translateToLanguage(message, 'en');
    if (!result.error) {
      return result.translatedText;
    }
  }
  
  if (!translationModeActive) return null;
  
  const detected = await detectLanguage(message);
  if (detected.language && detected.language !== 'en') {
    if (!detectedLanguage) {
      detectedLanguage = detected.language as TargetLanguage;
      console.log('[TranslationManager] Auto-detected language:', detected.language);
    }
    
    const result = await translateToLanguage(message, 'en');
    if (!result.error) {
      return result.translatedText;
    }
  }
  
  return null;
}

export async function handleOneOffTranslation(args: string[]): Promise<string | null> {
  // !t @username - toggle auto-translate for user
  if (args.length === 1 && args[0].startsWith('@')) {
    const username = args[0].substring(1);
    if (autoTranslateUsers.has(username.toLowerCase())) {
      removeUserFromAutoTranslate(username);
      return `Auto-translate disabled for @${username}`;
    } else {
      addUserToAutoTranslate(username);
      return `Auto-translate enabled for @${username} - their messages will be translated to English`;
    }
  }
  
  // !t es Hello world → translates to Spanish
  if (args.length < 2) return null;
  
  const lang = args[0].toLowerCase();
  if (!['es', 'fr', 'ru', 'en'].includes(lang)) return null;
  
  const text = args.slice(1).join(' ');
  const result = await translateToLanguage(text, lang as TargetLanguage);
  
  return result.error ? null : result.translatedText;
}
