import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { listTenants, tenantPath, isAdmin } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';
import { COMMUNITY_BOT_NAME } from '@/lib/bot-personality-defaults';
import { PERSONALITY_RUNTIME_VERSION } from '@/lib/personality-prompt';
import { z } from 'zod';

function storedTemplateVersion(personality: string): string | null {
  const match = String(personality || '').match(/\[PERSONALITY_TEMPLATE:\s*([^\]]+)\]/i);
  return match?.[1]?.trim() || null;
}

/**
 * GET /api/admin/tenants
 * Returns the bot fleet inventory for all tenants without exposing OAuth token
 * values. Capability flags mean the required credential pair is configured;
 * Twitch still validates/refreshes the token at command execution time.
 */
export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  if (!isAdmin(session.tenantId)) return apiError('Admin only', { status: 403 });

  const tenantIds = await listTenants();
  const tenants = [];

  for (const id of tenantIds) {
    let broadcasterUsername = '';
    let botUsername = '';
    let hasBroadcasterToken = false;
    let hasBotToken = false;
    let botName = '';
    let botPersonality = '';

    try {
      const raw = await fs.readFile(tenantPath(id, 'tokens/twitch-tokens.json'), 'utf-8');
      const tokens = JSON.parse(raw);
      broadcasterUsername = tokens.broadcasterUsername || tokens.loginUsername || '';
      botUsername = tokens.botUsername || '';
      hasBroadcasterToken = Boolean(tokens.broadcasterToken && tokens.broadcasterRefreshToken);
      hasBotToken = Boolean(tokens.botToken && tokens.botRefreshToken && tokens.botUsername);
    } catch {}

    try {
      const raw = await fs.readFile(tenantPath(id, 'tokens/user-config.json'), 'utf-8');
      const config = JSON.parse(raw);
      botName = config.AI_BOT_NAME || '';
      botPersonality = config.AI_BOT_PERSONALITY || '';
    } catch {}

    const botMode = hasBotToken ? 'dedicated' : 'community-fallback';
    const effectiveBotName = hasBotToken
      ? (botName || botUsername || COMMUNITY_BOT_NAME)
      : COMMUNITY_BOT_NAME;
    const savedTemplateVersion = storedTemplateVersion(botPersonality);

    tenants.push({
      tenantId: id,
      broadcasterUsername,
      botUsername,
      hasBroadcasterToken,
      hasBotToken,
      botMode,
      effectiveBotName,
      configuredBotName: botName || null,
      fallbackBotName: hasBotToken ? null : COMMUNITY_BOT_NAME,
      botPersonality,
      personalitySource: botPersonality ? 'tenant' : 'community-default',
      savedPersonalityTemplateVersion: savedTemplateVersion,
      runtimePersonalityVersion: PERSONALITY_RUNTIME_VERSION,
      automaticallyUsesLatestRuntimePersonalityPolicy: true,
      hasStructuredPrompt: botPersonality.includes('\n---'),
      commandCapabilities: {
        commandsConfigured: hasBroadcasterToken,
        chatIdentity: hasBotToken ? 'dedicated-bot' : 'community-bot',
        clip: hasBroadcasterToken ? 'broadcaster-oauth' : 'twitch-reauth-required',
        channelManagement: hasBroadcasterToken ? 'broadcaster-oauth' : 'twitch-reauth-required',
        customBotIdentity: hasBotToken,
      },
    });
  }

  return apiOk({
    summary: {
      totalTenants: tenants.length,
      dedicatedBots: tenants.filter((tenant) => tenant.hasBotToken).length,
      communityFallbackBots: tenants.filter((tenant) => !tenant.hasBotToken).length,
      broadcasterAuthConfigured: tenants.filter((tenant) => tenant.hasBroadcasterToken).length,
      twitchReauthNeeded: tenants.filter((tenant) => !tenant.hasBroadcasterToken).length,
      runtimePersonalityVersion: PERSONALITY_RUNTIME_VERSION,
    },
    tenants,
  });
}

const patchSchema = z.object({
  tenantId: z.string().trim().min(1),
  botName: z.string().trim().min(1).optional(),
  botPersonality: z.string().trim().min(1).optional(),
});

/**
 * PATCH /api/admin/tenants
 * Update a specific tenant's bot name and/or personality.
 */
export async function PATCH(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  if (!isAdmin(session.tenantId)) return apiError('Admin only', { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid body', { status: 400 });

  const { tenantId, botName, botPersonality } = parsed.data;

  const configPath = tenantPath(tenantId, 'tokens/user-config.json');
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {}

  if (botName) config.AI_BOT_NAME = botName;
  if (botPersonality) config.AI_BOT_PERSONALITY = botPersonality;

  const dir = configPath.replace(/[/\\][^/\\]+$/, '');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  // Clear in-memory cache so next chat picks up new personality
  try {
    const { setBotSettings } = require('@/lib/bot-settings-store');
    const updates: Record<string, string> = {};
    if (botName) updates.name = botName;
    if (botPersonality) updates.personality = botPersonality;
    setBotSettings(tenantId, updates);
  } catch {}

  console.log(`[Admin] Updated tenant ${tenantId}: name=${botName || '(unchanged)'}`);
  return apiOk({ success: true, tenantId });
}
