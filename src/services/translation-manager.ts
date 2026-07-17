import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { detectLanguage, translateToLanguage, type TargetLanguage } from './translation';

type TranslationState = {
  translationModeActive: boolean;
  detectedLanguage: TargetLanguage | null;
  autoTranslateUsers: Set<string>;
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
      autoTranslateUsers: new Set<string>(),
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
      state.autoTranslateUsers = new Set(
        users.map((user) => String(user || '').trim().toLowerCase()).filter(Boolean),
      );
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
  await fs.writeFile(tempPath, JSON.stringify({ users: Array.from(state.autoTranslateUsers).sort() }, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
}

export async function addUserToAutoTranslate(username: string, tenantId: string): Promise<void> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);
  state.autoTranslateUsers.add(username.toLowerCase());
  await saveAutoTranslateUsers(tenantId);
  console.log(`[TranslationManager] Auto-translate enabled for ${username} in tenant ${tenantId}`);
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

export async function autoTranslateIncoming(message: string, username: string | undefined, tenantId: string): Promise<string | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);

  if (username && state.autoTranslateUsers.has(username.toLowerCase())) {
    const result = await translateToLanguage(message, 'en');
    if (!result.error) return result.translatedText;
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

export async function handleOneOffTranslation(args: string[], tenantId: string): Promise<string | null> {
  await loadAutoTranslateUsers(tenantId);
  const state = stateFor(tenantId);

  if (args.length === 1 && args[0].startsWith('@')) {
    const username = args[0].substring(1);
    if (state.autoTranslateUsers.has(username.toLowerCase())) {
      await removeUserFromAutoTranslate(username, tenantId);
      return `Auto-translate disabled for @${username}`;
    }

    await addUserToAutoTranslate(username, tenantId);
    return `Auto-translate enabled for @${username} - their messages will be translated to English`;
  }

  if (args.length < 2) return null;

  const lang = args[0].toLowerCase();
  if (!['es', 'fr', 'ru', 'en'].includes(lang)) return null;

  const text = args.slice(1).join(' ');
  const result = await translateToLanguage(text, lang as TargetLanguage);
  return result.error ? null : result.translatedText;
}

export function clearTranslationStateForTests(): void {
  states.clear();
  loadPromises.clear();
}
