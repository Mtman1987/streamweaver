import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getGenMode } from '@/lib/gen-mode-store';
import { readUserConfigSync } from '@/lib/user-config';
import { readAICostPolicy } from '@/services/ai-cost-policy';

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
    getGenMode(tenantId).catch(() => 'cloudflare' as const),
  ]);
  const activeMode = settings?.mode || legacyMode;

  const config = readUserConfigSync(tenantId);
  const paidRoutesEnabled = readAICostPolicy().paidRoutesEnabled;
  const cloudflareCredentialsReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
  const cloudflareReady = cloudflareCredentialsReady && paidRoutesEnabled;

  const providers: ProviderStatus[] = [
    {
      name: 'cloudflare',
      configured: cloudflareReady,
      ...(!cloudflareCredentialsReady
        ? { reason: 'Cloudflare credentials are not set; requests fall back to Pollinations' }
        : !paidRoutesEnabled
          ? { reason: 'Provider policy is paused; requests fall back to free Pollinations' }
          : {}),
    },
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
  const effective = activeMode === 'cloudflare' && !cloudflareReady
    ? providers.find((p) => p.name === 'pollinations')
    : active;

  return apiOk({
    activeMode,
    effectiveMode: effective?.name || activeMode,
    activeProviderReady: effective?.configured ?? false,
    configuredProviderReady: active?.configured ?? false,
    settings: settings ? { mode: settings.mode, model: settings.model, resolution: settings.resolution } : null,
    providers,
  });
}
