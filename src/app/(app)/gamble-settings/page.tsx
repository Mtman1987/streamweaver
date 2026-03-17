'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

export default function GambleSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/classic-gamble');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      const res = await fetch('/api/classic-gamble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-settings', settings })
      });
      
      if (res.ok) {
        toast({ title: 'Settings Saved', description: 'Your gamble settings have been updated' });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save settings' });
    }
  };

  const resetSettings = () => {
    setSettings({
      useBot: true,
      sendAction: false,
      pointsVariable: 'points',
      currencyName: 'Points',
      defaultBet: 1234,
      minBet: 0,
      maxBet: 0,
      jackpotPercent: 3,
      jackpotMultiplier: 43,
      winPercent: 38,
      blockedGroups: '',
      numberSeparator: ',',
      useOverlay: false,
      overlayScene: 'Gamble Alerts',
      overlaySource: 'gamble-overlay',
      overlayDisplayMs: 5000
    });
    toast({ title: 'Settings Reset', description: 'Settings have been reset to defaults' });
  };

  if (loading || !settings) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>🎰 Classic Chat Gamble Settings</CardTitle>
          <CardDescription>Configure your gambling system</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="general">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="game">Game</TabsTrigger>
              <TabsTrigger value="overlay">Overlay</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.useBot}
                  onCheckedChange={(v) => setSettings({ ...settings, useBot: v })}
                />
                <Label>Use Bot Account</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.sendAction}
                  onCheckedChange={(v) => setSettings({ ...settings, sendAction: v })}
                />
                <Label>Send as /me Action</Label>
              </div>

              <div className="space-y-2">
                <Label>Number Separator</Label>
                <Input
                  value={settings.numberSeparator}
                  onChange={(e) => setSettings({ ...settings, numberSeparator: e.target.value })}
                  placeholder=","
                />
              </div>

              <div className="space-y-2">
                <Label>Blocked Groups (comma-separated)</Label>
                <Input
                  value={settings.blockedGroups}
                  onChange={(e) => setSettings({ ...settings, blockedGroups: e.target.value })}
                  placeholder="group1,group2"
                />
              </div>
            </TabsContent>

            <TabsContent value="game" className="space-y-4">
              <div className="space-y-2">
                <Label>Points Variable Name</Label>
                <Input
                  value={settings.pointsVariable}
                  onChange={(e) => setSettings({ ...settings, pointsVariable: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Currency Name</Label>
                <Input
                  value={settings.currencyName}
                  onChange={(e) => setSettings({ ...settings, currencyName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Bet</Label>
                  <Input
                    type="number"
                    value={settings.defaultBet}
                    onChange={(e) => setSettings({ ...settings, defaultBet: parseInt(e.target.value) })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Min Bet (0 = no limit)</Label>
                  <Input
                    type="number"
                    value={settings.minBet}
                    onChange={(e) => setSettings({ ...settings, minBet: parseInt(e.target.value) })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Max Bet (0 = no limit)</Label>
                  <Input
                    type="number"
                    value={settings.maxBet}
                    onChange={(e) => setSettings({ ...settings, maxBet: parseInt(e.target.value) })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Jackpot Chance (%)</Label>
                  <Input
                    type="number"
                    value={settings.jackpotPercent}
                    onChange={(e) => setSettings({ ...settings, jackpotPercent: parseInt(e.target.value) })}
                    max={100}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Jackpot Multiplier</Label>
                  <Input
                    type="number"
                    value={settings.jackpotMultiplier}
                    onChange={(e) => setSettings({ ...settings, jackpotMultiplier: parseInt(e.target.value) })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Win Chance (%)</Label>
                  <Input
                    type="number"
                    value={settings.winPercent}
                    onChange={(e) => setSettings({ ...settings, winPercent: parseInt(e.target.value) })}
                    max={100}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="overlay" className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.useOverlay}
                  onCheckedChange={(v) => setSettings({ ...settings, useOverlay: v })}
                />
                <Label>Enable Overlay</Label>
              </div>

              <div className="space-y-2">
                <Label>OBS Scene Name</Label>
                <Input
                  value={settings.overlayScene}
                  onChange={(e) => setSettings({ ...settings, overlayScene: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>OBS Source Name</Label>
                <Input
                  value={settings.overlaySource}
                  onChange={(e) => setSettings({ ...settings, overlaySource: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Display Duration (ms)</Label>
                <Input
                  type="number"
                  value={settings.overlayDisplayMs}
                  onChange={(e) => setSettings({ ...settings, overlayDisplayMs: parseInt(e.target.value) })}
                />
              </div>
            </TabsContent>

            <TabsContent value="about" className="space-y-4">
              <div>
                <h3 className="text-lg font-bold">Classic Chat Gamble v8</h3>
                <p className="text-sm text-muted-foreground">StreamWeaver Edition</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm">
                  <strong>Tip:</strong> Users can use <code>all</code>, <code>half</code>, <code>third</code>,{' '}
                  <code>quarter</code>, and <code>random</code> as bet amounts.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Original by yBO/aaskjer for Streamer.bot
                </p>
                <p className="text-sm text-muted-foreground">
                  Converted to StreamWeaver TypeScript
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={resetSettings}>
              Reset to Defaults
            </Button>
            <Button onClick={saveSettings}>
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
