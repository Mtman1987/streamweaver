import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { handleWalkOnShoutout } from '@/services/walk-on-shoutout';
import { getTwitchUser } from '@/services/twitch';

const schema = z.object({
  login: z.string().trim().min(1).max(64),
  displayName: z.string().trim().max(128).optional(),
  profileImageUrl: z.string().trim().url().optional(),
});

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('login is required', { status: 400, code: 'INVALID_BODY' });
  }

  const login = parsed.data.login.trim().replace(/^@/, '');

  try {
    const twitchUser = await getTwitchUser(login, 'login').catch(() => null);
    const displayName = twitchUser?.displayName || parsed.data.displayName || login;
    const profileImage =
      twitchUser?.profileImageUrl ||
      parsed.data.profileImageUrl ||
      `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`;

    await handleWalkOnShoutout(login, displayName, profileImage, true, session.tenantId, {
      source: 'manual',
    });

    return apiOk({
      success: true,
      login,
      displayName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual shoutout failed';
    return apiError(message, { status: 500, code: 'SHOUTOUT_FAILED' });
  }
}
