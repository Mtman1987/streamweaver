'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Save } from 'lucide-react';

import { Switch } from '@/components/ui/switch';

interface ChannelSettings {
  logChannelId: string;
  shoutoutChannelId: string;
  discordBridgeEnabled?: boolean;
}

export function DiscordChannelSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ChannelSettings>({
    logChannelId: '',
    shoutoutChannelId: '',
    discordBridgeEnabled: false
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/discord/channels')
      .then(res => res.json())
      .then((data) => {
        setSettings({
          logChannelId: typeof data?.logChannelId === 'string' ? data.logChannelId : '',
          shoutoutChannelId: typeof data?.shoutoutChannelId === 'string' ? data.shoutoutChannelId : '',
          discordBridgeEnabled: Boolean(data?.discordBridgeEnabled),
        });
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
        <div>
          <Label htmlFor="logChannel">Chat Log Channel ID</Label>
          <Input
            id="logChannel"
            value={settings.logChannelId || ''}
            onChange={(e) => setSettings(prev => ({ ...prev, logChannelId: e.target.value }))}
            placeholder="1340315377774755890"
          />
          <Button 
            variant="destructive" 
            size="sm" 
            className="mt-2"
            onClick={() => clearChannel(settings.logChannelId, 'Chat Log')}
          >
            Clear Channel
          </Button>
        </div>
        <div>
          <Label htmlFor="shoutoutChannel">Shoutout Channel ID</Label>
          <Input
            id="shoutoutChannel"
            value={settings.shoutoutChannelId || ''}
            onChange={(e) => setSettings(prev => ({ ...prev, shoutoutChannelId: e.target.value }))}
            placeholder="1341946492696526858"
          />
          <Button 
            variant="destructive" 
            size="sm" 
            className="mt-2"
            onClick={() => clearChannel(settings.shoutoutChannelId, 'Shoutout')}
          >
            Clear Channel
          </Button>
        </div>
        <div className="flex items-center space-x-2">
          <Switch 
            id="discordBridge" 
            checked={settings.discordBridgeEnabled || false}
            onCheckedChange={(checked) => setSettings(prev => ({ ...prev, discordBridgeEnabled: checked }))}
          />
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
