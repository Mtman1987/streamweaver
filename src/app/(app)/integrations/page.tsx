"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Circle, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getEnvironmentAppUrl } from "@/lib/app-urls";

// --- Shared sub-row component ---
function AccountRow({
  connected,
  label,
  username,
  description,
  children,
}: {
  connected: boolean;
  label: string;
  username?: string | null;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {connected ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {username && (
              <span className="text-sm text-muted-foreground">@{username}</span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}



export default function IntegrationsPage() {
  const { toast } = useToast();
  const appOrigin = typeof window !== "undefined" ? window.location.origin : getEnvironmentAppUrl();
  const twitchConfigured = !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;

  const [manualCode, setManualCode] = useState("");
  const [manualState, setManualState] = useState("broadcaster");
  const [manualOpen, setManualOpen] = useState(false);

  const [twitchStatus, setTwitchStatus] = useState<{
    loading: boolean;
    broadcasterConnected: boolean;
    botConnected: boolean;
    communityBotConnected: boolean;
    broadcasterUsername: string | null;
    botUsername: string | null;
    communityBotUsername: string | null;
  }>({
    loading: true,
    broadcasterConnected: false,
    botConnected: false,
    communityBotConnected: false,
    broadcasterUsername: null,
    botUsername: null,
    communityBotUsername: null,
  });

  const [kickStatus, setKickStatus] = useState<{
    broadcasterConnected: boolean;
    botConnected: boolean;
    broadcasterUsername: string | null;
    botUsername: string | null;
    channelConnected: boolean;
  }>({
    broadcasterConnected: false,
    botConnected: false,
    broadcasterUsername: null,
    botUsername: null,
    channelConnected: false,
  });

  const [kickTesting, setKickTesting] = useState(false);

  const [obsSettings, setObsSettings] = useState({
    ip: process.env.NEXT_PUBLIC_OBS_IP || "127.0.0.1",
    port: process.env.NEXT_PUBLIC_OBS_PORT || "4455",
    password: "",
    connected: false,
    busy: false,
  });

  const [obsScenes, setObsScenes] = useState({
    live: "", brb: "", starting: "", ending: "", chatting: "", gaming: "",
  });
  const [obsScenesBusy, setObsScenesBusy] = useState(false);

  // --- Data fetching ---
  useEffect(() => {
    fetch("/api/integrations/kick/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setKickStatus(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/obs/scenes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.scenes) setObsScenes((s) => ({ ...s, ...data.scenes })); })
      .catch(() => {});
  }, []);

  const refreshTwitchStatus = async () => {
    try {
      setTwitchStatus((prev) => ({ ...prev, loading: true }));
      const res = await fetch("/api/integrations/twitch/status");
      const data = await res.json();
      setTwitchStatus({
        loading: false,
        broadcasterConnected: !!data?.broadcasterConnected,
        botConnected: !!data?.botConnected,
        communityBotConnected: !!data?.communityBotConnected,
        broadcasterUsername: data?.broadcasterUsername ?? null,
        botUsername: data?.botUsername ?? null,
        communityBotUsername: data?.communityBotUsername ?? null,
      });
    } catch {
      setTwitchStatus((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    void refreshTwitchStatus();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const errorMsg = params.get("msg");
      if (errorMsg) {
        toast({ variant: "destructive", title: "Connection Error", description: decodeURIComponent(errorMsg) });
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  // --- Actions ---
  const connectTwitch = (role: "broadcaster" | "bot" | "community-bot") => {
    if (!twitchConfigured) {
      toast({ variant: "destructive", title: "Twitch not configured", description: "Missing NEXT_PUBLIC_TWITCH_CLIENT_ID" });
      return;
    }
    if (role === "bot") {
      toast({ title: "⚠️ Use your BOT account", description: "Sign in as your BOT account on the Twitch login page — not your broadcaster account." });
    }
    window.location.href = `/api/auth/twitch?role=${role}`;
  };

  const disconnectTwitch = async (role: "broadcaster" | "bot" | "community-bot") => {
    try {
      const res = await fetch("/api/integrations/twitch/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshTwitchStatus();
      toast({ title: "Disconnected", description: `Twitch ${role} disconnected` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Disconnect failed", description: String(error?.message || error) });
    }
  };

  const testKickConnection = async () => {
    setKickTesting(true);
    try {
      const res = await fetch("/api/integrations/kick/test", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "✅ Kick test passed", description: "Check your Kick chat for the test message." });
      } else {
        toast({ variant: "destructive", title: "Test failed", description: data?.error || "Could not send message" });
      }
    } catch {
      toast({ variant: "destructive", title: "Test failed", description: "Network error" });
    } finally {
      setKickTesting(false);
    }
  };

  const connectKickChat = async () => {
    const username = kickStatus.broadcasterUsername || prompt("Enter your Kick channel username:");
    if (!username) return;

    // Fetch chatroom ID from browser (not blocked like server-side)
    let chatroomId: number | null = null;
    let channelId: number | null = null;
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${username}`);
      if (res.ok) {
        const data = await res.json();
        chatroomId = data.chatroom?.id;
        channelId = data.id;
      }
    } catch {}

    fetch("/api/platforms/kick/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, chatroomId, channelId }),
    }).then(async (res) => {
      if (res.ok) {
        setKickStatus((s) => ({ ...s, channelConnected: true }));
        toast({ title: "Kick connected", description: `Listening to ${username}'s chat` });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Failed", description: d.error || "Connection failed" });
      }
    }).catch(() => toast({ variant: "destructive", title: "Connection failed" }));
  };

  const testAndSaveObs = async () => {
    const { ip, port, password } = obsSettings;
    if (!ip.trim() || !port.trim()) {
      toast({ variant: "destructive", title: "Missing OBS settings", description: "Provide IP and port." });
      return;
    }
    setObsSettings((prev) => ({ ...prev, busy: true }));
    try {
      const res = await fetch("/api/obs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: ip.trim(), port: port.trim(), password }),
      });
      if (res.ok) {
        toast({ title: "OBS connected" });
      } else {
        toast({ title: "OBS settings saved", description: "Dashboard will bridge OBS commands from your browser." });
      }
      setObsSettings((prev) => ({ ...prev, connected: true }));
    } catch {
      toast({ title: "OBS settings saved", description: "Dashboard will bridge OBS commands from your browser." });
      setObsSettings((prev) => ({ ...prev, connected: true }));
    } finally {
      setObsSettings((prev) => ({ ...prev, busy: false }));
    }
  };

  const saveObsScenes = async () => {
    setObsScenesBusy(true);
    try {
      const res = await fetch("/api/obs/scenes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: obsScenes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "OBS scene names saved" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save failed", description: String(error?.message || error) });
    } finally {
      setObsScenesBusy(false);
    }
  };

  const handleManualTokenExchange = async () => {
    if (!manualCode.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Paste the callback URL" });
      return;
    }
    try {
      const url = new URL(manualCode);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") || manualState;
      if (!code) {
        toast({ variant: "destructive", title: "Error", description: "No authorization code found in URL" });
        return;
      }
      const platform = state.includes("twitch") ? "twitch" : state.includes("youtube") ? "youtube" : state.includes("discord") ? "discord" : "twitch";
      const response = await fetch(`/api/auth/${platform}/manual-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: "Success!", description: `Connected ${result.username || "account"} as ${result.role || state}` });
        setManualCode("");
        await refreshTwitchStatus();
      } else {
        toast({ variant: "destructive", title: "Error", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to process token" });
    }
  };

  // --- Render ---
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Twitch */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-purple-600/10">
                <svg className="h-5 w-5 text-purple-500" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
              </div>
              <div>
                <CardTitle className="text-base">Twitch</CardTitle>
                <p className="text-sm text-muted-foreground">Stream to Twitch and interact with your chat</p>
              </div>
            </div>
            {!twitchConfigured && <Badge variant="destructive">Missing Client ID</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <AccountRow
            connected={twitchStatus.broadcasterConnected}
            label="Broadcaster"
            username={twitchStatus.broadcasterUsername}
            description="Your main Twitch account — connected when you sign in"
          >
            {twitchStatus.broadcasterConnected ? (
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => connectTwitch("broadcaster")}>Re-authorize</Button>
            ) : (
              <Button size="sm" onClick={() => connectTwitch("broadcaster")}>Connect</Button>
            )}
          </AccountRow>

          <AccountRow
            connected={twitchStatus.botConnected}
            label="Stream Bot"
            username={twitchStatus.botUsername}
            description={twitchStatus.botConnected ? "Your dedicated chat bot account" : "Optional. Must be a different account than Broadcaster if you connect one"}
          >
            {twitchStatus.botConnected ? (
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => connectTwitch("bot")}>Re-authorize</Button>
            ) : (
              <Button size="sm" onClick={() => connectTwitch("bot")}>Connect Optional Bot</Button>
            )}
          </AccountRow>

          <AccountRow
            connected={twitchStatus.communityBotConnected}
            label="Community Bot"
            username={twitchStatus.communityBotUsername}
            description="Optional shared bot for Chat Tag and cross-stream features. StreamWeaver still works without it."
          >
            <div className="flex items-center gap-2">
              {twitchStatus.communityBotConnected ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => connectTwitch("community-bot")}
                  >
                    Re-authorize
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => disconnectTwitch("community-bot")}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => connectTwitch("community-bot")}>
                  Connect
                </Button>
              )}
            </div>
          </AccountRow>
        </CardContent>
      </Card>

      {/* Kick */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-green-600/10">
              <svg className="h-5 w-5 text-green-500" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h4v4H2zm0 8h4v4H2zm0 8h4v4H2zm8-8h4v4h-4zm4-4h4v4h-4zm4-4h4v4h-4zm-4 12h4v4h-4zm4-4h4v4h-4zm0 8h4v4h-4z"/></svg>
            </div>
            <div>
              <CardTitle className="text-base">Kick</CardTitle>
              <p className="text-sm text-muted-foreground">Connect to Kick.com chat with bot commands</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <AccountRow
            connected={kickStatus.channelConnected}
            label="Channel Chat"
            description="Reads chat messages via Pusher WebSocket"
          >
            <Button size="sm" variant={kickStatus.channelConnected ? "ghost" : "default"} className={kickStatus.channelConnected ? "text-xs" : ""} onClick={connectKickChat}>
              {kickStatus.channelConnected ? "Reconnect" : "Connect"}
            </Button>
          </AccountRow>

          <AccountRow
            connected={kickStatus.broadcasterConnected}
            label="Broadcaster"
            username={kickStatus.broadcasterUsername}
            description="Your Kick account — for channel management"
          >
            <Button size="sm" variant={kickStatus.broadcasterConnected ? "ghost" : "default"} className={kickStatus.broadcasterConnected ? "text-xs" : ""} onClick={() => { window.location.href = "/api/auth/kick?role=broadcaster"; }}>
              {kickStatus.broadcasterConnected ? "Re-authorize" : "Connect"}
            </Button>
          </AccountRow>

          <AccountRow
            connected={kickStatus.botConnected}
            label="Custom Bot"
            username={kickStatus.botConnected ? kickStatus.botUsername : undefined}
            description="Optional — override the shared bot with your own"
          >
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => { window.location.href = "/api/auth/kick?role=bot"; }}>
              {kickStatus.botConnected ? "Re-authorize" : "Link Custom Bot"}
            </Button>
          </AccountRow>

          <AccountRow
            connected={true}
            label="Community Bot"
            username="streamweaverbot"
            description="Shared bot for commands & chat — works out of the box"
          >
            <Badge variant="outline" className="text-xs">Managed</Badge>
          </AccountRow>

          {kickStatus.channelConnected && kickStatus.broadcasterConnected && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                disabled={kickTesting}
                onClick={testKickConnection}
              >
                {kickTesting ? "Sending test message..." : "Test Connection — Send message to Kick chat"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* YouTube */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-600/10">
              <svg className="h-5 w-5 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            <div>
              <CardTitle className="text-base">YouTube</CardTitle>
              <p className="text-sm text-muted-foreground">Stream to YouTube and manage live chat</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AccountRow connected={false} label="Broadcaster" description="Connect your YouTube channel for live chat integration">
            <Button size="sm" onClick={() => { window.location.href = "/api/auth/youtube?role=youtube-broadcaster"; }}>
              Connect
            </Button>
          </AccountRow>
        </CardContent>
      </Card>

      {/* OBS */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-600/10">
              <svg className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 24C5.383 24 0 18.617 0 12S5.383 0 12 0s12 5.383 12 12-5.383 12-12 12zm-2.154-5.2c2.82.47 5.544-.678 7.048-2.676.346-.115.68-.264.997-.447a4.726 4.726 0 0 0 2.304-3.2c.456-2.2-.476-4.326-2.2-5.478a6.08 6.08 0 0 0-.507-3.252c-1.2-2.37-3.8-3.6-6.322-3.2a6.07 6.07 0 0 0-2.86 1.6C6.4 2.6 4.8 4.2 4.4 6.4a6.08 6.08 0 0 0 1.2 5.2c-.2.8-.2 1.6 0 2.4.6 2.4 2.6 4.2 5.046 4.6l.2.2z"/></svg>
            </div>
            <div>
              <CardTitle className="text-base">OBS Studio</CardTitle>
              <p className="text-sm text-muted-foreground">WebSocket connection for scene control — keep dashboard open while streaming</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="obs-ip" className="text-xs">IP Address</Label>
              <Input id="obs-ip" value={obsSettings.ip} onChange={(e) => setObsSettings({ ...obsSettings, ip: e.target.value })} placeholder="127.0.0.1" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs-port" className="text-xs">Port</Label>
              <Input id="obs-port" value={obsSettings.port} onChange={(e) => setObsSettings({ ...obsSettings, port: e.target.value })} placeholder="4455" className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-password" className="text-xs">Password (optional)</Label>
            <Input id="obs-password" type="password" value={obsSettings.password} onChange={(e) => setObsSettings({ ...obsSettings, password: e.target.value })} placeholder="Leave empty if no password" className="h-9" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {obsSettings.connected ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
              <span className="text-sm">{obsSettings.connected ? "Connected" : "Not connected"}</span>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (obsSettings.connected) {
                  setObsSettings({ ...obsSettings, connected: false });
                  return;
                }
                void testAndSaveObs();
              }}
              disabled={obsSettings.busy}
              variant={obsSettings.connected ? "ghost" : "default"}
            >
              {obsSettings.connected ? "Disconnect" : obsSettings.busy ? "Connecting..." : "Connect"}
            </Button>
          </div>

          {obsSettings.connected && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scene Names</p>
              <p className="text-xs text-muted-foreground">Must match your OBS scene names exactly. Commands like !brb switch to the scene entered here.</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "live", label: "Live / Main" },
                  { key: "brb", label: "BRB" },
                  { key: "starting", label: "Starting Soon" },
                  { key: "ending", label: "Ending" },
                  { key: "chatting", label: "Just Chatting" },
                  { key: "gaming", label: "Gaming" },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`obs-scene-${key}`} className="text-xs">{label}</Label>
                    <Input
                      id={`obs-scene-${key}`}
                      value={(obsScenes as any)[key]}
                      onChange={(e) => setObsScenes((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={label}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={saveObsScenes} disabled={obsScenesBusy}>
                {obsScenesBusy ? "Saving..." : "Save Scenes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Sign out and return to the login page</p>
          <Button variant="destructive" size="sm" onClick={() => { window.location.href = "/api/auth/signout"; }}>
            Sign Out
          </Button>
        </CardContent>
      </Card>

      {/* Manual Token Exchange (collapsed by default) */}
      <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Manual Token Exchange</CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${manualOpen ? "rotate-180" : ""}`} />
              </div>
              <p className="text-sm text-muted-foreground">If OAuth callback fails, paste the callback URL here</p>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-1.5">
                <Label htmlFor="callback-url" className="text-xs">Callback URL</Label>
                <Input
                  id="callback-url"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={`${appOrigin}/api/auth/twitch/callback?code=...`}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token-role" className="text-xs">Platform & Role</Label>
                <select
                  id="token-role"
                  value={manualState}
                  onChange={(e) => setManualState(e.target.value)}
                  className="w-full h-9 px-3 border rounded-md bg-background text-foreground text-sm"
                >
                  <optgroup label="Twitch">
                    <option value="broadcaster">Twitch — Broadcaster</option>
                    <option value="bot">Twitch — Bot</option>
                  </optgroup>
                  <optgroup label="YouTube">
                    <option value="youtube-broadcaster">YouTube — Broadcaster</option>
                  </optgroup>
                  <optgroup label="Kick">
                    <option value="kick">Kick — Broadcaster</option>
                  </optgroup>
                </select>
              </div>
              <Button size="sm" onClick={handleManualTokenExchange}>Exchange Token</Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
