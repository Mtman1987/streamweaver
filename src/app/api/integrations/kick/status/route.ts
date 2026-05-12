import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { apiOk } from '@/lib/api-response';
import { getTenantFromRequest, toStorageContext } from '@/lib/tenant-context';
import { tenantPath } from '@/lib/tenant';
import { getKickServiceForTenant } from '@/services/kick';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiOk({ broadcasterConnected: false, botConnected: false, broadcasterUsername: null, botUsername: null, channelConnected: false });

  const tenantId = session.tenantId;
  let broadcasterConnected = false;
  let botConnected = false;
  let broadcasterUsername: string | null = null;
  let botUsername: string | null = null;

  try {
    const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
    const data = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));
    if (data.broadcasterToken) {
      broadcasterConnected = true;
      broadcasterUsername = data.broadcasterUsername || null;
    }
    if (data.botToken) {
      botConnected = true;
      botUsername = data.botUsername || null;
    }
  } catch {}

  const kickInstance = getKickServiceForTenant(tenantId);
  const channelConnected = kickInstance?.isConnected() || false;

  return apiOk({ broadcasterConnected, botConnected, broadcasterUsername, botUsername, channelConnected });
}
