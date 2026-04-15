'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type UserConfigResponse = {
  config?: Record<string, string>;
  complete?: boolean;
};

export default function SetupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [twitchBroadcasterUsername, setTwitchBroadcasterUsername] = useState('');
  const [twitchBroadcasterId, setTwitchBroadcasterId] = useState('');

  const [discordLogChannelId, setDiscordLogChannelId] = useState('');
  const [discordAiChatChannelId, setDiscordAiChatChannelId] = useState('');
  const [discordShoutoutChannelId, setDiscordShoutoutChannelId] = useState('');
  const [discordShareChannelId, setDiscordShareChannelId] = useState('');
  const [discordMetricsChannelId, setDiscordMetricsChannelId] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/user-config', { cache: 'no-store' });
        const data = (await res.json().catch(() => ({}))) as UserConfigResponse;
        const cfg = data.config || {};

        if (cancelled) return;

        setTwitchBroadcasterUsername(cfg.TWITCH_BROADCASTER_USERNAME || '');
        setTwitchBroadcasterId(cfg.TWITCH_BROADCASTER_ID || cfg.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID || '');

        setDiscordLogChannelId(cfg.NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID || '');
        setDiscordAiChatChannelId(cfg.NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID || '');
        setDiscordShoutoutChannelId(cfg.NEXT_PUBLIC_DISCORD_SHOUTOUT_CHANNEL_ID || '');
        setDiscordShareChannelId(cfg.NEXT_PUBLIC_DISCORD_SHARE_CHANNEL_ID || '');
        setDiscordMetricsChannelId(cfg.NEXT_PUBLIC_DISCORD_METRICS_CHANNEL_ID || '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSaveAndContinue() {
    if (!twitchBroadcasterUsername.trim()) {
      return;
    }

    setSaving(true);
    try {
      await fetch('/api/user-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          TWITCH_BROADCASTER_USERNAME: twitchBroadcasterUsername,
          TWITCH_BROADCASTER_ID: twitchBroadcasterId,
          NEXT_PUBLIC_TWITCH_BROADCASTER_USERNAME: twitchBroadcasterUsername,
          NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID: twitchBroadcasterId,

          NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID: discordLogChannelId,
          NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID: discordAiChatChannelId,
          NEXT_PUBLIC_DISCORD_SHOUTOUT_CHANNEL_ID: discordShoutoutChannelId,
          NEXT_PUBLIC_DISCORD_SHARE_CHANNEL_ID: discordShareChannelId,
          NEXT_PUBLIC_DISCORD_METRICS_CHANNEL_ID: discordMetricsChannelId,
        }),
      });

      // Route through the home redirect so we land on /login if tokens are missing,
      // or /bot-functions if the user is already authenticated.
      router.push('/');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const canContinue = twitchBroadcasterUsername.trim().length > 0 && !saving;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>First-time Setup</CardTitle>
          <CardDescription>
            Fill in the user-specific info StreamWeaver needs. This is saved locally (tokens/user-config.json).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="twitchBroadcasterUsername">Twitch channel name (required)</Label>
            <Input
              id="twitchBroadcasterUsername"
              placeholder="your_twitch_username"
              value={twitchBroadcasterUsername}
              onChange={(e) => setTwitchBroadcasterUsername(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="twitchBroadcasterId">Twitch broadcaster ID (optional)</Label>
            <Input
              id="twitchBroadcasterId"
              placeholder="123456789"
              value={twitchBroadcasterId}
              onChange={(e) => setTwitchBroadcasterId(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discordLog">Discord log channel ID (optional)</Label>
            <Input
              id="discordLog"
              placeholder="123456789012345678"
              value={discordLogChannelId}
              onChange={(e) => setDiscordLogChannelId(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discordAi">Discord AI chat channel ID (optional)</Label>
            <Input
              id="discordAi"
              placeholder="123456789012345678"
              value={discordAiChatChannelId}
              onChange={(e) => setDiscordAiChatChannelId(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discordShoutout">Discord shoutout channel ID (optional)</Label>
            <Input
              id="discordShoutout"
              placeholder="123456789012345678"
              value={discordShoutoutChannelId}
              onChange={(e) => setDiscordShoutoutChannelId(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discordShare">Discord share channel ID (optional)</Label>
            <Input
              id="discordShare"
              placeholder="123456789012345678"
              value={discordShareChannelId}
              onChange={(e) => setDiscordShareChannelId(e.target.value)}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discordMetrics">Discord metrics channel ID (optional)</Label>
            <Input
              id="discordMetrics"
              placeholder="123456789012345678"
              value={discordMetricsChannelId}
              onChange={(e) => setDiscordMetricsChannelId(e.target.value)}
              disabled={loading || saving}
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button onClick={onSaveAndContinue} disabled={!canContinue}>
            {saving ? 'Saving…' : 'Save and Continue'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
