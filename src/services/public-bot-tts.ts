import { mkdir, readFile, writeFile } from 'fs/promises';

export const PUBLIC_BOT_TTS_FILE_PATH = 'data/runtime/public-bot-tts.json';

type PublicBotTtsState = Record<string, boolean>;

function stateKey(channelId: unknown, tenantId: unknown): string {
  const channel = String(channelId || '').trim();
  const tenant = String(tenantId || '').trim();
  return channel && tenant ? `${channel}:${tenant}` : '';
}

async function readState(): Promise<PublicBotTtsState> {
  try {
    const parsed = JSON.parse(await readFile(PUBLIC_BOT_TTS_FILE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const state: PublicBotTtsState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key && value === true) state[key] = true;
    }
    return state;
  } catch {
    return {};
  }
}

async function writeState(state: PublicBotTtsState): Promise<void> {
  await mkdir('data/runtime', { recursive: true });
  await writeFile(PUBLIC_BOT_TTS_FILE_PATH, JSON.stringify(state, null, 2));
}

export async function getPublicBotTtsEnabled(channelId: unknown, tenantId: unknown): Promise<boolean> {
  const key = stateKey(channelId, tenantId);
  if (!key) return false;
  return (await readState())[key] === true;
}

export async function setPublicBotTtsEnabled(channelId: unknown, tenantId: unknown, enabled: boolean): Promise<boolean> {
  const key = stateKey(channelId, tenantId);
  if (!key) throw new Error('Public bot TTS requires a Discord channel and bot tenant');
  const state = await readState();
  if (enabled) state[key] = true;
  else delete state[key];
  await writeState(state);
  return enabled;
}

export async function togglePublicBotTtsEnabled(channelId: unknown, tenantId: unknown): Promise<boolean> {
  const enabled = !await getPublicBotTtsEnabled(channelId, tenantId);
  return setPublicBotTtsEnabled(channelId, tenantId, enabled);
}
