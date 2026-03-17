"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ExternalLink, CheckCircle, XCircle, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function IntegrationsPage() {
  const { toast } = useToast();
  const twitchConfigured = !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const [manualCode, setManualCode] = useState('');
  const [manualState, setManualState] = useState('login');
  const [twitchStatus, setTwitchStatus] = useState<{
    loading: boolean;
    broadcasterConnected: boolean;
    botConnected: boolean;
    communityBotConnected: boolean;
    appLoginConnected: boolean;
    broadcasterUsername: string | null;
    botUsername: string | null;
    communityBotUsername: string | null;
    appLoginUsername: string | null;
  }>({
    loading: true,
    broadcasterConnected: false,
    botConnected: false,
    communityBotConnected: false,
    appLoginConnected: false,
    broadcasterUsername: null,
    botUsername: null,
    communityBotUsername: null,
    appLoginUsername: null,
  });
  const [obsSettings, setObsSettings] = useState({
    ip: process.env.NEXT_PUBLIC_OBS_IP || "127.0.0.1",
    port: process.env.NEXT_PUBLIC_OBS_PORT || "4455",
    password: "",
    connected: false,
    busy: false,
  });

  const [platformStates, setPlatformStates] = useState({
    twitch: false,
    youtube: false,
    kick: false,
    tiktok: false,
    discord: false
  });

  const getLocalApiKey = () => window.localStorage.getItem('streamweaver.localApiKey') || '';

  const buildAuthHeaders = (json = true): HeadersInit => {
    const key = getLocalApiKey();
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (key) headers['X-API-Key'] = key;
    return headers;
  };

  const requireLocalApiKey = (): string | null => {
    const key = getLocalApiKey();
    if (!key) {
      toast({
        variant: 'destructive',
        title: 'Local API key required',
        description: 'Unlock Settings first to store your local API key, then retry this action.',
      });
      return null;
    }
    return key;
  };

  // Check for configured platforms via env variables
  useEffect(() => {
    const checkPlatformConfig = async () => {
      // Check if Twitch is configured via env
      const hasTwitchEnv = !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
      
      setPlatformStates(prev => ({
        ...prev,
        twitch: hasTwitchEnv,
        discord: false
      }));

      const key = getLocalApiKey();
      if (!key) return;

      try {
        const statusRes = await fetch('/api/platforms/status', {
          headers: buildAuthHeaders(false),
        });
        if (!statusRes.ok) return;
        const status = await statusRes.json();
        setPlatformStates(prev => ({
          ...prev,
          youtube: Boolean(status.youtubeConnected),
          kick: Boolean(status.kickConnected),
          tiktok: Boolean(status.tiktokConnected),
          discord: Boolean(status.discordConnected),
        }));
      } catch {
        // Keep defaults if status endpoint is unavailable.
      }
    };
    
    checkPlatformConfig();
  }, []);

  const handleManualTokenExchange = async () => {
    if (!requireLocalApiKey()) return;

    if (!manualCode.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please paste the callback URL' });
      return;
    }

    try {
      const url = new URL(manualCode);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || manualState;

      if (!code) {
        toast({ variant: 'destructive', title: 'Error', description: 'No authorization code found in URL' });
        return;
      }

      // Determine which platform based on state
      const platform = state.includes('twitch') ? 'twitch' : 
                      state.includes('youtube') ? 'youtube' : 
                      state.includes('discord') ? 'discord' : 'twitch';

      const response = await fetch(`/api/auth/${platform}/manual-exchange`, {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ code, state })
      });

      const result = await response.json();

      if (result.success) {
        toast({ title: 'Success!', description: `Connected ${result.username || 'account'} as ${result.role || state}` });
        setManualCode('');
        await refreshTwitchStatus();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to process token' });
    }
  };

  const refreshTwitchStatus = async () => {
    try {
      setTwitchStatus((prev) => ({ ...prev, loading: true }));
      const res = await fetch('/api/integrations/twitch/status');
      const data = await res.json();
      setTwitchStatus({
        loading: false,
        broadcasterConnected: !!data?.broadcasterConnected,
        botConnected: !!data?.botConnected,
        communityBotConnected: !!data?.communityBotConnected,
        appLoginConnected: !!data?.appLoginConnected,
        broadcasterUsername: data?.broadcasterUsername ?? null,
        botUsername: data?.botUsername ?? null,
        communityBotUsername: data?.communityBotUsername ?? null,
        appLoginUsername: data?.appLoginUsername ?? null,
      });
    } catch {
      setTwitchStatus((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    void refreshTwitchStatus();
  }, []);

  const connectTwitch = (role: 'broadcaster' | 'bot' | 'community-bot') => {
    if (!twitchConfigured) {
      toast({
        variant: 'destructive',
        title: 'Twitch not configured',
        description: 'Missing NEXT_PUBLIC_TWITCH_CLIENT_ID',
      });
      return;
    }
    window.location.href = `/api/auth/twitch?role=${role}`;
  };

  const disconnectTwitch = async (role: 'broadcaster' | 'bot' | 'community-bot') => {
    if (!requireLocalApiKey()) return;

    try {
      const res = await fetch('/api/integrations/twitch/disconnect', {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshTwitchStatus();
      toast({ title: 'Disconnected', description: `Twitch ${role} disconnected` });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Disconnect failed',
        description: String(error?.message || error),
      });
    }
  };

  const platforms = [
    { 
      id: "twitch",
      name: "Twitch", 
      connected: platformStates.twitch, 
      type: "streaming",
      authType: "oauth",
      description: "Stream to Twitch and interact with your chat"
    },
    { 
      id: "youtube",
      name: "YouTube", 
      connected: platformStates.youtube, 
      type: "streaming",
      authType: "oauth",
      description: "Stream to YouTube and manage live chat"
    },
    { 
      id: "kick",
      name: "Kick", 
      connected: platformStates.kick, 
      type: "streaming",
      authType: "username",
      description: "Connect to Kick.com chat (read-only)"
    },
    { 
      id: "tiktok",
      name: "TikTok", 
      connected: platformStates.tiktok, 
      type: "streaming",
      authType: "username",
      description: "Connect to TikTok Live (read-only)"
    },
    { 
      id: "discord",
      name: "Discord", 
      connected: platformStates.discord, 
      type: "chat",
      authType: "token",
      description: "Discord bot for commands and notifications"
    }
  ];

  const services = [
    { name: "OBS Studio", connected: obsSettings.connected, type: "broadcast" },
    { name: "Streamlabs", connected: false, type: "alerts" },
    { name: "StreamElements", connected: false, type: "alerts" },
    { name: "Nightbot", connected: false, type: "moderation" }
  ];

  const testAndSaveObs = async () => {
    if (!requireLocalApiKey()) return;

    const ip = obsSettings.ip.trim();
    const port = obsSettings.port.trim();
    const password = obsSettings.password;
    if (!ip || !port) {
      toast({ variant: "destructive", title: "Missing OBS settings", description: "Please provide IP and port." });
      return;
    }

    setObsSettings((prev) => ({ ...prev, busy: true }));
    try {
      const res = await fetch('/api/obs/test', {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ ip, port, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "OBS connection failed",
          description: data?.error ? String(data.error) : `HTTP ${res.status}`,
        });
        setObsSettings((prev) => ({ ...prev, connected: false }));
        return;
      }

      toast({ title: "OBS connected", description: data?.url ? String(data.url) : "Connection test succeeded" });
      setObsSettings((prev) => ({ ...prev, connected: true }));
    } catch (error: any) {
      toast({ variant: "destructive", title: "OBS connection failed", description: String(error?.message || error) });
      setObsSettings((prev) => ({ ...prev, connected: false }));
    } finally {
      setObsSettings((prev) => ({ ...prev, busy: false }));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Platform Connections</CardTitle>
          <CardDescription>Connect your streaming platforms and chat services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {platforms.map((platform) => (
            platform.id === 'twitch' ? (
              <div key={platform.id} className="p-4 border rounded space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {(twitchStatus.broadcasterConnected && twitchStatus.botConnected) ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-gray-400" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">Twitch</div>
                      <div className="text-sm text-muted-foreground">{platform.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twitchConfigured ? (
                      <Badge variant="outline">OAuth</Badge>
                    ) : (
                      <Badge variant="destructive">Missing Client ID</Badge>
                    )}
                    {twitchStatus.communityBotConnected && (
                      <Badge className="bg-purple-600">Community Bot</Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-3">
                    {twitchStatus.broadcasterConnected ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <div className="text-sm font-medium">Broadcaster</div>
                      <div className="text-xs text-muted-foreground">
                        {twitchStatus.broadcasterUsername ? `@${twitchStatus.broadcasterUsername}` : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twitchStatus.broadcasterConnected ? (
                      <>
                        <Badge className="bg-green-600">Connected</Badge>
                        <Button size="sm" variant="outline" onClick={() => void disconnectTwitch('broadcaster')}>
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => connectTwitch('broadcaster')}>
                        Connect
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-3">
                    {twitchStatus.botConnected ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <div className="text-sm font-medium">Stream Bot</div>
                      <div className="text-xs text-muted-foreground">
                        {twitchStatus.botUsername ? `@${twitchStatus.botUsername}` : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twitchStatus.botConnected ? (
                      <>
                        <Badge className="bg-green-600">Connected</Badge>
                        <Button size="sm" variant="outline" onClick={() => void disconnectTwitch('bot')}>
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => connectTwitch('bot')}>
                        Connect
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-3">
                    {twitchStatus.communityBotConnected ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <div className="text-sm font-medium">Community Bot</div>
                      <div className="text-xs text-muted-foreground">
                        {twitchStatus.communityBotUsername ? `@${twitchStatus.communityBotUsername}` : 'Not connected'}
                      </div>
                      <div className="text-xs text-purple-600 font-medium">For cross-stream games & community features</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twitchStatus.communityBotConnected ? (
                      <>
                        <Badge className="bg-green-600">Connected</Badge>
                        <Button size="sm" variant="outline" onClick={() => void disconnectTwitch('community-bot')}>
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => connectTwitch('community-bot')}>
                        Connect Community Bot
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-3">
                    {twitchStatus.appLoginConnected ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <div className="text-sm font-medium">App Login</div>
                      <div className="text-xs text-muted-foreground">
                        {twitchStatus.appLoginUsername ? `@${twitchStatus.appLoginUsername}` : 'Sign into StreamWeaver app'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twitchStatus.appLoginConnected ? (
                      <>
                        <Badge className="bg-green-600">Connected</Badge>
                        <Button size="sm" variant="outline" onClick={() => window.location.href = '/api/auth/signout'}>
                          Sign Out
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => window.location.href = '/api/auth/twitch?role=login'}>
                        Login to App
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div key={platform.id} className="flex items-center justify-between p-4 border rounded">
                <div className="flex items-center gap-3">
                  {platform.connected ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-gray-400" />
                  )}
                  <div className="flex-1">
                    <div className="font-medium">{platform.name}</div>
                    <div className="text-sm text-muted-foreground">{platform.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {platform.connected ? (
                    <>
                      <Badge className="bg-green-600">Connected</Badge>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={async () => {
                          if (platform.id === 'discord') {
                            toast({
                              title: 'Discord connection is env-based',
                              description: 'Update DISCORD_BOT_TOKEN to connect or disconnect Discord.',
                            });
                            return;
                          }

                          if (platform.id === 'youtube' || platform.id === 'kick' || platform.id === 'tiktok') {
                            if (!requireLocalApiKey()) return;

                            try {
                              const response = await fetch(`/api/platforms/${platform.id}/connect`, {
                                method: 'DELETE',
                                headers: buildAuthHeaders(false),
                              });

                              if (!response.ok) {
                                const data = await response.json().catch(() => ({}));
                                throw new Error(String(data?.error || `HTTP ${response.status}`));
                              }

                              setPlatformStates({ ...platformStates, [platform.id]: false });
                              toast({ title: `${platform.name} disconnected` });
                            } catch (error: any) {
                              toast({
                                variant: 'destructive',
                                title: `Failed to disconnect ${platform.name}`,
                                description: String(error?.message || error),
                              });
                            }
                            return;
                          }

                          setPlatformStates({ ...platformStates, [platform.id]: false });
                        }}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <>
                      {platform.authType === 'oauth' && (
                        <Button 
                          size="sm"
                          onClick={() => {
                            if (platform.id === 'youtube') {
                              window.location.href = '/api/auth/youtube?role=youtube-broadcaster';
                            }
                          }}
                        >
                          Connect via OAuth
                        </Button>
                      )}
                      {platform.authType === 'username' && (
                        <Button 
                          size="sm"
                          onClick={() => {
                            if (!requireLocalApiKey()) return;

                            const username = prompt(`Enter your ${platform.name} username:`);
                            if (username) {
                              fetch(`/api/platforms/${platform.id}/connect`, {
                                method: 'POST',
                                headers: buildAuthHeaders(),
                                body: JSON.stringify({ username })
                              }).then(async (response) => {
                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  throw new Error(String(data?.error || `HTTP ${response.status}`));
                                }
                                setPlatformStates({ ...platformStates, [platform.id]: true });
                                toast({ title: `${platform.name} connected`, description: `Connected as ${username}` });
                              }).catch((error: any) => {
                                toast({
                                  variant: 'destructive',
                                  title: `${platform.name} connection failed`,
                                  description: String(error?.message || error),
                                });
                              });
                            }
                          }}
                        >
                          Connect
                        </Button>
                      )}
                      {platform.authType === 'token' && (
                        <Badge variant="outline">Configured via ENV</Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OBS Studio Connection</CardTitle>
          <CardDescription>Connect to OBS WebSocket server for scene control and automation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="obs-ip">IP Address</Label>
              <Input
                id="obs-ip"
                value={obsSettings.ip}
                onChange={(e) => setObsSettings({...obsSettings, ip: e.target.value})}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obs-port">Port</Label>
              <Input
                id="obs-port"
                value={obsSettings.port}
                onChange={(e) => setObsSettings({...obsSettings, port: e.target.value})}
                placeholder="4455"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obs-password">Password (Optional)</Label>
            <Input
              id="obs-password"
              type="password"
              value={obsSettings.password}
              onChange={(e) => setObsSettings({...obsSettings, password: e.target.value})}
              placeholder="Leave empty if no password"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {obsSettings.connected ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-gray-400" />
              )}
              <span className="font-medium">
                {obsSettings.connected ? "Connected to OBS" : "Not Connected"}
              </span>
            </div>
            <Button 
              onClick={() => {
                if (obsSettings.connected) {
                  setObsSettings({ ...obsSettings, connected: false });
                  return;
                }
                void testAndSaveObs();
              }}
              disabled={obsSettings.busy}
              variant={obsSettings.connected ? "outline" : "default"}
            >
              {obsSettings.connected ? "Disconnect" : (obsSettings.busy ? "Connecting..." : "Connect")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Token Exchange</CardTitle>
          <CardDescription>If OAuth callback fails, paste the callback URL here</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="callback-url">Callback URL</Label>
            <Input
              id="callback-url"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Paste the full callback URL here (http://localhost:3100/auth/twitch/callback?code=...)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-role">Platform & Role</Label>
            <select 
              id="token-role"
              value={manualState} 
              onChange={(e) => setManualState(e.target.value)}
              className="w-full p-2 border rounded bg-background text-foreground"
            >
              <optgroup label="App Login">
                <option value="login">App Login - Sign into StreamWeaver</option>
              </optgroup>
              <optgroup label="Twitch">
                <option value="broadcaster">Twitch - Broadcaster</option>
                <option value="bot">Twitch - Bot</option>
                <option value="community-bot">Twitch - Community Bot</option>
              </optgroup>
              <optgroup label="YouTube">
                <option value="youtube-broadcaster">YouTube - Broadcaster</option>
                <option value="youtube-bot">YouTube - Bot</option>
              </optgroup>
              <optgroup label="Discord">
                <option value="discord-user">Discord - User OAuth</option>
                <option value="discord-bot">Discord - Bot Token</option>
              </optgroup>
              <optgroup label="Other Platforms">
                <option value="kick">Kick - Username</option>
                <option value="tiktok">TikTok - Username</option>
                <option value="facebook">Facebook - OAuth</option>
                <option value="instagram">Instagram - OAuth</option>
              </optgroup>
            </select>
          </div>
          <Button onClick={handleManualTokenExchange} className="w-full">
            Exchange Token
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Third-Party Services</CardTitle>
          <CardDescription>Connect additional streaming and moderation services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {services.map((service) => (
            <div key={service.name} className="flex items-center justify-between p-4 border rounded">
              <div className="flex items-center gap-3">
                {service.connected ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-gray-400" />
                )}
                <div>
                  <div className="font-medium">{service.name}</div>
                  <div className="text-sm text-muted-foreground capitalize">{service.type}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {service.connected ? (
                  <Badge className="bg-green-600">Connected</Badge>
                ) : (
                  <Button size="sm">Connect</Button>
                )}
                <Button size="sm" variant="ghost">
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Settings</CardTitle>
          <CardDescription>Configure WebSocket and HTTP servers for external integrations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded">
            <div>
              <div className="font-medium">WebSocket Server</div>
              <div className="text-sm text-muted-foreground">ws://localhost:8080</div>
            </div>
            <div className="flex items-center gap-2">
              <Switch defaultChecked />
              <Badge className="bg-green-600">Running</Badge>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 border rounded">
            <div>
              <div className="font-medium">HTTP Server</div>
              <div className="text-sm text-muted-foreground">http://localhost:7474</div>
            </div>
            <div className="flex items-center gap-2">
              <Switch defaultChecked />
              <Badge className="bg-green-600">Running</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}