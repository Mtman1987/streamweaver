'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type FleetTenant = {
  tenantId: string;
  broadcasterUsername: string;
  botUsername: string;
  hasBroadcasterToken: boolean;
  hasBotToken: boolean;
  botMode: 'dedicated' | 'community-fallback';
  effectiveBotName: string;
  configuredBotName: string | null;
  fallbackBotName: string | null;
  personalitySource: 'tenant' | 'community-default';
  savedPersonalityTemplateVersion: string | null;
  runtimePersonalityVersion: string;
  automaticallyUsesLatestRuntimePersonalityPolicy: boolean;
  commandCapabilities: {
    commandsConfigured: boolean;
    chatIdentity: 'dedicated-bot' | 'community-bot';
    clip: 'broadcaster-oauth' | 'twitch-reauth-required';
    channelManagement: 'broadcaster-oauth' | 'twitch-reauth-required';
    customBotIdentity: boolean;
  };
};

type FleetSummary = {
  totalTenants: number;
  dedicatedBots: number;
  communityFallbackBots: number;
  broadcasterAuthConfigured: number;
  twitchReauthNeeded: number;
  runtimePersonalityVersion: string;
};

type FleetData = {
  summary?: FleetSummary;
  tenants?: FleetTenant[];
};

type FleetResponse = FleetData & {
  data?: FleetData;
  error?: string | { message?: string };
};

function responseData(payload: FleetResponse): FleetData {
  return payload.data || payload;
}

export default function BotFleetPage() {
  const [payload, setPayload] = useState<FleetResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/tenants', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as FleetResponse;
        if (!response.ok) {
          const message = typeof body.error === 'string' ? body.error : body.error?.message;
          throw new Error(message || `Bot fleet returned ${response.status}`);
        }
        if (!cancelled) setPayload(body);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const data = payload ? responseData(payload) : null;
  const summary = data?.summary;
  const tenants = data?.tenants || [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Bot Fleet</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only inventory of tenant bot identity, personality runtime, and Twitch command authorization.
        </p>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Bot Fleet unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Loading bot fleet…</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <Card><CardHeader className="pb-2"><CardDescription>Tenants</CardDescription><CardTitle>{summary?.totalTenants ?? tenants.length}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Dedicated bots</CardDescription><CardTitle>{summary?.dedicatedBots ?? 0}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>StreamWeaver87 fallback</CardDescription><CardTitle>{summary?.communityFallbackBots ?? 0}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Broadcaster OAuth</CardDescription><CardTitle>{summary?.broadcasterAuthConfigured ?? 0}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Needs Twitch reauth</CardDescription><CardTitle>{summary?.twitchReauthNeeded ?? 0}</CardTitle></CardHeader></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tenant bots</CardTitle>
              <CardDescription>
                Runtime personality {summary?.runtimePersonalityVersion || 'current'} applies automatically even when a tenant saved an older prompt.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-2">Broadcaster</th>
                    <th className="p-2">Chat bot</th>
                    <th className="p-2">Transport</th>
                    <th className="p-2">Personality</th>
                    <th className="p-2">Saved template</th>
                    <th className="p-2">Runtime</th>
                    <th className="p-2">!clip</th>
                    <th className="p-2">Channel actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.tenantId} className="border-b align-top">
                      <td className="p-2">
                        <div className="font-medium">{tenant.broadcasterUsername || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{tenant.tenantId}</div>
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{tenant.effectiveBotName}</div>
                        {tenant.hasBotToken && tenant.botUsername ? <div className="text-xs text-muted-foreground">@{tenant.botUsername}</div> : null}
                      </td>
                      <td className="p-2">
                        <Badge variant={tenant.hasBotToken ? 'default' : 'secondary'}>
                          {tenant.hasBotToken ? 'Dedicated' : 'StreamWeaver87 fallback'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline">{tenant.personalitySource === 'tenant' ? 'Tenant personality' : 'Community default'}</Badge>
                      </td>
                      <td className="p-2">{tenant.savedPersonalityTemplateVersion || 'legacy/unversioned'}</td>
                      <td className="p-2"><Badge variant="outline">{tenant.runtimePersonalityVersion}</Badge></td>
                      <td className="p-2">
                        <Badge variant={tenant.commandCapabilities.clip === 'broadcaster-oauth' ? 'default' : 'destructive'}>
                          {tenant.commandCapabilities.clip === 'broadcaster-oauth' ? 'Broadcaster OAuth' : 'Reauth needed'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant={tenant.commandCapabilities.channelManagement === 'broadcaster-oauth' ? 'default' : 'destructive'}>
                          {tenant.commandCapabilities.channelManagement === 'broadcaster-oauth' ? 'Broadcaster OAuth' : 'Reauth needed'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
