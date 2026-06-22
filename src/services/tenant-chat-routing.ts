import * as fs from 'fs/promises';

import { tenantPath } from '../lib/tenant';
import { readUserConfigSync } from '../lib/user-config';

export function pickTwitchReplyChannel(input: {
  sourceChannel: string;
  sourceTenantId?: string;
  responseTenantId?: string;
  responseTenantChannel?: string;
}): string {
  const sourceChannel = String(input.sourceChannel || '').trim().replace(/^#/, '').toLowerCase();
  return sourceChannel;
}

export async function getTenantBroadcasterChannel(tenantId?: string): Promise<string> {
  if (!tenantId) return 'discord';
  try {
    const raw = await fs.readFile(tenantPath(tenantId, 'tokens/twitch-tokens.json'), 'utf-8');
    const tokens = JSON.parse(raw);
    return String(tokens?.broadcasterUsername || tokens?.loginUsername || '').trim() || 'discord';
  } catch {
    try {
      const config = readUserConfigSync(tenantId);
      return String(config.TWITCH_BROADCASTER_USERNAME || '').trim() || 'discord';
    } catch {
      return 'discord';
    }
  }
}

export async function resolveTwitchReplyChannel(input: {
  sourceChannel: string;
  sourceTenantId?: string;
  responseTenantId?: string;
}): Promise<string> {
  const responseTenantChannel = input.responseTenantId && input.responseTenantId !== input.sourceTenantId
    ? await getTenantBroadcasterChannel(input.responseTenantId)
    : undefined;

  return pickTwitchReplyChannel({
    sourceChannel: input.sourceChannel,
    sourceTenantId: input.sourceTenantId,
    responseTenantId: input.responseTenantId,
    responseTenantChannel,
  });
}
