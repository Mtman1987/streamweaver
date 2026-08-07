"use client";

import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, CheckCircle2, Circle, CircleDot, LoaderCircle, Mail, MessageSquareText, RefreshCw, Save, Sparkles, Users, Workflow } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { VoiceCommander } from "./voice-commander";

type StreamMetrics = {
  totalCommands: number;
  shoutoutsGiven: number;
  athenaCommands: number;
  lurkCommands: number;
};

type DashboardViewer = {
  id: string;
  name: string;
  platform?: string;
  avatar?: string;
  active?: boolean;
  lastSeen?: string;
  detail?: string;
};

type DashboardActivityMessage = {
  id: string;
  user: string;
  message: string;
  platform: string;
  color?: string;
};

type DashboardActivityEvent = {
  id: string;
  type: string;
  actor: string;
  detail: string;
  platform: string;
};

type SetupStep = {
  id: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  required: boolean;
  complete: boolean;
  detail?: string;
};

type SetupStatus = {
  progress: {
    completedRequired: number;
    totalRequired: number;
    completedTotal: number;
    totalSteps: number;
    percent: number;
  };
  steps: SetupStep[];
  context?: {
    broadcasterUsername?: string | null;
    aiProvider?: string;
  };
};

type DiscordDashboardSettings = {
  guildId: string;
  logChannelId: string;
  aiChatChannelId: string;
  shoutoutChannelId: string;
  dmChannelId: string;
  discordUserId: string;
  discordUsername: string;
  discordBridgeEnabled: boolean;
  dmEnabled: boolean;
};

type DiscordGuildOption = {
  id: string;
  name: string;
};

type DiscordChannelOption = {
  id: string;
  name: string;
  type?: number;
};

const platformOptions = ["Twitch", "Discord"] as const;
type DashboardPlatform = (typeof platformOptions)[number];

function normalizeViewers(payload: unknown, platform: DashboardPlatform): DashboardViewer[] {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.viewers)
      ? (payload as any).viewers
      : Array.isArray((payload as any)?.chatters)
        ? (payload as any).chatters
        : [];

  return entries.map((viewer: any, index: number) => {
    const name = platform === "Discord"
      ? viewer.name || viewer.displayName || viewer.username || viewer.userName || "Unknown"
      : viewer.user_display_name || viewer.user_name || viewer.user_login || viewer.name || "Unknown";

    return {
      id: String(viewer.id || viewer.user_id || viewer.userId || `${platform.toLowerCase()}-${index + 1}`),
      name,
      platform,
      active: viewer.active ?? true,
      avatar: viewer.avatar || viewer.avatarUrl || viewer.user_avatar || viewer.profile_image_url || undefined,
      lastSeen: viewer.lastSeen || new Date().toISOString(),
      detail: viewer.detail || viewer.title || viewer.streamTitle || viewer.gameName || undefined,
    };
  });
}

async function fetchDiscordLiveStreamers(): Promise<DashboardViewer[]> {
  const channelsResponse = await fetch("/api/bot/channels", { cache: "no-store" });
  if (!channelsResponse.ok) return [];
  const channelsBody = await channelsResponse.json().catch(() => ({}));
  const channels = Array.isArray(channelsBody?.channels) ? channelsBody.channels : [];
  const usernames = channels.map((channel: any) => String(channel?.name || "").trim()).filter(Boolean);
  if (usernames.length === 0) return [];

  const liveResponse = await fetch("/api/twitch/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames }),
  });
  if (!liveResponse.ok) return [];
  const liveBody = await liveResponse.json().catch(() => ({}));
  const liveUsers = Array.isArray(liveBody?.liveUsers) ? liveBody.liveUsers : [];

  return liveUsers.map((stream: any, index: number) => ({
    id: String(stream.username || `discord-live-${index + 1}`),
    name: String(stream.displayName || stream.username || "Unknown"),
    platform: "Discord",
    active: true,
    avatar: stream.profile_image_url || stream.avatar || undefined,
    detail: [stream.gameName, stream.title].filter(Boolean).join(" • "),
    lastSeen: new Date().toISOString(),
  }));
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  accent = false,
}: {
  title: string;
  value: string;
  description: string;
  icon: ElementType;
  accent?: boolean;
}) {
  return (
    <Card className={cn("border-border/70 bg-card/80 shadow-sm backdrop-blur", accent && "border-accent/30 bg-accent/5")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn("h-4 w-4", accent ? "text-accent" : "text-muted-foreground")} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function channelLabel(channel: DiscordChannelOption): string {
  return `#${channel.name || channel.id}`;
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [viewers, setViewers] = useState<DashboardViewer[]>([]);
  const [activityMessages, setActivityMessages] = useState<DashboardActivityMessage[]>([]);
  const [activityEvents, setActivityEvents] = useState<DashboardActivityEvent[]>([]);
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
  const [healthLabel, setHealthLabel] = useState("Checking");
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [discordSettings, setDiscordSettings] = useState<DiscordDashboardSettings>({
    guildId: "",
    logChannelId: "",
    aiChatChannelId: "",
    shoutoutChannelId: "",
    dmChannelId: "",
    discordUserId: "",
    discordUsername: "",
    discordBridgeEnabled: true,
    dmEnabled: false,
  });
  const [discordGuilds, setDiscordGuilds] = useState<DiscordGuildOption[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannelOption[]>([]);
  const [isDiscordSettingsLoading, setIsDiscordSettingsLoading] = useState(false);
  const [isDiscordSettingsSaving, setIsDiscordSettingsSaving] = useState(false);
  const [isDiscordDmRegistering, setIsDiscordDmRegistering] = useState(false);
  const [showCompletedSetupDetails, setShowCompletedSetupDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<DashboardPlatform>("Twitch");

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [healthResponse, metricsResponse] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }).catch(() => null),
        fetch("/api/metrics", { cache: "no-store" }).catch(() => null),
      ]);
      const setupResponse = await fetch("/api/dashboard/setup-status", { cache: "no-store" }).catch(() => null);
      const activityResponse = await fetch("/api/dashboard/activity", { cache: "no-store" }).catch(() => null);

      if (healthResponse) {
        setHealthLabel(healthResponse.ok ? "Healthy" : "Degraded");
      } else {
        setHealthLabel("Offline");
      }

      const metricsResult = metricsResponse?.ok
        ? await metricsResponse.json()
        : { totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 };
      const setupResult = setupResponse?.ok ? await setupResponse.json() : null;
      const activityResult = activityResponse?.ok ? await activityResponse.json().catch(() => ({})) : {};
      setActivityMessages(Array.isArray(activityResult?.messages) ? activityResult.messages : []);
      setActivityEvents(Array.isArray(activityResult?.events) ? activityResult.events : []);

      let viewersPayload: unknown = [];
      if (selectedPlatform === "Discord") {
        setViewers(await fetchDiscordLiveStreamers());
        setSetupStatus(setupResult);
        setMetrics(metricsResult);
        return;
      } else {
        const response = await fetch("/api/chat/chatters", { cache: "no-store" });
        if (response.ok) {
          viewersPayload = await response.json();
        }
      }

      const normalizedViewers = normalizeViewers(viewersPayload, selectedPlatform);

      setMetrics(metricsResult);
      setViewers(normalizedViewers);
      setSetupStatus(setupResult);
    } catch (error: any) {
      console.error("[Dashboard] Failed to load workspace data:", error);
      toast({
        variant: "destructive",
        title: "Failed to load dashboard data",
        description: error?.message || "Check the server logs and your connection settings.",
      });
      setMetrics({ totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 });
      setViewers([]);
      setActivityMessages([]);
      setActivityEvents([]);
      setSetupStatus(null);
      setHealthLabel("Offline");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatform]);

  useEffect(() => {
    if (selectedPlatform !== "Discord") return;
    let cancelled = false;
    const loadDiscordSettings = async () => {
      setIsDiscordSettingsLoading(true);
      try {
        const [settingsResponse, guildsResponse] = await Promise.all([
          fetch("/api/discord/channels", { cache: "no-store" }),
          fetch("/api/discord/roles", { cache: "no-store" }),
        ]);
        const settingsBody = settingsResponse.ok ? await settingsResponse.json().catch(() => ({})) : {};
        const guildsBody = guildsResponse.ok ? await guildsResponse.json().catch(() => ({})) : {};
        if (cancelled) return;
        const guilds = Array.isArray(guildsBody?.guilds) ? guildsBody.guilds : [];
        const nextGuildId = String(settingsBody?.guildId || guilds[0]?.id || "");
        setDiscordGuilds(guilds.map((guild: any) => ({ id: String(guild.id), name: String(guild.name || guild.id) })));
        setDiscordSettings({
          guildId: nextGuildId,
          logChannelId: String(settingsBody?.logChannelId || ""),
          aiChatChannelId: String(settingsBody?.aiChatChannelId || ""),
          shoutoutChannelId: String(settingsBody?.shoutoutChannelId || ""),
          dmChannelId: String(settingsBody?.dmChannelId || ""),
          discordUserId: String(settingsBody?.discordUserId || ""),
          discordUsername: String(settingsBody?.discordUsername || ""),
          discordBridgeEnabled: settingsBody?.discordBridgeEnabled !== false,
          dmEnabled: Boolean(settingsBody?.dmEnabled),
        });
      } catch (error: any) {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Discord settings failed", description: error?.message || "Could not load Discord settings." });
        }
      } finally {
        if (!cancelled) setIsDiscordSettingsLoading(false);
      }
    };
    void loadDiscordSettings();
    return () => {
      cancelled = true;
    };
  }, [selectedPlatform, toast]);

  useEffect(() => {
    if (selectedPlatform !== "Discord" || !discordSettings.guildId) {
      setDiscordChannels([]);
      return;
    }
    let cancelled = false;
    const loadGuildChannels = async () => {
      try {
        const response = await fetch(`/api/discord/guilds/${encodeURIComponent(discordSettings.guildId)}?membersLimit=1`, { cache: "no-store" });
        const body = response.ok ? await response.json().catch(() => ({})) : {};
        if (cancelled) return;
        const channels = Array.isArray(body?.channels) ? body.channels : [];
        setDiscordChannels(
          channels
            .filter((channel: any) => [0, 5, 10, 11, 12, 15].includes(Number(channel.type)))
            .sort((a: any, b: any) => Number(a.position ?? 0) - Number(b.position ?? 0))
            .map((channel: any) => ({ id: String(channel.id), name: String(channel.name || channel.id), type: Number(channel.type) }))
        );
      } catch {
        if (!cancelled) setDiscordChannels([]);
      }
    };
    void loadGuildChannels();
    return () => {
      cancelled = true;
    };
  }, [selectedPlatform, discordSettings.guildId]);

  useEffect(() => {
    const syncSetupHash = () => {
      if (window.location.hash === "#setup") {
        setShowCompletedSetupDetails(true);
      }
    };
    syncSetupHash();
    window.addEventListener("hashchange", syncSetupHash);
    return () => window.removeEventListener("hashchange", syncSetupHash);
  }, []);

  const heroStats = useMemo(
    () => [
      {
        title: selectedPlatform === "Discord" ? "Live Streamers" : "Active Chatters",
        value: viewers.length.toLocaleString(),
        description: selectedPlatform === "Discord" ? "Live community channels" : "Currently in Twitch chat",
        icon: Users,
      },
      {
        title: "AI Mentions",
        value: metrics?.athenaCommands?.toLocaleString() || "0",
        description: "Mentions routed to the assistant",
        icon: Bot,
      },
    ],
    [metrics, selectedPlatform, viewers.length]
  );

  const activityCopy = selectedPlatform === "Discord"
    ? {
        title: "Discord live shoutout watch",
        description: "Community channels currently live on Twitch and available for Discord/share shoutouts.",
        loading: "Checking live community channels...",
        empty: "No configured community channels are live right now.",
        status: "Live",
        detail: "streaming now",
      }
    : {
        title: "Chat activity",
        description: "People currently visible in your selected chat source.",
        loading: "Loading chat data...",
        empty: "No active chatters detected on twitch right now. The layout stays useful even when chat is quiet.",
        status: "Active",
        detail: "in chat now",
      };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchAllData();
  };

  const saveDiscordSettings = async () => {
    setIsDiscordSettingsSaving(true);
    try {
      const response = await fetch("/api/discord/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordSettings),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Failed to save Discord settings.");
      toast({ title: "Discord settings saved", description: "Channel routing was updated." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save failed", description: error?.message || "Could not save Discord settings." });
    } finally {
      setIsDiscordSettingsSaving(false);
    }
  };

  const registerDiscordDmChannel = async () => {
    setIsDiscordDmRegistering(true);
    try {
      const response = await fetch("/api/discord/dm-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Failed to create Discord DM channel.");
      setDiscordSettings((prev) => ({
        ...prev,
        dmChannelId: String(body?.dmChannelId || ""),
        dmEnabled: true,
      }));
      toast({ title: "Discord DM connected", description: "The bot sent you a setup DM and saved the DM channel ID." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "DM setup failed",
        description: error?.message || "Connect your Discord account first, then try again.",
      });
    } finally {
      setIsDiscordDmRegistering(false);
    }
  };

  const quickLinks = [
    { href: "/community", label: "Browse ready-made features", description: "Preview and install starter systems before building your own.", icon: Sparkles },
    { href: "/commands", label: "Create a chat command", description: "Start with a trigger viewers can actually remember.", icon: Workflow },
    { href: "/integrations", label: "Check connections", description: "Reconnect Twitch, OBS, Discord, and other services.", icon: CircleDot },
  ];
  const requiredSetupComplete = Boolean(
    setupStatus &&
      setupStatus.progress.totalRequired > 0 &&
      setupStatus.progress.completedRequired >= setupStatus.progress.totalRequired
  );
  const showSetupWizard = !requiredSetupComplete || showCompletedSetupDetails;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <Card className="border-border/70 bg-card/85 shadow-lg shadow-black/10">
        <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.5fr_1fr] lg:items-center">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-accent/15 text-accent hover:bg-accent/15">Workspace overview</Badge>
              <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
                {healthLabel}
              </Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Run the stream from one place.</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                See what is live, what needs attention, and where to go next without digging through a maze of pages.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((platform) => (
                <Button
                  key={platform}
                  variant={selectedPlatform === platform ? "default" : "outline"}
                  onClick={() => setSelectedPlatform(platform)}
                  className={cn(selectedPlatform === platform && "shadow-[0_0_0_1px_hsl(var(--primary))]")}
                >
                  {platform}
                </Button>
              ))}
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing || isLoading}>
                {isRefreshing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-background/40 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <CardTitle className="text-base">Next moves</CardTitle>
              <Badge variant="outline" className="border-border/70 bg-card/70 text-muted-foreground">
                Quick start
              </Badge>
            </div>
            <div className="space-y-3">
              {quickLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 transition-colors hover:border-accent/40 hover:bg-accent/5"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedPlatform === "Discord" ? (
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-accent" />
                Discord control
              </CardTitle>
              <CardDescription>Select channels by name. StreamWeaver saves the IDs behind the scenes.</CardDescription>
            </div>
            <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
              {isDiscordSettingsLoading ? "Loading" : `${discordChannels.length} channels`}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Discord server</Label>
                <Select value={discordSettings.guildId || "_none"} onValueChange={(guildId) => setDiscordSettings((prev) => ({ ...prev, guildId: guildId === "_none" ? "" : guildId }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a Discord server" />
                  </SelectTrigger>
                  <SelectContent>
                    {discordGuilds.map((guild) => (
                      <SelectItem key={guild.id} value={guild.id}>{guild.name}</SelectItem>
                    ))}
                    {discordGuilds.length === 0 ? <SelectItem value="_none" disabled>No servers available</SelectItem> : null}
                  </SelectContent>
                </Select>
              </div>
              {[
                ["logChannelId", "Chat log channel", "Where chat history and bridge logs are stored."],
                ["aiChatChannelId", "AI chat channel", "Where Discord AI conversation is routed."],
                ["shoutoutChannelId", "Shoutout channel", "Where shoutouts/share posts are sent."],
              ].map(([key, label, help]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Select
                    value={(discordSettings as any)[key] || "_none"}
                    onValueChange={(channelId) => setDiscordSettings((prev) => ({ ...prev, [key]: channelId === "_none" ? "" : channelId }))}
                    disabled={!discordSettings.guildId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Not selected</SelectItem>
                      {discordChannels.map((channel) => (
                        <SelectItem key={`${key}-${channel.id}`} value={channel.id}>{channelLabel(channel)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{help}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label>Private Discord DM</Label>
                  <p className="text-xs text-muted-foreground">
                    {discordSettings.discordUsername
                      ? `Linked Discord user: ${discordSettings.discordUsername}`
                      : "Uses the Discord account already linked to your SPMT sign-in."}
                  </p>
                  {discordSettings.dmChannelId ? (
                    <p className="text-xs text-muted-foreground">DM channel saved: {discordSettings.dmChannelId}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={registerDiscordDmChannel}
                  disabled={isDiscordDmRegistering || isDiscordSettingsLoading}
                >
                  {isDiscordDmRegistering ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send me a setup DM
                </Button>
              </div>
            </div>
            <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/40 p-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="discord-bridge-enabled">Discord bridge</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Bridge eligible Discord messages into Twitch.</p>
                </div>
                <Switch
                  id="discord-bridge-enabled"
                  checked={discordSettings.discordBridgeEnabled}
                  onCheckedChange={(discordBridgeEnabled) => setDiscordSettings((prev) => ({ ...prev, discordBridgeEnabled }))}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="discord-dm-enabled">Streamer DM replies</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Toggle private bot DMs. No manual DM channel ID required.</p>
                </div>
                <Switch
                  id="discord-dm-enabled"
                  checked={discordSettings.dmEnabled}
                  onCheckedChange={(dmEnabled) => setDiscordSettings((prev) => ({ ...prev, dmEnabled }))}
                />
              </div>
            </div>
            <Button onClick={saveDiscordSettings} disabled={isDiscordSettingsSaving || isDiscordSettingsLoading}>
              <Save className="mr-2 h-4 w-4" />
              {isDiscordSettingsSaving ? "Saving..." : "Save Discord routing"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showSetupWizard ? (
      <Card id="setup" className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Setup wizard</CardTitle>
            <CardDescription>
              Follow the real setup sequence for this tenant instead of hunting through pages.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
              {setupStatus?.progress.completedRequired ?? 0}/{setupStatus?.progress.totalRequired ?? 0} required
            </Badge>
            {requiredSetupComplete ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCompletedSetupDetails(false);
                  if (window.location.hash === "#setup") {
                    window.history.replaceState(null, "", window.location.pathname);
                  }
                }}
              >
                Collapse
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">Workspace readiness</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {setupStatus?.context?.broadcasterUsername
                    ? `Configured for ${setupStatus.context.broadcasterUsername}`
                    : "No broadcaster identity saved yet."}
                </div>
              </div>
              <div className="min-w-[180px]">
                <Progress value={setupStatus?.progress.percent ?? 0} className="h-2" />
                <div className="mt-2 text-right text-xs text-muted-foreground">
                  {setupStatus?.progress.percent ?? 0}% of required setup complete
                </div>
              </div>
            </div>
          </div>

          {setupStatus ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {setupStatus.steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "rounded-2xl border p-4 transition-colors",
                    step.complete
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : "border-border/70 bg-background/40"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5", step.complete ? "text-emerald-500" : "text-muted-foreground/50")}>
                      {step.complete ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{step.title}</div>
                        <Badge variant="outline" className="text-[10px]">
                          {step.required ? "Required" : "Optional"}
                        </Badge>
                        {step.complete ? (
                          <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Done</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                      {step.detail ? <p className="mt-2 text-xs text-muted-foreground">{step.detail}</p> : null}
                      <div className="mt-3">
                        <Button asChild size="sm" variant={step.complete ? "outline" : "default"}>
                          <Link href={step.href}>{step.ctaLabel}</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
              Setup state is unavailable right now. Refresh the dashboard or check the server logs if this persists.
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="border-border/70 bg-card/80 shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Voice Commander</CardTitle>
              <CardDescription>Private chat, AI replies, Twitch sends, and Discord sends in a tighter control surface.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/voice">Open widget</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <VoiceCommander variant="embedded" />
            <div className="rounded-2xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              Private mode now pushes TTS into the listener queue and also plays locally from the dashboard when the browser allows it.
            </div>
          </CardContent>
        </Card>

        {heroStats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="border-border/70 bg-card/80 shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Messaging preview</CardTitle>
              <CardDescription>Read-only chat and stream signals for quick monitoring while live.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/chat">Open Messaging</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-border/70 bg-background/40">
              <div className="border-b border-border/70 px-4 py-3 text-sm font-medium">Recent chat</div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
                {activityMessages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    No chat preview loaded yet. Configure the Discord log channel to populate this view.
                  </div>
                ) : (
                  activityMessages.slice(-18).map((message) => (
                    <div key={message.id} className="rounded-xl border border-border/60 bg-card/55 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">{message.platform}</Badge>
                        <span className="font-medium">{message.user.replace(/^\[(Twitch|Discord)\]\s*/i, "")}</span>
                      </div>
                      <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">{message.message}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/40">
              <div className="border-b border-border/70 px-4 py-3 text-sm font-medium">Activity monitor</div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
                {activityEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    Raids, subs, bits, follows, and similar events will appear here when they are visible in chat/log messages.
                  </div>
                ) : (
                  activityEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge className="bg-accent/15 text-accent hover:bg-accent/15">{event.type}</Badge>
                        <span className="font-medium">{event.actor}</span>
                        <span className="text-muted-foreground">{event.platform}</span>
                      </div>
                      <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">{event.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card id="activity" className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{activityCopy.title}</CardTitle>
              <CardDescription>{activityCopy.description}</CardDescription>
            </div>
            <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
              {viewers.length} visible
            </Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/40 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {activityCopy.loading}
              </div>
            ) : viewers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                {activityCopy.empty}
              </div>
            ) : (
              <div className="space-y-2">
                {viewers.slice(0, 7).map((viewer) => {
                  const displayName = viewer.name || "User";
                  return (
                    <div
                      key={viewer.id}
                      className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5"
                    >
                      <Avatar className="h-10 w-10 border border-border/70">
                        {viewer.avatar ? <AvatarImage src={viewer.avatar} alt={displayName} /> : null}
                        <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{displayName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {viewer.platform || selectedPlatform} • {viewer.detail || (viewer.active ? activityCopy.detail : "idle")}
                        </div>
                      </div>
                      <Badge variant="outline" className="border-border/70 bg-card/70 text-muted-foreground">
                        {viewer.active ? activityCopy.status : "Idle"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
