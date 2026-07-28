'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { useWorkspaceTheme } from '@/components/workspace-theme-provider';

type Section = 'app' | 'twitch' | 'discord' | 'game' | 'economy' | 'automation' | 'obs' | 'redeems';

type ConfigPayload = Record<Section, Record<string, any>>;

const sections: Section[] = ['app', 'twitch', 'discord', 'game', 'economy', 'automation', 'obs', 'redeems'];

function flattenObject(input: Record<string, any>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v, key));
    } else {
      out[key] = String(v ?? '');
    }
  }
  return out;
}

function unflattenObject(input: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [dotted, raw] of Object.entries(input)) {
    const keys = dotted.split('.');
    let cursor = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const part = keys[i];
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part];
    }

    const leaf = keys[keys.length - 1];
    if (raw === 'true') cursor[leaf] = true;
    else if (raw === 'false') cursor[leaf] = false;
    else if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) cursor[leaf] = Number(raw);
    else cursor[leaf] = raw;
  }
  return out;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const workspaceTheme = useWorkspaceTheme();
  const [apiKey, setApiKey] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [working, setWorking] = useState<Record<Section, Record<string, string>> | null>(null);

  useEffect(() => {
    void loadConfig('');
  }, []);

  const activeSummary = useMemo(() => {
    if (!working) return [];
    return sections.map((section) => ({ section, count: Object.keys(working[section] || {}).length }));
  }, [working]);

  async function loadConfig(nextKey: string) {
    setLoading(true);
    try {
      const response = await fetch('/api/local-config');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const cfg = data.config as ConfigPayload;
      setConfig(cfg);

      const mapped = {} as Record<Section, Record<string, string>>;
      for (const section of sections) {
        mapped[section] = flattenObject(cfg[section] || {});
      }
      setWorking(mapped);

      setAuthorized(true);
      toast({ title: 'Settings loaded' });
    } catch (error: any) {
      setAuthorized(false);
      toast({ variant: 'destructive', title: 'Failed to load config', description: String(error?.message || error) });
    } finally {
      setLoading(false);
    }
  }

  function updateField(section: Section, key: string, value: string) {
    setWorking((prev: Record<Section, Record<string, string>> | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        [section]: {
          ...prev[section],
          [key]: value,
        },
      };
    });
  }

  async function saveSection(section: Section) {
    if (!working) return;

    setLoading(true);
    try {
      const payload = unflattenObject(working[section]);
      const response = await fetch(`/api/local-config/${section}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `HTTP ${response.status}`));
      }

      const flattened = flattenObject((data.config || {}) as Record<string, any>);
      setWorking((prev: Record<Section, Record<string, string>> | null) => {
        if (!prev) return prev;
        return {
          ...prev,
          [section]: flattened,
        };
      });

      toast({ title: `${section}.json updated` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: String(error?.message || error) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SpaceMountain Workspace Theme</CardTitle>
          <CardDescription>
            Apply your signed-in SpaceMountain colors, radius, density, and motion settings throughout StreamWeaver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="follow-workspace-theme">Follow SpaceMountain theme</Label>
            <Switch
              id="follow-workspace-theme"
              checked={workspaceTheme.followWorkspaceTheme}
              disabled={workspaceTheme.status === 'saving'}
              onCheckedChange={(checked) => void workspaceTheme.setFollowWorkspaceTheme(checked)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {workspaceTheme.status === 'loading' && 'Loading your shared workspace theme…'}
            {workspaceTheme.status === 'saving' && 'Saving your theme preference to SPMT…'}
            {workspaceTheme.status === 'applied' && 'Using your SpaceMountain workspace theme.'}
            {workspaceTheme.status === 'local' && 'Using StreamWeaver’s local visual theme.'}
          </p>
          {workspaceTheme.error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
              <span>{workspaceTheme.error}</span>
              <div className="flex items-center gap-2">
                {workspaceTheme.reconnectUrl && (
                  <Button type="button" variant="default" size="sm" asChild>
                    <a href={workspaceTheme.reconnectUrl}>Reconnect SpaceMountain</a>
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => void workspaceTheme.retry()}>Retry</Button>
              </div>
            </div>
          )}
          <div className="grid gap-4 border-t pt-4 md:grid-cols-3">
            {([
              ['glowStrength', 'Glow trim', 40, 160],
              ['surfaceOpacity', 'Panel opacity trim', 45, 125],
              ['uiScale', 'UI scale', 85, 115],
            ] as const).map(([key, label, min, max]) => (
              <label key={key} className="space-y-2 text-xs font-medium">
                <span className="flex justify-between gap-3">
                  <span>{label}</span>
                  <span className="text-muted-foreground">{workspaceTheme.visualTuning[key]}%</span>
                </span>
                <input
                  className="w-full accent-primary"
                  type="range"
                  min={min}
                  max={max}
                  value={workspaceTheme.visualTuning[key]}
                  onChange={(event) => void workspaceTheme.setVisualTuning({
                    ...workspaceTheme.visualTuning,
                    [key]: Number(event.target.value),
                  })}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            These trims belong to StreamWeaver. They layer over the shared SpaceMountain theme so this app can compensate for a monitor or embed without changing the rest of the suite.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App Settings</CardTitle>
          <CardDescription>Manage your StreamWeaver configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => loadConfig('')} disabled={loading}>
            {loading ? 'Loading...' : authorized ? 'Reload Settings' : 'Load Settings'}
          </Button>
        </CardContent>
      </Card>

      {authorized && working && (
        <Card>
          <CardHeader>
            <CardTitle>Config Files</CardTitle>
            <CardDescription>These values are stored in the local `config/*.json` files. Secret fields are masked on read.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-xs text-muted-foreground">
              {activeSummary.map((item: { section: Section; count: number }) => `${item.section}: ${item.count} fields`).join(' | ')}
            </div>
            <Tabs defaultValue="app" className="space-y-4">
              <TabsList>
                {sections.map((section) => (
                  <TabsTrigger key={section} value={section}>{section}</TabsTrigger>
                ))}
              </TabsList>

              {sections.map((section) => (
                <TabsContent key={section} value={section}>
                  <div className="space-y-4">
                    {Object.entries(working[section] || {}).map(([key, value]) => (
                      <div className="grid gap-2" key={`${section}-${key}`}>
                        <Label htmlFor={`${section}-${key}`}>{key}</Label>
                        <Input
                          id={`${section}-${key}`}
                          value={value}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField(section, key, e.target.value)}
                          type={/apiKey|token|secret|password/i.test(key) ? 'password' : 'text'}
                        />
                      </div>
                    ))}
                    <Button onClick={() => saveSection(section)} disabled={loading}>
                      {loading ? 'Saving...' : `Save ${section}.json`}
                    </Button>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {authorized && config && (
        <Card>
          <CardHeader>
            <CardTitle>Migration Notes</CardTitle>
            <CardDescription>Legacy values from `.env` and `tokens/user-config.json` were merged into config files where available.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You can keep using existing features while progressively moving integrations to the new `config` layer.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

