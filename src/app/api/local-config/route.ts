import { NextRequest } from 'next/server';
import { getPublicConfigAll, initializeLocalConfig } from '@/lib/local-config/service';
import { apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  await initializeLocalConfig();
  const config = await getPublicConfigAll();
  return apiOk({ config });
}
