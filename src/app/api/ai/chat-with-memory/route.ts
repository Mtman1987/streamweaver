import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { appendPublicChatMessages } from '@/lib/public-chat-store';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { getTenantFromRequest } from '@/lib/tenant-context';
import type { AthenaSurface } from '@/services/athena-contract';
import { respondWithAthena } from '@/services/athena-gateway';
import { resolveResearchMode } from '@/services/research-mode';

const schema = z.object({
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(20_000),
  userId: z.string().trim().max(128).optional(),
  displayName: z.string().trim().max(128).optional(),
  guildId: z.string().trim().max(128).optional(),
  guildName: z.string().trim().max(128).optional(),
  channelId: z.string().trim().max(128).optional(),
  channelName: z.string().trim().max(128).optional(),
  channelType: z.union([z.string(), z.number()]).optional(),
  messageId: z.string().trim().max(128).optional(),
  createdAt: z.string().trim().max(128).optional(),
  isDirectMessage: z.boolean().optional(),
  personality: z.string().trim().max(6000).optional(),
  responseName: z.string().trim().max(128).optional(),
  tenantId: z.string().trim().max(128).optional(),
  conversationId: z.string().trim().max(256).optional(),
  layout: z.string().trim().max(128).optional(),
  capabilities: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  context: z.enum([
    'twitch',
    'twitch-cross-bot',
    'discord',
    'discord-cross-bot',
    'kick',
    'voice',
    'private',
  ]).optional().default('twitch'),
});

function surfaceFor(input: z.infer<typeof schema>): AthenaSurface {
  if (input.context === 'private') return 'streamweaver-private';
  if (input.context === 'voice') return 'mountainview';
  if (input.context === 'kick') return 'kick-chat';
  if (input.context === 'discord' || input.context === 'discord-cross-bot') {
    return input.isDirectMessage ? 'discord-dm' : 'discord-channel';
  }
  return 'twitch-chat';
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing required fields: username, message', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;
    const session = getTenantFromRequest(request);
    const serviceAccess = hasInternalServiceAccess(request);
    const mountainViewAccess = hasMountainViewBridgeAccess(request);
    if (!session?.tenantId && !serviceAccess && !mountainViewAccess) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const tenantId = session?.tenantId || ((serviceAccess || mountainViewAccess) ? body.tenantId : undefined);
    if (!tenantId) return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });

    const surface = surfaceFor(body);
    const research = await resolveResearchMode({
      tenantId,
      botName: body.responseName || 'Athena',
      username: body.username,
      platform: body.context,
      channelId: body.channelId,
      message: body.message,
    });

    if (research.kind === 'prompt') {
      const timestamp = new Date().toISOString();
      await appendPublicChatMessages([
        { type: 'user', username: body.username, message: body.message, timestamp },
        { type: 'ai', username: body.responseName || 'Athena', message: research.response, timestamp },
      ], 100, tenantId);
      return apiOk({
        response: research.response,
        provider: 'research-router',
        model: 'deterministic',
        research: { state: 'awaiting-query', sources: [] },
      });
    }

    const result = await respondWithAthena({
      tenantId,
      message: body.message,
      actor: {
        userId: body.userId,
        username: body.username,
        displayName: body.displayName || body.username,
      },
      location: {
        app: 'streamweaver',
        surface,
        guildId: body.guildId,
        guildName: body.guildName,
        channelId: body.channelId,
        channelName: body.channelName,
        channelType: body.channelType,
        messageId: body.messageId,
        createdAt: body.createdAt,
        live: surface === 'twitch-chat' || surface === 'kick-chat' || surface === 'discord-channel',
        layout: body.layout,
        replyMode: body.context === 'voice' ? 'voice' : 'chat',
        capabilities: body.capabilities,
      },
      visibility: surface === 'discord-dm' || surface === 'streamweaver-private' || surface === 'mountainview'
        ? 'private'
        : 'public',
      conversationId: body.conversationId,
      personalityOverride: (serviceAccess || mountainViewAccess) ? body.personality : undefined,
      responseName: body.responseName,
      additionalContext: research.kind === 'research' ? research.context : undefined,
      executeTools: true,
      metadata: {
        compatibilityRoute: '/api/ai/chat-with-memory',
        legacyContext: body.context,
      },
    });

    const timestamp = new Date().toISOString();
    if (result.visibility === 'public') {
      await appendPublicChatMessages([
        { type: 'user', username: body.username, message: body.message, timestamp },
        { type: 'ai', username: body.responseName || 'Athena', message: result.response, timestamp },
      ], 100, tenantId);
    }

    return apiOk({
      response: result.response,
      provider: result.provider,
      model: result.model,
      visibility: result.visibility,
      surface: result.surface,
      conversationId: result.conversationId,
      decision: result.decision,
      images: result.images,
      memorySources: result.memorySources,
      research: research.kind === 'research'
        ? { state: 'completed', query: research.query, sources: research.sources }
        : undefined,
    });
  } catch (error) {
    console.error('[AI Chat Memory] Unified Athena route failed:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to generate Athena response', {
      status: 500,
      code: 'ATHENA_FAILED',
    });
  }
}
