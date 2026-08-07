import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getBotName } from '@/lib/bot-settings-store';
import {
  appendPrivateChatMessages,
  type PrivateChatMessage,
} from '@/lib/private-chat-store';
import {
  getPrivateMessageCount,
  incrementPrivateMessageCount,
} from '@/lib/private-ltm-store';
import {
  hasInternalServiceAccess,
  hasMountainViewBridgeAccess,
  internalServiceHeaders,
} from '@/lib/internal-service-auth';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { respondWithAthena } from '@/services/athena-gateway';

const schema = z.object({
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().max(20_000),
  attachments: z.array(z.object({
    id: z.string().optional(),
    url: z.string().trim().min(1),
    filename: z.string().optional(),
    content_type: z.string().optional(),
  }).passthrough()).max(20).optional(),
  embeds: z.array(z.object({}).passthrough()).max(20).optional(),
  personality: z.string().trim().max(6000).optional(),
  historyLimit: z.coerce.number().int().min(0).max(100).optional().default(20),
  tenantId: z.string().trim().max(128).optional(),
  conversationId: z.string().trim().max(256).optional(),
  userId: z.string().trim().max(128).optional(),
  channelId: z.string().trim().max(128).optional(),
  channelName: z.string().trim().max(128).optional(),
  messageId: z.string().trim().max(128).optional(),
  createdAt: z.string().trim().max(128).optional(),
  source: z.enum(['app-private', 'discord-dm', 'rotator', 'mountainview', 'internal']).optional().default('app-private'),
  layout: z.string().trim().max(128).optional(),
  capabilities: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
}).refine((value) => value.message || value.attachments?.length || value.embeds?.length, {
  message: 'message or media is required',
});

function mediaContext(
  attachments: PrivateChatMessage['attachments'] | undefined,
  embeds: PrivateChatMessage['embeds'] | undefined,
): string {
  const lines: string[] = [];
  for (const attachment of attachments || []) {
    lines.push(`Attachment: ${attachment.filename || 'file'} (${attachment.content_type || 'unknown type'}) ${attachment.url}`);
  }
  for (const embed of embeds || []) {
    const parts = [embed.title, embed.description, embed.url, embed.image?.url, embed.thumbnail?.url].filter(Boolean);
    if (parts.length) lines.push(`Embed: ${parts.join(' | ')}`);
  }
  return lines.length ? `Media supplied with this private turn:\n${lines.join('\n')}` : '';
}

async function checkAndCondensePrivateMemory(tenantId: string): Promise<void> {
  try {
    const count = await getPrivateMessageCount(tenantId);
    if (count <= 0 || count % 50 !== 0) return;
    const response = await fetch(`${getInternalAppUrl()}/api/private-ltm/condense`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tenantId }),
    });
    if (!response.ok) {
      console.warn('[Private Chat API] Legacy private LTM condensation failed:', response.status);
    }
  } catch (error) {
    console.warn('[Private Chat API] Legacy private LTM condensation failed:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing required fields: username, message or media', {
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

    await incrementPrivateMessageCount(tenantId);
    await checkAndCondensePrivateMemory(tenantId);

    const sourceSurface = body.source === 'discord-dm'
      ? 'discord-dm'
      : body.source === 'rotator'
        ? 'rotator-workbench'
        : body.source === 'mountainview'
          ? 'mountainview'
          : body.source === 'internal'
            ? 'internal'
            : 'streamweaver-private';
    const media = mediaContext(body.attachments, body.embeds);
    const messageForAthena = body.message || '[The user shared private media without accompanying text.]';
    const botName = getBotName(tenantId) || 'Athena';

    const result = await respondWithAthena({
      tenantId,
      message: messageForAthena,
      actor: {
        userId: body.userId || session?.tenantId,
        username: body.username,
        displayName: body.username,
      },
      location: {
        app: body.source === 'rotator' ? 'fly-machine-rotator' : 'streamweaver',
        surface: sourceSurface,
        channelId: body.channelId,
        channelName: body.channelName,
        messageId: body.messageId,
        createdAt: body.createdAt,
        live: false,
        layout: body.layout,
        replyMode: body.source === 'mountainview' ? 'voice' : 'structured',
        capabilities: body.capabilities || [
          'athena.memory.public',
          'athena.memory.private',
          'image.generate.private',
          'spmt.read-tools',
        ],
      },
      visibility: 'private',
      conversationId: body.conversationId,
      personalityOverride: (serviceAccess || mountainViewAccess) ? body.personality : undefined,
      responseName: botName,
      additionalContext: media || undefined,
      executeTools: true,
      metadata: {
        compatibilityRoute: '/api/private-chat/respond',
        source: body.source,
        attachmentCount: body.attachments?.length || 0,
        embedCount: body.embeds?.length || 0,
      },
    });

    const timestamp = new Date().toISOString();
    await appendPrivateChatMessages([
      {
        type: 'user',
        username: body.username,
        message: body.message,
        timestamp,
        attachments: body.attachments,
        embeds: body.embeds,
      },
      {
        type: 'ai',
        username: botName,
        message: result.response,
        timestamp,
        ...(result.images?.length
          ? {
              embeds: result.images.map((url) => ({
                title: 'Athena private image',
                image: { url },
              })),
            }
          : {}),
      },
    ], 160, tenantId);

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
    });
  } catch (error) {
    console.error('[Private Chat API] Unified Athena route failed:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to generate private Athena response', {
      status: 500,
      code: 'ATHENA_FAILED',
    });
  }
}
