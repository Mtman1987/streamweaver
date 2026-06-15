import { NextRequest, NextResponse } from 'next/server';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import fs from 'fs';
import path from 'path';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

const twitchUserEntrySchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      username: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
    })
    .passthrough(),
]);

const twitchLiveSchema = z.object({
  usernames: z.array(twitchUserEntrySchema).min(1),
});

const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';

type SharedSessionResponse = {
  data?: Array<{
    session_id: string;
    host_broadcaster_id: string;
    participants: Array<{ broadcaster_id: string }>;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const parsed = twitchLiveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid usernames array', { status: 400, code: 'INVALID_BODY' });
    }

    const { usernames } = parsed.data;


    // Handle both string arrays and object arrays from new JSON format
    const usernameStrings = usernames
      .map((u) => (typeof u === 'string' ? u : u.username || u.name))
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0);

    if (usernameStrings.length === 0) {
      return apiError('Invalid usernames array', { status: 400, code: 'INVALID_BODY' });
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return apiError('Twitch credentials not configured', { status: 500, code: 'MISSING_CREDENTIALS' });
    }

    const session = getTenantFromRequest(request);
    const tokens = await getStoredTokens(session?.tenantId);
    if (!tokens) {
      return apiError('No stored tokens found', { status: 500, code: 'MISSING_TOKENS' });
    }

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, session?.tenantId);
    
    // Also refresh community bot token if it exists
    if (tokens.communityBotToken && tokens.communityBotRefreshToken) {
      try {
        await ensureValidToken(clientId, clientSecret, 'community-bot', tokens, session?.tenantId);
      } catch (error) {
        console.error('[Twitch Live API] Failed to refresh community bot token:', error);
      }
    }
    
    // Use usernames as-is (no variations needed when reading from validated JSON)
    const allUsernames = new Set(usernameStrings);
    

    
    // Get all users in batches of 100
    const batchSize = 100;
    const allUsers: Array<Record<string, any>> = [];
    const usernameArray = Array.from(allUsernames);
    
    for (let i = 0; i < usernameArray.length; i += batchSize) {
      const batch = usernameArray.slice(i, i + batchSize);
      const userQueryString = batch.map(u => `login=${encodeURIComponent(u)}`).join('&');
      const userUrl = `https://api.twitch.tv/helix/users?${userQueryString}`;
      
      const userResponse = await fetch(userUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken.replace('oauth:', '')}`,
          'Client-ID': clientId
        }
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        allUsers.push(...(userData.data || []));
      }
    }
    

    
    if (allUsers.length === 0) {
      return NextResponse.json({ liveUsers: [] });
    }

    // Check which users are live
    const userIds = allUsers.map(user => user.id);
    const liveStreams: Array<Record<string, any>> = [];
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const streamQueryString = batch.map(id => `user_id=${id}`).join('&');
      const streamUrl = `https://api.twitch.tv/helix/streams?${streamQueryString}`;
      
      const streamResponse = await fetch(streamUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken.replace('oauth:', '')}`,
          'Client-ID': clientId
        }
      });

      if (streamResponse.ok) {
        const streamData = await streamResponse.json();
        liveStreams.push(...(streamData.data || []));
      }
    }

    const userById = new Map(allUsers.map((user) => [user.id, user]));
    const liveUserIds = Array.from(new Set(liveStreams.map((stream) => stream.user_id).filter(Boolean)));
    const sharedInfoByLogin: Record<
      string,
      { sharedSessionId: string; isSharedHost: boolean; sharedWith: string[] }
    > = {};

    for (const broadcasterId of liveUserIds) {
      try {
        const sessionResponse = await fetch(
          `https://api.twitch.tv/helix/shared_chat/session?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken.replace('oauth:', '')}`,
              'Client-ID': clientId,
            }
          }
        );

        if (!sessionResponse.ok) continue;

        const sessionData = await sessionResponse.json() as SharedSessionResponse;
        const session = sessionData.data?.[0];
        if (!session || !Array.isArray(session.participants) || session.participants.length <= 1) continue;

        const participantLogins = session.participants
          .map((participant) => userById.get(participant.broadcaster_id)?.login)
          .filter((login): login is string => Boolean(login));

        for (const participant of session.participants) {
          const login = userById.get(participant.broadcaster_id)?.login;
          if (!login) continue;
          sharedInfoByLogin[login.toLowerCase()] = {
            sharedSessionId: session.session_id,
            isSharedHost: participant.broadcaster_id === session.host_broadcaster_id,
            sharedWith: participantLogins.filter((entry) => entry.toLowerCase() !== login.toLowerCase()),
          };
        }
      } catch (error) {
        if (VERBOSE_LOGS) {
          console.warn(`[Twitch Live] Shared chat lookup failed for broadcaster ${broadcasterId}:`, error);
        }
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    // Map back to usernames
    const liveUsers = liveStreams.map(stream => {
      const user = userById.get(stream.user_id);
      const username = (user?.login || stream.user_login || '').toLowerCase();
      const sharedInfo = sharedInfoByLogin[username];
      return {
        id: user?.id || stream.user_id,
        username,
        displayName: user?.display_name || stream.user_name,
        profile_image_url: user?.profile_image_url,
        title: stream.title,
        gameName: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnailUrl: stream.thumbnail_url,
        startedAt: stream.started_at,
        isSharedChat: Boolean(sharedInfo),
        sharedSessionId: sharedInfo?.sharedSessionId || null,
        isSharedHost: sharedInfo?.isSharedHost || false,
        sharedWith: sharedInfo?.sharedWith || [],
      };
    });

    if (VERBOSE_LOGS && liveUsers.length > 0) console.log(`[Twitch Live] ${liveUsers.length} users live: ${liveUsers.map(u => u.username).join(', ')}`);
    return NextResponse.json({ 
      liveUsers,
      allUsers: allUsers.map(user => ({
        username: user.login,
        displayName: user.display_name,
        id: user.id,
        profile_image_url: user.profile_image_url
      }))
    });
  } catch (error) {
    console.error('[Twitch Live API] Error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
