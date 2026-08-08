import { createHmac, timingSafeEqual } from 'crypto';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { readUserConfigSync } from '@/lib/user-config';
import { getDiscordMediaPublicPath } from '@/lib/discord-media-store';
import { listTenants } from '@/lib/tenant';
import { readDiscordConfig } from '@/lib/discord-config';

export const PRIVATE_DM_CONTROL_FIELD_NAME = '\u200B';
export const PRIVATE_DM_CONTROL_PATH = '/private-chat/control';
export const PRIVATE_DM_CONTROL_TTL_SECONDS = 90 * 24 * 60 * 60;

export const PRIVATE_DM_CONTROL_ACTIONS = {
  gif: 'g',
  tts: 't',
  adult: 'a',
  settings: 's',
} as const;

export type PrivateDmControlAction = keyof typeof PRIVATE_DM_CONTROL_ACTIONS;
export type PrivateDmControlActionCode = typeof PRIVATE_DM_CONTROL_ACTIONS[PrivateDmControlAction];

type PrivateDmControlTokenPayload = {
  v: 1;
  c: string;
  m: string;
  e: number;
};

export type VerifiedPrivateDmControl = {
  channelId: string;
  messageId: string;
  expiresAt: number;
};

type DiscordEmbed = Record<string, any>;

const tenantByDmChannelCache = new Map<string, { tenantId: string; expiresAt: number }>();
const TENANT_CACHE_MS = 5 * 60 * 1000;

function controlSecret(): string {
  const secret = String(
    process.env.PRIVATE_DM_CONTROL_SECRET ||
    process.env.BOT_SECRET_KEY ||
    process.env.STREAMWEAVER_API_KEY ||
    process.env.DISCORD_BOT_TOKEN ||
    '',
  ).trim();
  if (!secret) {
    throw new Error('Private DM controls require PRIVATE_DM_CONTROL_SECRET or an existing bot service secret.');
  }
  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', controlSecret())
    .update(encodedPayload)
    .digest()
    .subarray(0, 18)
    .toString('base64url');
}

function safeEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, 'base64url');
    const b = Buffer.from(right, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{15,22}$/.test(value);
}

export function createPrivateDmControlToken(input: {
  channelId: string;
  messageId: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  if (!isSnowflake(input.channelId) || !isSnowflake(input.messageId)) {
    throw new Error('Private DM controls require valid Discord channel and message IDs.');
  }
  const nowSeconds = Math.floor(input.nowSeconds ?? Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.floor(input.ttlSeconds ?? PRIVATE_DM_CONTROL_TTL_SECONDS));
  const payload: PrivateDmControlTokenPayload = {
    v: 1,
    c: input.channelId,
    m: input.messageId,
    e: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPrivateDmControlToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedPrivateDmControl | null {
  const [encoded, signature, ...extra] = String(token || '').split('.');
  if (!encoded || !signature || extra.length || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<PrivateDmControlTokenPayload>;
    if (payload.v !== 1 || !isSnowflake(payload.c) || !isSnowflake(payload.m)) return null;
    const expiresAt = Number(payload.e);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds) return null;
    // Tokens should never be accepted if a malformed payload claims an
    // implausibly distant expiration date.
    if (expiresAt > nowSeconds + PRIVATE_DM_CONTROL_TTL_SECONDS + 300) return null;
    return {
      channelId: payload.c,
      messageId: payload.m,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function parsePrivateDmControlAction(value: unknown): PrivateDmControlAction | null {
  const normalized = String(value || '').trim().toLowerCase();
  for (const [action, code] of Object.entries(PRIVATE_DM_CONTROL_ACTIONS)) {
    if (normalized === action || normalized === code) return action as PrivateDmControlAction;
  }
  return null;
}

function privateDmControlUrl(token: string, action: PrivateDmControlAction): string {
  const url = new URL(PRIVATE_DM_CONTROL_PATH, getConfiguredAppUrl());
  url.searchParams.set('k', token);
  url.searchParams.set('a', PRIVATE_DM_CONTROL_ACTIONS[action]);
  return url.toString();
}

export function buildPrivateDmControlField(input: {
  channelId: string;
  messageId: string;
  nowSeconds?: number;
}): { name: string; value: string; inline: false } {
  const token = createPrivateDmControlToken(input);
  const links: Array<[string, PrivateDmControlAction]> = [
    ['🖼️', 'gif'],
    ['🔊', 'tts'],
    ['🔞', 'adult'],
    ['⚙️', 'settings'],
  ];
  const value = links
    .map(([emoji, action]) => `[${emoji}](${privateDmControlUrl(token, action)})`)
    .join(' \u2003 ');
  if (value.length > 1024) {
    throw new Error(`Private DM control links exceed Discord's field limit (${value.length}/1024).`);
  }
  return { name: PRIVATE_DM_CONTROL_FIELD_NAME, value, inline: false };
}

export function isPrivateDmControlField(field: unknown): boolean {
  if (!field || typeof field !== 'object') return false;
  const value = String((field as Record<string, unknown>).value || '');
  return value.includes(PRIVATE_DM_CONTROL_PATH) && value.includes('[🖼️]') && value.includes('[⚙️]');
}

export function attachPrivateDmControls(
  embeds: Record<string, unknown>[],
  input: { channelId: string; messageId: string; nowSeconds?: number },
): Record<string, unknown>[] {
  if (!embeds.length) return embeds;
  const next = embeds.map((embed) => ({ ...embed })) as DiscordEmbed[];
  const first = next[0];
  const fields = Array.isArray(first.fields)
    ? first.fields.filter((field: unknown) => !isPrivateDmControlField(field))
    : [];
  if (fields.length >= 25) fields.splice(24);
  first.fields = [...fields, buildPrivateDmControlField(input)];
  return next;
}

function firstUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      // Ignore malformed configured URLs.
    }
  }
  return '';
}

function rewriteLegacyPrivateMediaUrl(value: string, tenantId: string): string {
  try {
    const url = new URL(value);
    if (url.pathname.toLowerCase() === '/avatars/private-dm.gif') {
      return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('private-dm', tenantId)}`;
    }
    if (url.pathname.toLowerCase() === '/avatars/public-discord.gif') {
      return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('public-discord', tenantId)}`;
    }
  } catch {
    return '';
  }
  return value;
}

export function resolvePrivateDmMediaUrl(tenantId: string): string {
  const config = readUserConfigSync(tenantId);
  const configured = firstUrl(
    config.PRIVATE_DM_GIF_URL,
    config.PUBLIC_DISCORD_GIF_URL,
    config.PUBLIC_AVATAR_URL,
    config.TWITCH_BOT_AVATAR_GIF_URL,
    config.TWITCH_BOT_AVATAR_URL,
    config.BOT_AVATAR_URL,
  );
  return configured ? rewriteLegacyPrivateMediaUrl(configured, tenantId) : '';
}

export function togglePrivateDmGif(
  embeds: Record<string, unknown>[],
  configuredMediaUrl: string,
): { embeds: Record<string, unknown>[]; visible: boolean } {
  if (!embeds.length) throw new Error('The Discord message has no embed to update.');
  const next = embeds.map((embed) => ({ ...embed })) as DiscordEmbed[];
  const first = next[0];
  const imageUrl = String(first?.image?.url || '').trim();

  if (imageUrl) {
    delete first.image;
    return { embeds: next, visible: false };
  }
  if (!configuredMediaUrl) {
    throw new Error('No private Discord GIF is configured to restore.');
  }
  first.image = { url: configuredMediaUrl };
  return { embeds: next, visible: true };
}

export function privateDmMessageText(message: unknown): string {
  const record = message && typeof message === 'object' ? message as Record<string, any> : {};
  const embeds = Array.isArray(record.embeds) ? record.embeds : [];
  const description = String(embeds[0]?.description || '').trim();
  const content = String(record.content || '').trim();
  return description || content;
}

export function splitPrivateTtsText(text: string, maxCharacters = 1800): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxCharacters && chunks.length < 3) {
    const head = remaining.slice(0, maxCharacters + 1);
    const candidates = [
      head.lastIndexOf('. '),
      head.lastIndexOf('! '),
      head.lastIndexOf('? '),
      head.lastIndexOf('; '),
      head.lastIndexOf(', '),
      head.lastIndexOf(' '),
    ].filter((index) => index >= Math.floor(maxCharacters * 0.55));
    const boundary = candidates.length ? Math.max(...candidates) + 1 : maxCharacters;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.slice(0, 4);
}

export async function resolvePrivateDmTenantId(channelId: string): Promise<string | null> {
  const cached = tenantByDmChannelCache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.tenantId;

  for (const tenantId of await listTenants().catch(() => [])) {
    if (tenantId.startsWith('__kick_silent__')) continue;
    const config = await readDiscordConfig(tenantId).catch(() => null) as Record<string, unknown> | null;
    if (String(config?.dmChannelId || '').trim() !== channelId) continue;
    tenantByDmChannelCache.set(channelId, { tenantId, expiresAt: Date.now() + TENANT_CACHE_MS });
    return tenantId;
  }
  return null;
}
