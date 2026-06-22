import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getGenMode } from '@/lib/gen-mode-store';
import { readUserConfigSync } from '@/lib/user-config';

type ProviderStatus = {
  name: string;
  configured: boolean;
  reason?: string;
};

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;

  const [settings, legacyMode] = await Promise.all([
    readGenerationSettings(tenantId).catch(() => null),
    getGenMode(tenantId).catch(() => 'eden' as const),
  ]);
  const activeMode = settings?.mode || legacyMode;

  const config = readUserConfigSync(tenantId);

  const providers: ProviderStatus[] = [
    {
      name: 'eden',
      configured: !!(config.EDENAI_API_KEY || process.env.EDENAI_API_KEY),
      ...(!config.EDENAI_API_KEY && !process.env.EDENAI_API_KEY ? { reason: 'EDENAI_API_KEY not set' } : {}),
    },
    {
      name: 'seaart',
      configured: !!(config.SEAART_TOKEN || process.env.SEAART_TOKEN),
      ...(!config.SEAART_TOKEN && !process.env.SEAART_TOKEN ? { reason: 'SEAART_TOKEN not set' } : {}),
    },
    {
      name: 'perchance',
      configured: true,
      ...(!process.env.PERCHANCE_ENDPOINT_TEMPLATE ? { reason: 'perchance.org blocks server-side requests; using no-key image fallback' } : {}),
    },
    {
      name: 'pollinations',
      configured: true,
      reason: 'no-key static image fallback',
    },
  ];

  const active = providers.find((p) => p.name === activeMode);

  return apiOk({
    activeMode,
    activeProviderReady: active?.configured ?? false,
    settings: settings ? { mode: settings.mode, model: settings.model, resolution: settings.resolution } : null,
    providers,
  });
}
