'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

type Section = 'app' | 'twitch' | 'discord' | 'game' | 'economy' | 'automation' | 'redeems';

type ConfigPayload = Record<Section, Record<string, any>>;

const sections: Section[] = ['app', 'twitch', 'discord', 'game', 'economy', 'automation', 'redeems'];

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
  const [apiKey, setApiKey] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [working, setWorking] = useState<Record<Section, Record<string, string>> | null>(null);

  useEffect(() => {
    const savedKey = window.localStorage.getItem('streamweaver.localApiKey') || '';
    if (savedKey) {
      setApiKey(savedKey);
      void loadConfig(savedKey);
    }
  }, []);

  const activeSummary = useMemo(() => {
    if (!working) return [];
    return sections.map((section) => ({ section, count: Object.keys(working[section] || {}).length }));
  }, [working]);

  async function loadConfig(nextKey: string) {
    setLoading(true);
    try {
      const statusRes = await fetch('/api/local-auth/status', {
        headers: { 'X-API-Key': nextKey },
      });
      const status = await statusRes.json();
      if (!status.authorized) {
        setAuthorized(false);
        toast({ variant: 'destructive', title: 'Invalid API key' });
        return;
      }

      const response = await fetch('/api/local-config', {
        headers: { 'X-API-Key': nextKey },
      });

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
      window.localStorage.setItem('streamweaver.localApiKey', nextKey);
      toast({ title: 'Settings unlocked' });
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
          'X-API-Key': apiKey,
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
          <CardTitle>App Security</CardTitle>
          <CardDescription>Enter the app API key to manage settings. Requests must come from approved hosts and include this key.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="localApiKey">X-API-Key</Label>
            <Input
              id="localApiKey"
              type="password"
              value={apiKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              placeholder="Paste API key from config/app.json"
            />
          </div>
          <Button onClick={() => loadConfig(apiKey)} disabled={loading || !apiKey.trim()}>
            {loading ? 'Connecting...' : authorized ? 'Reconnect' : 'Unlock Settings'}
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

