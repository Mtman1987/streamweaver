import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { detectLanguage, translateToLanguage, type TargetLanguage } from './translation';

export type TranslationLanguage = TargetLanguage | 'en';

type TranslationState = {
  translationModeActive: boolean;
  detectedLanguage: TargetLanguage | null;
  autoTranslateUsers: Set<string>;
  autoTranslateTargets: Map<string, TranslationLanguage>;
  loaded: boolean;
};

type TranslationCommandOptions = {
  requesterUsername?: string;
  canManageOthers?: boolean;
};

export type AutoTranslationResult = {
  translatedText: string;
  targetLanguage: TranslationLanguage;
};

const AUTO_TRANSLATE_FILE = 'data/auto-translate-users.json';
const SUPPORTED_LANGUAGES = new Set<TranslationLanguage>(['en', 'es', 'fr', 'ru', 'de', 'ja']);
const LANGUAGE_NAMES: Record<TranslationLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  ru: 'Russian',
  de: 'German',
  ja: 'Japanese',
};
const states = new Map<string, TranslationState>();
const loadPromises = new Map<string, Promise<void>>();

function requireTenantId(tenantId: string): string {
  const normalized = String(tenantId || '').trim();
  if (!normalized) throw new Error('Translation state requires tenant context');
  return normalized;
}

function normalizeUser(value: string): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function parseLanguage(value: string | undefined): TranslationLanguage | null {
  const normalized = String(value || '').trim().toLowerCase() as TranslationLanguage;
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : null;
}

function languageName(value: TranslationLanguage): string {
  return LANGUAGE_NAMES[value] || value.toUpperCase();
}

function stateFor(tenantId: string): TranslationState {
  const key = requireTenantId(tenantId);
  let state = states.get(key);
  if (!state) {
    state = {
      translationModeActive: false,
      detectedLanguage: null,
      autoTranslateUsers: new Set<string>(),
      autoTranslateTargets: new Map<string, TranslationLanguage>(),
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
      const parsed = JSON.parse(raw) as { users?: unknown; targets?: unknown };
      const users = Array.isArray(parsed.users) ? parsed.users : [];
      state.autoTranslateUsers = new Set(
        users.map((user) => normalizeUser(String(user || ''))).filter(Boolean),
      );
      const targets = parsed.targets && typeof parsed.targets === 'object' && !Array.isArray(parsed.targets)
        ? parsed.targets as Record<string, unknown>
        : {};
      state.autoTranslateTargets = new Map();
      for (const username of state.autoTranslateUsers) {
        state.autoTranslateTargets.set(username, parseLanguage(String(targets[username] || 'en')) || 'en');
      }
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
  const users = Array.from(state.autoTranslateUsers).sort();
  const targets = Object.fromEntries(users.map((username) => [
    username,
    state.autoTranslateTargets.get(username) || 'en',
  ]));
  await fs.writeFile(tempPath, JSON.stringify({ users, targets }, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
}

export async function addUserToAutoTranslate(
  username: string,
  tenantId: string,
  targetLanguage: TranslationLanguage = 'en',
): Promise<void> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const normalizedUser = normalizeUser(username);
  if (!normalizedUser) throw new Error('A username is required');
  const language = parseLanguage(targetLanguage) || 'en';
  state.autoTranslateUsers.add(normalizedUser);
  state.autoTranslateTargets.set(normalizedUser, language);
  await saveAutoTranslateUsers(tenantId);
  console.log(`[TranslationManager] Auto-translate enabled for ${normalizedUser} -> ${language} in tenant ${tenantId}`);
}

export async function removeUserFromAutoTranslate(username: string, tenantId: string): Promise<void> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const normalizedUser = normalizeUser(username);
  state.autoTranslateUsers.delete(normalizedUser);
  state.autoTranslateTargets.delete(normalizedUser);
  await saveAutoTranslateUsers(tenantId);
  console.log(`[TranslationManager] Auto-translate disabled for ${normalizedUser} in tenant ${tenantId}`);
}

export async function isUserAutoTranslate(username: string, tenantId: string): Promise<boolean> {
  await loadAutoTranslateUsers(tenantId);
  return stateFor(tenantId).autoTranslateUsers.has(normalizeUser(username));
}

export async function getAutoTranslateTarget(
  username: string,
  tenantId: string,
): Promise<TranslationLanguage | null> {
  await loadAutoTranslateUsers(tenantId);
  const normalizedUser = normalizeUser(username);
  const state = stateFor(tenantId);
  if (!state.autoTranslateUsers.has(normalizedUser)) return null;
  return state.autoTranslateTargets.get(normalizedUser) || 'en';
}

export async function getAutoTranslateUsers(tenantId: string): Promise<string[]> {
  await loadAutoTranslateUsers(tenantId);
  return Array.from(stateFor(tenantId).autoTranslateUsers);
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

function sameText(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(left) === normalize(right);
}

export async function autoTranslateIncoming(
  message: string,
  username: string | undefined,
  tenantId: string,
): Promise<AutoTranslationResult | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const normalizedUser = normalizeUser(username || '');

  if (normalizedUser && state.autoTranslateUsers.has(normalizedUser)) {
    const targetLanguage = state.autoTranslateTargets.get(normalizedUser) || 'en';
    const result = await translateToLanguage(message, targetLanguage);
    if (!result.error && result.translatedText && !sameText(message, result.translatedText)) {
      return { translatedText: result.translatedText, targetLanguage };
    }
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
    if (!result.error && result.translatedText && !sameText(message, result.translatedText)) {
      return { translatedText: result.translatedText, targetLanguage: 'en' };
    }
  }

  return null;
}

export async function handleOneOffTranslation(
  args: string[],
  tenantId: string,
  options: TranslationCommandOptions = {},
): Promise<string | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  const parts = args.map((value) => String(value || '').trim()).filter(Boolean);
  if (!parts.length) {
    return 'Translation: !t es hello | !t hello | !t @user en | !t @user off';
  }

  if (parts[0].startsWith('@')) {
    const username = normalizeUser(parts[0]);
    const requester = normalizeUser(options.requesterUsername || '');
    const canManage = Boolean(options.canManageOthers) || Boolean(requester && requester === username);
    if (!canManage) {
      return 'Only the streamer or a moderator can set auto-translation for someone else. You can always set your own.';
    }

    const mode = String(parts[1] || '').toLowerCase();
    if (['off', 'stop', 'none'].includes(mode)) {
      await removeUserFromAutoTranslate(username, tenantId);
      return `Stella auto-translation is off for @${username}.`;
    }

    // Backward compatibility: !t @user toggles English mode.
    if (!mode) {
      if (state.autoTranslateUsers.has(username)) {
        await removeUserFromAutoTranslate(username, tenantId);
        return `Stella auto-translation is off for @${username}.`;
      }
      await addUserToAutoTranslate(username, tenantId, 'en');
      return `Stella will auto-translate @${username} into English. Use !t @${username} off to stop.`;
    }

    const targetLanguage = parseLanguage(mode);
    if (!targetLanguage) {
      return 'Supported translation languages: en, es, fr, ru, de, ja.';
    }
    await addUserToAutoTranslate(username, tenantId, targetLanguage);
    return `Stella will auto-translate @${username} into ${languageName(targetLanguage)}. Use !t @${username} off to stop.`;
  }

  let targetLanguage: TranslationLanguage = 'en';
  let textParts = parts;
  const explicitLanguage = parseLanguage(parts[0]);
  if (explicitLanguage && parts.length > 1) {
    targetLanguage = explicitLanguage;
    textParts = parts.slice(1);
  }
  const text = textParts.join(' ').trim();
  if (!text) return 'Translation: !t es hello | !t hello | !t @user en | !t @user off';

  const result = await translateToLanguage(text, targetLanguage);
  return result.error ? null : result.translatedText;
}

export function clearTranslationStateForTests(): void {
  states.clear();
  loadPromises.clear();
}
