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
import Link from 'next/link';

interface ChannelSettings {
  logChannelId: string;
  shoutoutChannelId: string;
  dmChannelId: string;
  discordBridgeEnabled?: boolean;
}

interface GenerationSettings {
  mode: 'eden' | 'seaart' | 'perchance';
  model: string;
  lora: string;
  loraStrength: number;
  imageCount: number;
  resolution: string;
  steps: number;
  cfg: number;
  seed: number;
}

const defaultGenSettings: GenerationSettings = {
  mode: 'eden',
  model: '',
  lora: '',
  loraStrength: 0.7,
  imageCount: 1,
  resolution: '1024x1024',
  steps: 30,
  cfg: 7,
  seed: 0,
};

export function DiscordChannelSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ChannelSettings>({
    logChannelId: '',
    shoutoutChannelId: '',
    dmChannelId: '1416041303707353119',
    discordBridgeEnabled: false
  });
  const [loading, setLoading] = useState(false);
  const [seaartToken, setSeaartToken] = useState('');
  const [genSettings, setGenSettings] = useState<GenerationSettings>(defaultGenSettings);
  const [genDialogOpen, setGenDialogOpen] = useState(false);

  useEffect(() => {
    fetch('/api/discord/channels')
      .then(res => res.json())
      .then((data) => {
        setSettings({
          logChannelId: typeof data?.logChannelId === 'string' ? data.logChannelId : '',
          shoutoutChannelId: typeof data?.shoutoutChannelId === 'string' ? data.shoutoutChannelId : '',
          dmChannelId: typeof data?.dmChannelId === 'string' ? data.dmChannelId : '1416041303707353119',
          discordBridgeEnabled: Boolean(data?.discordBridgeEnabled),
        });
      })
      .catch(console.error);

    fetch('/api/seaart/token')
      .then(res => res.json())
      .then((data) => {
        if (data?.configured) setSeaartToken(data?.preview || 'configured');
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
      const response = await fetch('/api/discord/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
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
                  <Input value={genSettings.mode} onChange={(e) => setGenSettings(prev => ({ ...prev, mode: (e.target.value as any) }))} placeholder="eden | seaart | perchance" />
                  <p className="text-xs text-muted-foreground mt-1">Active generator backend default.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Model</Label>
                    <Link href="/generation/models" className="text-xs text-indigo-400 hover:text-indigo-300">Browse models</Link>
                  </div>
                  <Input value={genSettings.model} onChange={(e) => setGenSettings(prev => ({ ...prev, model: e.target.value }))} placeholder="Model id/name" />
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
                  <Input type="number" step="0.1" value={genSettings.loraStrength} onChange={(e) => setGenSettings(prev => ({ ...prev, loraStrength: Number(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>Image count (1-4)</Label>
                  <Input type="number" min={1} max={4} value={genSettings.imageCount} onChange={(e) => setGenSettings(prev => ({ ...prev, imageCount: Number(e.target.value) || 1 }))} />
                </div>
                <div>
                  <Label>Resolution</Label>
                  <Input value={genSettings.resolution} onChange={(e) => setGenSettings(prev => ({ ...prev, resolution: e.target.value }))} placeholder="1024x1024" />
                </div>
                <div>
                  <Label>Steps</Label>
                  <Input type="number" value={genSettings.steps} onChange={(e) => setGenSettings(prev => ({ ...prev, steps: Number(e.target.value) || 30 }))} />
                </div>
                <div>
                  <Label>CFG</Label>
                  <Input type="number" step="0.1" value={genSettings.cfg} onChange={(e) => setGenSettings(prev => ({ ...prev, cfg: Number(e.target.value) || 7 }))} />
                </div>
                <div className="col-span-2">
                  <Label>Seed</Label>
                  <Input type="number" value={genSettings.seed} onChange={(e) => setGenSettings(prev => ({ ...prev, seed: Number(e.target.value) || 0 }))} />
                </div>
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
          <Input id="seaartToken" value={seaartToken} onChange={(e) => setSeaartToken(e.target.value)} placeholder="Paste SeaArt T cookie token" />
          <p className="text-xs text-muted-foreground mt-1">Saved in tenant user-config.json as SEAART_TOKEN for short-term testing.</p>
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => {
              try {
                const res = await fetch('/api/seaart/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: seaartToken }),
                });
                if (!res.ok) throw new Error('Failed to save');
                toast({ title: 'SeaArt token saved', description: 'SEAART_TOKEN stored for this tenant.' });
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
