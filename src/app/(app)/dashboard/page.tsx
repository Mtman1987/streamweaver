"use client";

import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, CircleDot, LoaderCircle, RefreshCw, Sparkles, TrendingUp, Users, Workflow } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
};

const platformOptions = ["Twitch", "Discord"] as const;

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

export default function DashboardPage() {
  const { toast } = useToast();
  const [viewers, setViewers] = useState<DashboardViewer[]>([]);
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
  const [healthLabel, setHealthLabel] = useState("Checking");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<(typeof platformOptions)[number]>("Twitch");

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [healthResponse, metricsResponse] = await Promise.all([
        fetch("/api/__health", { cache: "no-store" }).catch(() => null),
        fetch("/api/metrics", { cache: "no-store" }).catch(() => null),
      ]);

      if (healthResponse) {
        setHealthLabel(healthResponse.ok ? "Healthy" : "Degraded");
      } else {
        setHealthLabel("Offline");
      }

      const metricsResult = metricsResponse?.ok
        ? await metricsResponse.json()
        : { totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 };

      let viewersResult: any[] = [];
      if (selectedPlatform === "Discord") {
        const response = await fetch("/api/discord/dyno-voice", { cache: "no-store" });
        viewersResult = response.ok ? await response.json() : [];
      } else {
        const response = await fetch("/api/chat/chatters", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          viewersResult = Array.isArray(data?.chatters) ? data.chatters : [];
        }
      }

      const normalizedViewers = selectedPlatform === "Discord"
        ? viewersResult
        : await Promise.all(
            viewersResult.map(async (viewer: any, index: number) => ({
              id: viewer.user_id || `${index + 1}`,
              name: viewer.user_display_name || viewer.user_login || "Unknown",
              platform: "Twitch",
              active: true,
              avatar: viewer.avatar || `https://placehold.co/64x64/png?text=${encodeURIComponent((viewer.user_display_name || viewer.user_login || "?").slice(0, 1))}`,
              lastSeen: new Date().toISOString(),
            }))
          );

      setMetrics(metricsResult);
      setViewers(normalizedViewers);
    } catch (error: any) {
      console.error("[Dashboard] Failed to load workspace data:", error);
      toast({
        variant: "destructive",
        title: "Failed to load dashboard data",
        description: error?.message || "Check the server logs and your connection settings.",
      });
      setMetrics({ totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 });
      setViewers([]);
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

  const heroStats = useMemo(
    () => [
      {
        title: "Total Commands",
        value: metrics?.totalCommands?.toLocaleString() || "0",
        description: "Tracked across the workspace",
        icon: Workflow,
      },
      {
        title: "Shoutouts",
        value: metrics?.shoutoutsGiven?.toLocaleString() || "0",
        description: "Walk-on and shoutout flows",
        icon: Sparkles,
      },
      {
        title: "Live Viewers",
        value: viewers.length.toLocaleString(),
        description: `Currently visible on ${selectedPlatform}`,
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchAllData();
  };

  const quickLinks = [
    { href: "/commands", label: "Build commands", description: "Create triggers users can actually remember.", icon: Workflow },
    { href: "/actions", label: "Compose actions", description: "Link steps, checks, and replies into one flow.", icon: Sparkles },
    { href: "/integrations", label: "Check integrations", description: "Reconnect OBS, Twitch, Discord, and other services.", icon: CircleDot },
  ];

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

          <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/40 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Current mode</div>
                <div className="mt-1 text-lg font-medium">{selectedPlatform} control</div>
              </div>
              <div className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">Ready</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AI</div>
                <div className="mt-1 text-sm font-medium">Gemini routing active</div>
                <div className="text-xs text-muted-foreground">Assistant calls should now use the newer model path.</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Health</div>
                <div className="mt-1 text-sm font-medium">{healthLabel}</div>
                <div className="text-xs text-muted-foreground">Runtime and API heartbeat.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-accent/20 bg-accent/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                <TrendingUp className="h-4 w-4" />
                What to do next
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                If the bot feels broken, start with commands, then actions, then integrations. That sequence matches how the runtime is wired.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {heroStats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card id="activity" className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Live activity</CardTitle>
              <CardDescription>People who are currently live in the selected platform.</CardDescription>
            </div>
            <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
              {viewers.length} visible
            </Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/40 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading live data...
              </div>
            ) : viewers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                No live users detected on {selectedPlatform.toLowerCase()} right now. The layout stays useful even when the stream is quiet.
              </div>
            ) : (
              <div className="space-y-2">
                {viewers.slice(0, 8).map((viewer) => {
                  const displayName = viewer.name || "User";
                  return (
                    <div
                      key={viewer.id}
                      className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5"
                    >
                      <Avatar className="h-10 w-10 border border-border/70">
                        <AvatarImage src={viewer.avatar} alt={displayName} />
                        <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{displayName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {viewer.platform || selectedPlatform} {viewer.active ? "• active now" : "• idle"}
                        </div>
                      </div>
                      <Badge variant="outline" className="border-border/70 bg-card/70 text-muted-foreground">
                        {viewer.active ? "Live" : "Idle"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Quick start</CardTitle>
            <CardDescription>The shortest path from setup to a working bot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-background/40 p-3 transition-colors hover:border-accent/40 hover:bg-accent/5"
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

            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-accent" />
                Recommended sequence
              </div>
              <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>1. Build commands users will remember.</li>
                <li>2. Attach actions to those commands.</li>
                <li>3. Connect integrations and overlay URLs.</li>
                <li>4. Open logs if something feels off.</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
