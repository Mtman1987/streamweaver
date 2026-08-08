import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { tenantPath } from '@/lib/tenant';

export type AdultModeAction = 'on' | 'off' | 'toggle' | 'status';

export const SPMT_PRIVATE_QWEN_BASE_URL = 'http://spmt-llm-worker.internal:8080/v1';
export const SPMT_PRIVATE_QWEN_MODEL = 'spmt-qwen3-4b';

export type PrivateChatSettings = {
  adultMode: boolean;
};

export type PublicPrivateChatSettings = PrivateChatSettings & {
  qwenProvider: 'spmt-qwen';
  qwenModel: string;
  qwenTransport: 'fly-private-network';
  qwenReady: true;
};

const defaults: PrivateChatSettings = {
  adultMode: false,
};

function filePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/private-chat-settings.json');
  return resolve(process.cwd(), 'data', 'private-chat-settings.json');
}

function sanitize(input: Partial<PrivateChatSettings> & Record<string, unknown>): PrivateChatSettings {
  // Older files may contain qwenBaseUrl/qwenModel from the temporary configurable
  // endpoint design. Ignore those fields: private DMs always use the existing
  // SPMT Qwen worker and model.
  return {
    adultMode: input.adultMode === true,
  };
}

export function getDefaultPrivateChatSettings(): PrivateChatSettings {
  return { ...defaults };
}

export function getEffectiveQwenBaseUrl(_settings?: PrivateChatSettings): string {
  return SPMT_PRIVATE_QWEN_BASE_URL;
}

export function getEffectiveQwenModel(_settings?: PrivateChatSettings): string {
  return SPMT_PRIVATE_QWEN_MODEL;
}

export function toPublicPrivateChatSettings(settings: PrivateChatSettings): PublicPrivateChatSettings {
  return {
    ...settings,
    qwenProvider: 'spmt-qwen',
    qwenModel: SPMT_PRIVATE_QWEN_MODEL,
    qwenTransport: 'fly-private-network',
    qwenReady: true,
  };
}

export async function readPrivateChatSettings(tenantId?: string): Promise<PrivateChatSettings> {
  try {
    const raw = await fs.readFile(filePath(tenantId), 'utf8');
    return sanitize(JSON.parse(raw));
  } catch {
    return getDefaultPrivateChatSettings();
  }
}

export async function writePrivateChatSettings(
  patch: Partial<PrivateChatSettings>,
  tenantId?: string,
): Promise<PrivateChatSettings> {
  const current = await readPrivateChatSettings(tenantId);
  const next = sanitize({ ...current, ...patch });
  const target = filePath(tenantId);
  const temporary = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseAdultModeCommand(message: string, botName = ''): AdultModeAction | null {
  let normalized = String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ');

  if (botName.trim()) {
    normalized = normalized.replace(
      new RegExp(`^@?${escapeRegExp(botName.trim().toLowerCase())}(?:\\s*[:,.-]\\s*|\\s+)`),
      '',
    );
  }

  normalized = normalized
    .replace(/^@?spmt(?:\s+|\s*[:,.-]\s*)/, '')
    .replace(/^!+/, '')
    .trim();

  const match = normalized.match(
    /^(?:adult|adult mode|mature|mature mode)(?:\s+(on|off|toggle|status))?[.!?]*$/,
  );
  if (!match) return null;
  return (match[1] as AdultModeAction | undefined) || 'toggle';
}

export function applyAdultModeAction(current: boolean, action: AdultModeAction): boolean {
  if (action === 'on') return true;
  if (action === 'off') return false;
  if (action === 'toggle') return !current;
  return current;
}
