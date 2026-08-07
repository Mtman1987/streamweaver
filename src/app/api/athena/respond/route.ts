import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  ATHENA_SURFACES,
  trustedVisibilityForSurface,
  type AthenaRequest,
  type AthenaSurface,
} from '@/services/athena-contract';
import { respondWithAthena } from '@/services/athena-gateway';

const actorSchema = z.object({
  userId: z.string().trim().max(128).optional(),
  username: z.string().trim().min(1).max(128),
  displayName: z.string().trim().max(128).optional(),
  isOwner: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  isModerator: z.boolean().optional(),
});

const locationSchema = z.object({
  app: z.string().trim().max(128).optional(),
  surface: z.enum(ATHENA_SURFACES),
  guildId: z.string().trim().max(128).optional(),
  guildName: z.string().trim().max(128).optional(),
  channelId: z.string().trim().max(128).optional(),
  channelName: z.string().trim().max(128).optional(),
  channelType: z.union([z.string().max(64), z.number()]).optional(),
  messageId: z.string().trim().max(128).optional(),
  createdAt: z.string().trim().max(128).optional(),
  live: z.boolean().optional(),
  layout: z.string().trim().max(128).optional(),
  replyMode: z.enum(['chat', 'voice', 'structured', 'silent']).optional(),
  capabilities: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
});

const schema = z.object({
  tenantId: z.string().trim().max(128).optional(),
  message: z.string().trim().min(1).max(20_000),
  actor: actorSchema.optional(),
  username: z.string().trim().min(1).max(128).optional(),
  displayName: z.string().trim().max(128).optional(),
  userId: z.string().trim().max(128).optional(),
  location: locationSchema,
  visibility: z.enum(['public', 'private']).optional(),
  conversationId: z.string().trim().max(256).optional(),
  transientHistory: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().trim().min(1).max(20_000),
  })).max(40).optional(),
  personalityOverride: z.string().trim().max(6000).optional(),
  responseName: z.string().trim().max(128).optional(),
  additionalContext: z.string().trim().max(20_000).optional(),
  executeTools: z.boolean().optional(),
  confirmedActionId: z.string().trim().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const BROWSER_SESSION_SURFACES = new Set<AthenaSurface>([
  'streamweaver-private',
  'app-layout',
]);

function validateCallerSurface(input: {
  surface: AthenaSurface;
  hasSession: boolean;
  serviceAccess: boolean;
  mountainViewAccess: boolean;
}): string | null {
  if (input.serviceAccess) return null;
  if (input.mountainViewAccess) {
    return input.surface === 'mountainview'
      ? null
      : 'MountainView bridge requests must use the mountainview surface.';
  }
  if (input.hasSession) {
    return BROWSER_SESSION_SURFACES.has(input.surface)
      ? null
      : 'Browser sessions may use only authenticated private app surfaces.';
  }
  return 'No trusted Athena surface is available for this caller.';
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid Athena request', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const session = getTenantFromRequest(request);
    const serviceAccess = hasInternalServiceAccess(request);
    const mountainViewAccess = hasMountainViewBridgeAccess(request);
    if (!session?.tenantId && !serviceAccess && !mountainViewAccess) {
      return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
    }

    const surfaceError = validateCallerSurface({
      surface: parsed.data.location.surface,
      hasSession: Boolean(session?.tenantId),
      serviceAccess,
      mountainViewAccess,
    });
    if (surfaceError) {
      return apiError(surfaceError, { status: 403, code: 'SURFACE_FORBIDDEN' });
    }

    const tenantId = session?.tenantId || ((serviceAccess || mountainViewAccess) ? parsed.data.tenantId : undefined);
    if (!tenantId) {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }

    const suppliedActor = parsed.data.actor || {
      username: parsed.data.username || 'User',
      displayName: parsed.data.displayName,
      userId: parsed.data.userId,
    };
    const actor = session && !serviceAccess && !mountainViewAccess
      ? {
          userId: session.tenantId,
          username: session.username,
          displayName: session.displayName || session.username,
          isOwner: false,
          isAdmin: false,
          isModerator: false,
        }
      : suppliedActor;

    const visibility = trustedVisibilityForSurface(parsed.data.location.surface);
    const athenaRequest: AthenaRequest = {
      tenantId,
      message: parsed.data.message,
      actor,
      location: parsed.data.location,
      visibility,
      conversationId: parsed.data.conversationId,
      transientHistory: parsed.data.transientHistory,
      personalityOverride: (serviceAccess || mountainViewAccess) ? parsed.data.personalityOverride : undefined,
      responseName: parsed.data.responseName,
      additionalContext: (serviceAccess || mountainViewAccess) ? parsed.data.additionalContext : undefined,
      executeTools: parsed.data.executeTools !== false,
      confirmedActionId: parsed.data.confirmedActionId,
      metadata: parsed.data.metadata,
    };

    const result = await respondWithAthena(athenaRequest);
    return apiOk(result);
  } catch (error) {
    console.error('[Athena Gateway] Request failed:', error);
    return apiError(error instanceof Error ? error.message : 'Athena request failed', {
      status: 500,
      code: 'ATHENA_FAILED',
    });
  }
}
