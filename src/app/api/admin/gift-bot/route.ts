import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { tenantPath, isAdmin } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const giftBotSchema = z.object({
  targetTenantId: z.string().trim().min(1),
  botName: z.string().trim().min(1).optional(),
  botPersonality: z.string().trim().min(1).optional(),
});

/**
 * POST /api/admin/gift-bot
 * 
 * Admin-only. Moves the bot token/refresh/username from your tenant
 * to the target tenant. Optionally sets their bot name and personality.
 * 
 * After calling this, re-auth your own bot account on /integrations.
 */
export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  if (!isAdmin(session.tenantId)) return apiError('Admin only', { status: 403 });

  const parsed = giftBotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid body: targetTenantId required', { status: 400 });

  const { targetTenantId, botName, botPersonality } = parsed.data;

  // Read your tokens
  const myTokensPath = tenantPath(session.tenantId, 'tokens/twitch-tokens.json');
  let myTokens: Record<string, any>;
  try {
    myTokens = JSON.parse(await fs.readFile(myTokensPath, 'utf-8'));
  } catch {
    return apiError('Could not read your tokens', { status: 500 });
  }

  if (!myTokens.botToken || !myTokens.botRefreshToken || !myTokens.botUsername) {
    return apiError('No bot account connected on your tenant. Link one first.', { status: 400 });
  }

  // Read target tokens
  const targetTokensPath = tenantPath(targetTenantId, 'tokens/twitch-tokens.json');
  let targetTokens: Record<string, any> = {};
  try {
    targetTokens = JSON.parse(await fs.readFile(targetTokensPath, 'utf-8'));
  } catch {
    return apiError('Target tenant not found or has no tokens file', { status: 404 });
  }

  // Move bot credentials to target
  targetTokens.botToken = myTokens.botToken;
  targetTokens.botRefreshToken = myTokens.botRefreshToken;
  targetTokens.botTokenExpiry = myTokens.botTokenExpiry;
  targetTokens.botUsername = myTokens.botUsername;
  targetTokens.lastUpdated = new Date().toISOString();

  await fs.writeFile(targetTokensPath, JSON.stringify(targetTokens, null, 2));

  // Remove bot from your tenant
  delete myTokens.botToken;
  delete myTokens.botRefreshToken;
  delete myTokens.botTokenExpiry;
  delete myTokens.botUsername;
  myTokens.lastUpdated = new Date().toISOString();

  await fs.writeFile(myTokensPath, JSON.stringify(myTokens, null, 2));

  // Optionally set bot name and personality on target
  if (botName || botPersonality) {
    const targetConfigPath = tenantPath(targetTenantId, 'tokens/user-config.json');
    let targetConfig: Record<string, string> = {};
    try {
      targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf-8'));
    } catch {}

    if (botName) targetConfig.AI_BOT_NAME = botName;
    if (botPersonality) targetConfig.AI_BOT_PERSONALITY = botPersonality;

    await fs.mkdir(targetConfigPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    await fs.writeFile(targetConfigPath, JSON.stringify(targetConfig, null, 2));
  }

  // Trigger IRC reconnect for target tenant
  try {
    const wsPort = process.env.WS_PORT || '8090';
    await fetch(`http://127.0.0.1:${wsPort}/api/twitch/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: targetTenantId }),
    });
  } catch {}

  console.log(`[Admin] Gifted bot "${myTokens.botUsername}" from ${session.tenantId} to ${targetTenantId}`);

  return apiOk({
    success: true,
    giftedBot: targetTokens.botUsername,
    targetTenantId,
    botName: botName || null,
    message: `Bot moved to ${targetTenantId}. Re-auth your own bot on /integrations.`,
  });
}
