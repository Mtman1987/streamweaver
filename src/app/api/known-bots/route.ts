import { NextRequest } from 'next/server';
import { getTenantFromRequest, toStorageContext } from '@/lib/tenant-context';
import { apiOk, apiError } from '@/lib/api-response';
import { getAllKnownBots, getCustomBots, getDefaultBots, addCustomBot, removeCustomBot, clearBotCache } from '@/services/known-bots';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });

  const all = await getAllKnownBots(session.twitchId);
  const custom = await getCustomBots(session.twitchId);
  const defaults = getDefaultBots();

  return apiOk({ bots: all, custom, defaults, total: all.length });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });

  const { username, action } = await request.json();
  if (!username || typeof username !== 'string') {
    return apiError('Missing username', { status: 400 });
  }

  if (action === 'remove') {
    await removeCustomBot(username, session.twitchId);
    clearBotCache(session.twitchId);
    return apiOk({ removed: username.toLowerCase() });
  }

  await addCustomBot(username, session.twitchId);
  clearBotCache(session.twitchId);
  return apiOk({ added: username.toLowerCase() });
}
