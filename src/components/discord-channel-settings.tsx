'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Save, SlidersHorizontal } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { getClientTenantId } from '@/lib/client-tenant';

interface ChannelSettings {
  logChannelId: string;
  shoutoutChannelId: string;
  dmChannelId: string;
  discordBridgeEnabled?: boolean;
}

interface GenerationSettings {
  mode: 'eden' | 'seaart' | 'perchance' | 'pollinations';
  model: string;
  seaartCharacterId: string;
  lora: string;
  loraStrength: number;
  imageCount: number;
  resolution: string;
  steps: number;
  cfg: number;
  seed: number;
  optimizeImagePrompts: boolean;
  showOptimizedPrompt: boolean;
  imagePromptTemplate: string;
}

const defaultGenSettings: GenerationSettings = {
  mode: 'eden',
  model: '',
  seaartCharacterId: '',
  lora: '',
  loraStrength: 0.7,
  imageCount: 1,
  resolution: '1024x1024',
  steps: 30,
  cfg: 7,
  seed: 0,
  optimizeImagePrompts: true,
  showOptimizedPrompt: false,
  imagePromptTemplate: [
    'Rewrite the user idea into one concise image-generation prompt.',
    'Preserve the user intent and do not add unrelated subjects.',
    'Add useful visual detail: subject, medium/style, composition, lighting, background, mood, color, and quality cues.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
  ].join('\n'),
};

function discordChannelsUrl() {
  const tenantId = getClientTenantId();
  return tenantId ? `/api/discord/channels?tenantId=${encodeURIComponent(tenantId)}` : '/api/discord/channels';
}

export function DiscordChannelSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ChannelSettings>({
    logChannelId: '',
    shoutoutChannelId: '',
    dmChannelId: '',
    discordBridgeEnabled: false
  });
  const [loading, setLoading] = useState(false);
  const [seaartToken, setSeaartToken] = useState('');
  const [seaartTokenPreview, setSeaartTokenPreview] = useState('');
  const [genSettings, setGenSettings] = useState<GenerationSettings>(defaultGenSettings);
  const [genDialogOpen, setGenDialogOpen] = useState(false);

  useEffect(() => {
    fetch(discordChannelsUrl())
      .then(res => res.json())
      .then((data) => {
        setSettings({
          logChannelId: typeof data?.logChannelId === 'string' ? data.logChannelId : '',
          shoutoutChannelId: typeof data?.shoutoutChannelId === 'string' ? data.shoutoutChannelId : '',
          dmChannelId: typeof data?.dmChannelId === 'string' ? data.dmChannelId : '',
          discordBridgeEnabled: Boolean(data?.discordBridgeEnabled),
        });
      })
      .catch(console.error);

    fetch('/api/seaart/token')
      .then(res => res.json())
      .then((data) => {
        // Never load the masked preview into the input — it would otherwise be
        // POSTed back as the new token and corrupt SEAART_TOKEN.
        if (data?.configured) setSeaartTokenPreview(data?.preview || 'configured');
      })
      .catch(console.error);

    fetch('/api/gen-settings')
      .then(res => res.json())
      .then((data) => {
        setGenSettings({ ...defaultGenSettings, ...data });
      })
      .catch(console.error);
  }, []);

  const clearChannel = async (channelId: string, channelName: string) => {
    if (!channelId) {
      toast({ variant: 'destructive', title: 'Error', description: 'No channel ID provided' });
      return;
    }

    if (!confirm(`Are you sure you want to clear ALL messages from ${channelName} channel?`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/discord-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, action: 'cleanup' })
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: 'Channel cleared',
          description: `Deleted ${result.deletedCount} messages from ${channelName}`
        });
      } else {
        throw new Error('Failed to clear channel');
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to clear channel' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const tenantId = getClientTenantId();
      const response = await fetch('/api/discord/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, tenantId: tenantId || undefined })
      });

      if (response.ok) {
        toast({ title: 'Settings saved', description: 'Discord channels updated successfully' });
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save settings' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord Channels</CardTitle>
        <CardDescription>Configure Discord channel IDs for different features</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Generation Defaults</Label>
            <p className="text-xs text-muted-foreground">Tenant-scoped defaults used by !img in DMs.</p>
          </div>
          <Dialog open={genDialogOpen} onOpenChange={setGenDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4 mr-1" />Settings</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Generation Settings</DialogTitle>
                <DialogDescription>Set default provider/model/LoRA/image options used when users run !img.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Provider mode</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={genSettings.mode} onChange={(e) => setGenSettings(prev => ({ ...prev, mode: e.target.value as GenerationSettings['mode'] }))}>
                    <option value="eden">eden</option>
                    <option value="seaart">seaart</option>
                    <option value="pollinations">pollinations/free</option>
                    <option value="perchance">perchance</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">Active generator backend default.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Image model</Label>
                    <Link href="/generation/models" className="text-xs text-indigo-400 hover:text-indigo-300">Browse models</Link>
                  </div>
                  <Input value={genSettings.model} onChange={(e) => setGenSettings(prev => ({ ...prev, model: e.target.value }))} placeholder="Preset or modelNo:modelVerNo" />
                </div>
                <div>
                  <Label>SeaArt character ID</Label>
                  <Input value={genSettings.seaartCharacterId} onChange={(e) => setGenSettings(prev => ({ ...prev, seaartCharacterId: e.target.value }))} placeholder="Paste a SeaArt character ID or URL" />
                  <p className="text-xs text-muted-foreground mt-1">When set, private app chat and Discord DMs use this SeaArt character instead of EdenAI.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>LoRA</Label>
                    <Link href="/generation/loras" className="text-xs text-indigo-400 hover:text-indigo-300">Browse LoRAs</Link>
                  </div>
                  <Input value={genSettings.lora} onChange={(e) => setGenSettings(prev => ({ ...prev, lora: e.target.value }))} placeholder="LoRA id/name" />
                </div>
                <div>
                  <Label>LoRA strength</Label>
                  <Input type="number" step="0.1" min={0} max={2} value={genSettings.loraStrength} onChange={(e) => setGenSettings(prev => ({ ...prev, loraStrength: Number(e.target.value) || 0 }))} />
                  <p className="text-xs text-muted-foreground mt-1">Range: 0.0 to 2.0</p>
                </div>
                <div>
                  <Label>Image count (1-4)</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={genSettings.imageCount} onChange={(e) => setGenSettings(prev => ({ ...prev, imageCount: Number(e.target.value) || 1 }))}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </div>
                <div>
                  <Label>Resolution</Label>
                  <Input value={genSettings.resolution} onChange={(e) => setGenSettings(prev => ({ ...prev, resolution: e.target.value }))} placeholder="1024x1024" />
                </div>
                <div>
                  <Label>Steps</Label>
                  <Input type="number" min={1} max={150} value={genSettings.steps} onChange={(e) => setGenSettings(prev => ({ ...prev, steps: Number(e.target.value) || 30 }))} />
                  <p className="text-xs text-muted-foreground mt-1">Typical: 20-40</p>
                </div>
                <div>
                  <Label>CFG</Label>
                  <Input type="number" step="0.1" min={1} max={30} value={genSettings.cfg} onChange={(e) => setGenSettings(prev => ({ ...prev, cfg: Number(e.target.value) || 7 }))} />
                  <p className="text-xs text-muted-foreground mt-1">Range: 1 to 30</p>
                </div>
                <div className="col-span-2">
                  <Label>Seed</Label>
                  <Input type="number" value={genSettings.seed} onChange={(e) => setGenSettings(prev => ({ ...prev, seed: Number(e.target.value) || 0 }))} />
                </div>
                <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <Label>Optimize !img prompts</Label>
                    <p className="text-xs text-muted-foreground">Short user ideas are polished before image generation.</p>
                  </div>
                  <Switch checked={genSettings.optimizeImagePrompts} onCheckedChange={(checked) => setGenSettings(prev => ({ ...prev, optimizeImagePrompts: checked }))} />
                </div>
                <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <Label>Show optimized prompt</Label>
                    <p className="text-xs text-muted-foreground">Send the rewritten prompt before image links.</p>
                  </div>
                  <Switch checked={genSettings.showOptimizedPrompt} onCheckedChange={(checked) => setGenSettings(prev => ({ ...prev, showOptimizedPrompt: checked }))} />
                </div>
                <div className="col-span-2">
                  <Label>Prompt optimizer instruction</Label>
                  <Textarea rows={6} value={genSettings.imagePromptTemplate} onChange={(e) => setGenSettings(prev => ({ ...prev, imagePromptTemplate: e.target.value }))} />
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                <div className="font-medium">Effective !img defaults preview</div>
                <div>mode={genSettings.mode} | model={genSettings.model || "(provider default)"} | lora={genSettings.lora || "(none)"}</div>
                <div>count={genSettings.imageCount} | resolution={genSettings.resolution} | steps={genSettings.steps} | cfg={genSettings.cfg} | seed={genSettings.seed || 0}</div>
              </div>
              <DialogFooter>
                <Button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/gen-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(genSettings),
                      });
                      if (!res.ok) throw new Error('save failed');
                      const saved = await res.json();
                      setGenSettings({ ...defaultGenSettings, ...saved });
                      toast({ title: 'Generation settings saved', description: 'Defaults updated for this tenant.' });
                      setGenDialogOpen(false);
                    } catch {
                      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save generation settings' });
                    }
                  }}
                >Save Generation Settings</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div>
          <Label htmlFor="logChannel">Chat Log Channel ID</Label>
          <Input id="logChannel" value={settings.logChannelId || ''} onChange={(e) => setSettings(prev => ({ ...prev, logChannelId: e.target.value }))} placeholder="1340315377774755890" />
          <Button variant="destructive" size="sm" className="mt-2" onClick={() => clearChannel(settings.logChannelId, 'Chat Log')}>Clear Channel</Button>
        </div>
        <div>
          <Label htmlFor="shoutoutChannel">Shoutout Channel ID</Label>
          <Input id="shoutoutChannel" value={settings.shoutoutChannelId || ''} onChange={(e) => setSettings(prev => ({ ...prev, shoutoutChannelId: e.target.value }))} placeholder="1341946492696526858" />
          <Button variant="destructive" size="sm" className="mt-2" onClick={() => clearChannel(settings.shoutoutChannelId, 'Shoutout')}>Clear Channel</Button>
        </div>
        <div>
          <Label htmlFor="dmChannel">DM Channel ID</Label>
          <Input id="dmChannel" value={settings.dmChannelId || ''} onChange={(e) => setSettings(prev => ({ ...prev, dmChannelId: e.target.value }))} placeholder="1416041303707353119" />
          <p className="text-xs text-muted-foreground mt-1">Used for DM fallback polling/routing when external DM webhooks are unavailable.</p>
        </div>

        <div>
          <Label htmlFor="seaartToken">SeaArt Token (T cookie)</Label>
          <Input
            id="seaartToken"
            type="password"
            value={seaartToken}
            onChange={(e) => setSeaartToken(e.target.value)}
            placeholder={seaartTokenPreview ? `Currently configured (${seaartTokenPreview}). Paste a new token to replace.` : 'Paste SeaArt T cookie token'}
          />
          <p className="text-xs text-muted-foreground mt-1">Saved in tenant user-config.json as SEAART_TOKEN for short-term testing.</p>
          <Button
            size="sm"
            className="mt-2"
            disabled={!seaartToken.trim()}
            onClick={async () => {
              const next = seaartToken.trim();
              if (!next) {
                toast({ variant: 'destructive', title: 'Error', description: 'Paste a token before saving' });
                return;
              }
              try {
                const res = await fetch('/api/seaart/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: next }),
                });
                if (!res.ok) throw new Error('Failed to save');
                toast({ title: 'SeaArt token saved', description: 'SEAART_TOKEN stored for this tenant.' });
                setSeaartToken('');
                // Refresh preview after save
                const refreshed = await fetch('/api/seaart/token').then(r => r.json()).catch(() => null);
                if (refreshed?.configured) setSeaartTokenPreview(refreshed?.preview || 'configured');
              } catch {
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to save SeaArt token' });
              }
            }}
          >
            Save SeaArt Token
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <Switch id="discordBridge" checked={settings.discordBridgeEnabled || false} onCheckedChange={(checked) => setSettings(prev => ({ ...prev, discordBridgeEnabled: checked }))} />
          <Label htmlFor="discordBridge">Enable Discord Bridge</Label>
        </div>
        <Button onClick={handleSave} disabled={loading}>
          <Save className="mr-2 h-4 w-4" />
          {loading ? 'Saving...' : 'Save Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}
