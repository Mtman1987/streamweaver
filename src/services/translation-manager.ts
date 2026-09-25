import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { detectLanguage, translateToLanguage, type TargetLanguage } from './translation';

type TranslationLanguage = TargetLanguage | 'en';

type TranslationState = {
  translationModeActive: boolean;
  detectedLanguage: TargetLanguage | null;
  autoTranslateUsers: Map<string, TranslationLanguage>;
  loaded: boolean;
};

const AUTO_TRANSLATE_FILE = 'data/auto-translate-users.json';
const states = new Map<string, TranslationState>();
const loadPromises = new Map<string, Promise<void>>();

function requireTenantId(tenantId: string): string {
  const normalized = String(tenantId || '').trim();
  if (!normalized) throw new Error('Translation state requires tenant context');
  return normalized;
}

function stateFor(tenantId: string): TranslationState {
  const key = requireTenantId(tenantId);
  let state = states.get(key);
  if (!state) {
    state = {
      translationModeActive: false,
      detectedLanguage: null,
      autoTranslateUsers: new Map<string, TranslationLanguage>(),
      loaded: false,
    };
    states.set(key, state);
  }
  return state;
}

function autoTranslatePath(tenantId: string): string {
  return tenantPath(requireTenantId(tenantId), AUTO_TRANSLATE_FILE);
}

async function loadAutoTranslateUsers(tenantId: string): Promise<void> {
  const key = requireTenantId(tenantId);
  const state = stateFor(key);
  if (state.loaded) return;

  const pending = loadPromises.get(key);
  if (pending) return pending;

  const load = (async () => {
    try {
      const raw = await fs.readFile(autoTranslatePath(key), 'utf-8');
      const parsed = JSON.parse(raw) as { users?: unknown };
      const users = Array.isArray(parsed.users) ? parsed.users : [];
      const entries = users.map((entry: any) => {
        if (typeof entry === 'string') return [entry.trim().toLowerCase(), 'en'] as const;
        const username = String(entry?.username || entry?.user || '').trim().toLowerCase();
        const language = normalizeLanguage(entry?.language || entry?.targetLanguage || 'en');
        return username ? [username, language] as const : null;
      }).filter(Boolean) as Array<readonly [string, TranslationLanguage]>;
      state.autoTranslateUsers = new Map(entries);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    state.loaded = true;
    console.log(`[TranslationManager] Loaded ${state.autoTranslateUsers.size} auto-translate users for tenant ${key}`);
  })().finally(() => loadPromises.delete(key));

  loadPromises.set(key, load);
  return load;
}

async function saveAutoTranslateUsers(tenantId: string): Promise<void> {
  const key = requireTenantId(tenantId);
  const state = stateFor(key);
  const filePath = autoTranslatePath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const users = Array.from(state.autoTranslateUsers.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([username, language]) => ({ username, language }));
  await fs.writeFile(tempPath, JSON.stringify({ users }, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
}

export async function addUserToAutoTranslate(username: string, tenantId: string, language: TranslationLanguage = 'en'): Promise<void> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const targetLanguage = normalizeLanguage(language);
  state.autoTranslateUsers.set(username.toLowerCase(), targetLanguage);
  await saveAutoTranslateUsers(tenantId);
  console.log(`[TranslationManager] Auto-translate enabled for ${username} → ${targetLanguage} in tenant ${tenantId}`);
}

export async function removeUserFromAutoTranslate(username: string, tenantId: string): Promise<void> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  state.autoTranslateUsers.delete(username.toLowerCase());
  await saveAutoTranslateUsers(tenantId);
  console.log(`[TranslationManager] Auto-translate disabled for ${username} in tenant ${tenantId}`);
}

export async function isUserAutoTranslate(username: string, tenantId: string): Promise<boolean> {
  await loadAutoTranslateUsers(tenantId);
  return stateFor(tenantId).autoTranslateUsers.has(username.toLowerCase());
}

export async function getAutoTranslateUsers(tenantId: string): Promise<string[]> {
  await loadAutoTranslateUsers(tenantId);
  return Array.from(stateFor(tenantId).autoTranslateUsers.keys());
}

export function setTranslationMode(active: boolean, tenantId: string): void {
  const state = stateFor(tenantId);
  state.translationModeActive = active;
  if (!active) state.detectedLanguage = null;
  console.log(`[TranslationManager] Translation mode for tenant ${tenantId}: ${active ? 'ON' : 'OFF'}`);
}

export function isTranslationActive(tenantId: string): boolean {
  return stateFor(tenantId).translationModeActive;
}

export function getDetectedLanguage(tenantId: string): TargetLanguage | null {
  return stateFor(tenantId).detectedLanguage;
}

export function setDetectedLanguage(lang: TargetLanguage | null, tenantId: string): void {
  stateFor(tenantId).detectedLanguage = lang;
  console.log(`[TranslationManager] Detected language for tenant ${tenantId}: ${lang || 'none'}`);
}

export async function autoTranslateIncoming(message: string, username: string | undefined, tenantId: string): Promise<string | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);

  if (username && state.autoTranslateUsers.has(username.toLowerCase())) {
    const targetLanguage = state.autoTranslateUsers.get(username.toLowerCase()) || 'en';
    const detected = await detectLanguage(message);
    if (detected.language === targetLanguage) return null;
    const result = await translateToLanguage(message, targetLanguage);
    if (!result.error && result.translatedText.trim() && result.translatedText.trim() !== message.trim()) return result.translatedText;
    return null;
  }

  if (!state.translationModeActive) return null;

  const detected = await detectLanguage(message);
  if (detected.language && detected.language !== 'en') {
    if (!state.detectedLanguage) {
      state.detectedLanguage = detected.language as TargetLanguage;
      console.log(`[TranslationManager] Auto-detected ${detected.language} for tenant ${tenantId}`);
    }

    const result = await translateToLanguage(message, 'en');
    if (!result.error) return result.translatedText;
  }

  return null;
}

export async function getAutoTranslateLanguage(username: string, tenantId: string): Promise<TranslationLanguage | null> {
  await loadAutoTranslateUsers(tenantId);
  return stateFor(tenantId).autoTranslateUsers.get(username.toLowerCase()) || null;
}

export async function handleOneOffTranslation(
  args: string[],
  tenantId: string,
  options: { actorUsername?: string; canManageOthers?: boolean } = {},
): Promise<string | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const cleanArgs = args.map((value) => String(value || '').trim()).filter(Boolean);
  if (!cleanArgs.length) return 'Usage: !t es hello | !t hello | !t @user en | !t @user off';

  if (cleanArgs[0].startsWith('@')) {
    const username = cleanArgs[0].substring(1).trim().toLowerCase();
    if (!username) return 'Usage: !t @user en | !t @user off';
    const actor = String(options.actorUsername || '').trim().toLowerCase();
    const managingSelf = actor && actor === username;
    if (!managingSelf && options.canManageOthers !== true) {
      return 'Only the streamer or a moderator can set auto-translation for someone else.';
    }

    const mode = String(cleanArgs[1] || '').toLowerCase();
    if (['off', 'stop', 'none'].includes(mode)) {
      await removeUserFromAutoTranslate(username, tenantId);
      return `Stella auto-translation is off for @${username}.`;
    }

    const targetLanguage = normalizeLanguage(mode || 'en');
    await addUserToAutoTranslate(username, tenantId, targetLanguage);
    return `Stella will auto-translate @${username} into ${languageName(targetLanguage)}. Use !t @${username} off to stop.`;
  }

  let targetLanguage: TranslationLanguage = 'en';
  let textArgs = cleanArgs;
  if (isLanguageCode(cleanArgs[0])) {
    targetLanguage = normalizeLanguage(cleanArgs[0]);
    textArgs = cleanArgs.slice(1);
  }
  const text = textArgs.join(' ').trim();
  if (!text) return 'Usage: !t es hello | !t hello | !t @user en | !t @user off';
  const result = await translateToLanguage(text, targetLanguage);
  return result.error ? null : result.translatedText;
}

function isLanguageCode(value: unknown): boolean {
  return ['en', 'es', 'fr', 'ru', 'de', 'ja'].includes(String(value || '').trim().toLowerCase());
}

function normalizeLanguage(value: unknown): TranslationLanguage {
  const code = String(value || '').trim().toLowerCase();
  return isLanguageCode(code) ? code as TranslationLanguage : 'en';
}

function languageName(language: TranslationLanguage): string {
  return ({ en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian', de: 'German', ja: 'Japanese' } as const)[language];
}

export function clearTranslationStateForTests(): void {
  states.clear();
  loadPromises.clear();
}
