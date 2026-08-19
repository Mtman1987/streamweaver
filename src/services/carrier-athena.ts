import * as fs from 'fs/promises';
import { globalPath } from '../lib/tenant';
import { internalServiceHeaders } from '../lib/internal-service-auth';
import { ATHENA_WHITELIST_TENANT_ID, canUseAthenaEverywhere } from './athena-whitelist';
import { incrementMetric } from './metrics';

export type CarrierAthenaResult = {
  handled: boolean;
  ok: boolean;
  message?: string;
};

const ATHENA_CARRIER_MENTION = /(^|[^a-z0-9_])@?(?:athena|annie|athenabot87)(?:[^a-z0-9_]|$)/i;

export function isTwitchCarrierAthenaCall(message: string): boolean {
  return ATHENA_CARRIER_MENTION.test(String(message || ''));
}

async function getAthenaEverywhereMode(): Promise<'on' | 'off'> {
  if (process.env.ATHENA_EVERYWHERE_MODE === 'false') return 'off';
  try {
    const raw = await fs.readFile(globalPath('athena-everywhere-mode.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.mode === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

function requestTimeout(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(20_000)
    : undefined;
}

function compactError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value || 'unknown error');
  return text.replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown error';
}

export async function handleTwitchCarrierAthenaCall(input: {
  username: string;
  displayName?: string;
  channel: string;
  message: string;
}): Promise<CarrierAthenaResult> {
  const username = String(input.username || '').trim().replace(/^@/, '');
  const message = String(input.message || '').trim();
  if (!username || !message || !isTwitchCarrierAthenaCall(message)) {
    return { handled: false, ok: false };
  }

  const authorized = await canUseAthenaEverywhere({
    username,
    tenantId: ATHENA_WHITELIST_TENANT_ID,
  });
  if (!authorized) {
    return { handled: false, ok: false };
  }

  if (await getAthenaEverywhereMode() !== 'on') {
    return {
      handled: true,
      ok: false,
      message: `@${username}, Athena everywhere mode is OFF.`,
    };
  }

  incrementMetric('athenaCommands', 1, ATHENA_WHITELIST_TENANT_ID).catch(() => {});

  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username,
        displayName: String(input.displayName || username).trim(),
        message,
        tenantId: ATHENA_WHITELIST_TENANT_ID,
        channelId: String(input.channel || '').replace(/^#/, '').toLowerCase(),
        context: 'twitch',
      }),
      signal: requestTimeout(),
    });

    if (!response.ok) {
      const details = compactError(await response.text().catch(() => ''));
      throw new Error(`Athena AI request failed: ${response.status}${details ? ` ${details}` : ''}`);
    }

    const payload = await response.json().catch(() => null) as any;
    const reply = String(payload?.response || payload?.data?.response || '').trim();
    if (!reply) throw new Error('Athena returned no reply');

    return { handled: true, ok: true, message: reply };
  } catch (error) {
    console.error('[CarrierAthena] Athena carrier call failed:', error);
    return {
      handled: true,
      ok: false,
      message: `@${username}, Athena failed: ${compactError(error)}`,
    };
  }
}
