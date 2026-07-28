"use client";

import * as React from "react";
import {
  CircleDollarSign,
  ExternalLink,
  Filter,
  MessageSquare,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Search,
  Send,
  SkipForward,
  Volume2,
  VolumeX,
  Star,
  Unplug,
  Users,
  Wifi,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

type SharedChatEvent = {
  eventId: string;
  platform: string;
  sourceName?: string;
  channelName?: string;
  type: string;
  sender: {
    displayName: string;
    avatarUrl?: string;
    badges: Array<{ id: string; label?: string }>;
    roles: string[];
  };
  text: string;
  media: Array<{ type: string; url: string; alt?: string }>;
  donation?: { display?: string; amount: number; currency: string };
  membership?: { tier?: string; months?: number };
  originalTimestamp: string;
  routing: { canReply: boolean };
};

type OperatorState = {
  pinnedEventIds: string[];
  queuedEventIds: string[];
  featuredEventId: string | null;
  autoShow: boolean;
  autoAdvance: boolean;
  featureDurationSeconds: number;
  featureStyle: "glass" | "solid" | "minimal";
  featuredAt: string | null;
};

type UserState = {
  lastReadEventId: string | null;
  savedFilters: Array<{ id: string; name: string; platform: string; query: string }>;
};

const PLATFORM_COLORS: Record<string, string> = {
  twitch: "bg-purple-500/15 text-purple-200 border-purple-400/30",
  youtube: "bg-red-500/15 text-red-200 border-red-400/30",
  discord: "bg-indigo-500/15 text-indigo-200 border-indigo-400/30",
  kick: "bg-lime-500/15 text-lime-200 border-lime-400/30",
  "social-stream": "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SharedChatPage() {
  const [events, setEvents] = React.useState<SharedChatEvent[]>([]);
  const [operator, setOperator] = React.useState<OperatorState>({
    pinnedEventIds: [],
    queuedEventIds: [],
    featuredEventId: null,
    autoShow: false,
    autoAdvance: false,
    featureDurationSeconds: 15,
    featureStyle: "glass",
    featuredAt: null,
  });
  const [userState, setUserState] = React.useState<UserState>({ lastReadEventId: null, savedFilters: [] });
  const [platform, setPlatform] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [appliedQuery, setAppliedQuery] = React.useState("");
  const [status, setStatus] = React.useState<"connecting" | "live" | "degraded">("connecting");
  const [lastUpdate, setLastUpdate] = React.useState<Date | null>(null);
  const [speakingEventId, setSpeakingEventId] = React.useState<string | null>(null);
  const [replyEventId, setReplyEventId] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState("");
  const [tenantId, setTenantId] = React.useState("");
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [replayResponse, operatorResponse, userResponse] = await Promise.all([
        fetch("/api/shared-chat/replay?limit=200", { cache: "no-store" }),
        fetch("/api/shared-chat/operator", { cache: "no-store" }),
        fetch("/api/shared-chat/user-state", { cache: "no-store" }),
      ]);
      if (!replayResponse.ok || !operatorResponse.ok || !userResponse.ok) throw new Error("Shared chat API unavailable");
      const replayBody = await replayResponse.json();
      const operatorBody = await operatorResponse.json();
      const userBody = await userResponse.json();
      setEvents(Array.isArray(replayBody.events) ? replayBody.events : []);
      setTenantId(String(replayBody.tenantId || ""));
      setOperator(operatorBody.state);
      setUserState(userBody.state);
      setStatus("live");
      setLastUpdate(new Date());
    } catch {
      setStatus("degraded");
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  React.useEffect(() => {
    const source = new EventSource("/api/shared-chat/stream");
    source.addEventListener("chat", (message) => {
      try {
        const next = JSON.parse((message as MessageEvent).data) as SharedChatEvent;
        setEvents((current) => [...current.filter((entry) => entry.eventId !== next.eventId), next].slice(-500));
        setStatus("live");
        setLastUpdate(new Date());
      } catch {}
    });
    source.addEventListener("operator", (message) => {
      try { setOperator(JSON.parse((message as MessageEvent).data)); } catch {}
    });
    source.addEventListener("heartbeat", () => {
      setStatus("live");
      setLastUpdate(new Date());
    });
    source.addEventListener("degraded", () => setStatus("degraded"));
    source.onerror = () => setStatus("degraded");
    return () => source.close();
  }, []);

  async function act(action: string, eventId?: string, enabled?: boolean) {
    const response = await fetch("/api/shared-chat/operator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, eventId, enabled }),
    });
    if (response.ok) {
      const body = await response.json();
      setOperator(body.state);
    } else {
      setStatus("degraded");
    }
  }

  async function setFeatureOptions(patch: { autoAdvance?: boolean; durationSeconds?: number; style?: OperatorState["featureStyle"] }) {
    const response = await fetch("/api/shared-chat/operator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-feature-options", ...patch }),
    });
    if (response.ok) setOperator((await response.json()).state);
  }

  async function saveUserState(next: UserState) {
    const response = await fetch("/api/shared-chat/user-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (response.ok) setUserState((await response.json()).state);
  }

  function saveCurrentFilter() {
    const name = window.prompt("Name this live-chat filter");
    if (!name?.trim()) return;
    const saved = {
      id: `filter-${Date.now()}`,
      name: name.trim(),
      platform,
      query: appliedQuery,
    };
    void saveUserState({ ...userState, savedFilters: [...userState.savedFilters, saved].slice(-20) });
  }

  function listen(event: SharedChatEvent) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (speakingEventId === event.eventId) {
      setSpeakingEventId(null);
      return;
    }
    const text = `${event.sender.displayName} says ${event.text}`.trim();
    const audio = new Audio(`/api/tts/play?text=${encodeURIComponent(text)}`);
    audioRef.current = audio;
    setSpeakingEventId(event.eventId);
    audio.onended = () => setSpeakingEventId(null);
    audio.onerror = () => {
      setSpeakingEventId(null);
      setStatus("degraded");
    };
    void audio.play();
  }

  async function sendReply(eventId: string) {
    const response = await fetch("/api/shared-chat/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId, message: replyText }),
    });
    if (response.ok) {
      setReplyEventId(null);
      setReplyText("");
    } else {
      setStatus("degraded");
    }
  }

  const orderedEvents = React.useMemo(() => {
    const pinned = new Set(operator.pinnedEventIds);
    return events
      .filter((event) => platform === "all" || event.platform === platform)
      .filter((event) => !appliedQuery || `${event.sender.displayName} ${event.text}`.toLowerCase().includes(appliedQuery.toLowerCase()))
      .sort((a, b) => Number(pinned.has(b.eventId)) - Number(pinned.has(a.eventId)));
  }, [appliedQuery, events, operator.pinnedEventIds, platform]);
  const featured = events.find((event) => event.eventId === operator.featuredEventId);
  const lastReadIndex = userState.lastReadEventId ? events.findIndex((event) => event.eventId === userState.lastReadEventId) : -1;
  const unreadCount = lastReadIndex >= 0 ? events.length - lastReadIndex - 1 : events.length;

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[560px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><MessageSquare className="h-6 w-6 text-cyan-300" /> Live Chat Dock</h1>
          <p className="text-sm text-muted-foreground">One tenant-safe feed for Twitch, YouTube, Kick, Discord, and Social Stream Ninja.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={status === "live" ? "border-emerald-400/40 text-emerald-300" : status === "degraded" ? "border-amber-400/40 text-amber-300" : ""}>
            {status === "live" ? <Wifi className="mr-1 h-3 w-3" /> : <Unplug className="mr-1 h-3 w-3" />}
            {status === "live" ? `Live · ${lastUpdate ? timeLabel(lastUpdate.toISOString()) : ""}` : status}
          </Badge>
          <Badge variant="outline">{unreadCount} unread</Badge>
          <Button size="sm" variant="outline" onClick={() => {
            const latest = events.at(-1);
            if (latest) void saveUserState({ ...userState, lastReadEventId: latest.eventId });
          }} disabled={events.length === 0 || unreadCount === 0}>Mark read</Button>
          <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="mr-1 h-4 w-4" /> Refresh</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[1fr_300px]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex flex-wrap gap-2">
              {["all", "twitch", "youtube", "kick", "discord", "social-stream"].map((item) => (
                <Button key={item} size="sm" variant={platform === item ? "default" : "outline"} onClick={() => setPlatform(item)}>
                  {item === "all" ? "All sources" : item}
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={saveCurrentFilter}>Save view</Button>
            </div>
            {userState.savedFilters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {userState.savedFilters.map((filter) => (
                  <Button key={filter.id} size="sm" variant="secondary" onClick={() => {
                    setPlatform(filter.platform);
                    setQuery(filter.query);
                    setAppliedQuery(filter.query);
                  }}>{filter.name}</Button>
                ))}
              </div>
            )}
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search viewer, message, or command…" className="pl-9" />
              </div>
              <Button type="submit" variant="secondary"><Filter className="mr-1 h-4 w-4" /> Apply</Button>
            </form>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="space-y-2">
                {orderedEvents.length === 0 && (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No messages match this view. The dock will update automatically when normalized events arrive.
                  </div>
                )}
                {orderedEvents.map((event) => {
                  const pinned = operator.pinnedEventIds.includes(event.eventId);
                  const queued = operator.queuedEventIds.includes(event.eventId);
                  const isFeatured = operator.featuredEventId === event.eventId;
                  return (
                    <article key={event.eventId} className={`rounded-xl border p-3 ${isFeatured ? "border-cyan-300/70 bg-cyan-500/10" : pinned ? "border-purple-400/50 bg-purple-500/5" : "bg-card/50"}`}>
                      <div className="flex gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={event.sender.avatarUrl} />
                          <AvatarFallback>{initials(event.sender.displayName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-foreground">{event.sender.displayName}</span>
                            <Badge variant="outline" className={PLATFORM_COLORS[event.platform] || ""}>{event.platform}</Badge>
                            {event.sender.roles.filter((role) => role !== "viewer").map((role) => <Badge key={role} variant="secondary">{role}</Badge>)}
                            {event.sender.badges.slice(0, 3).map((badge) => <Badge key={badge.id} variant="secondary">{badge.label || badge.id}</Badge>)}
                            <span className="text-muted-foreground">{event.channelName || event.sourceName || ""} · {timeLabel(event.originalTimestamp)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{event.text || <span className="italic text-muted-foreground">Media or platform event</span>}</p>
                          {(event.donation || event.membership) && (
                            <div className="mt-2 flex gap-2 text-xs text-amber-200">
                              {event.donation && <span className="flex items-center gap-1"><CircleDollarSign className="h-4 w-4" />{event.donation.display || `${event.donation.amount} ${event.donation.currency}`}</span>}
                              {event.membership && <span className="flex items-center gap-1"><Users className="h-4 w-4" />Member {event.membership.tier || ""}</span>}
                            </div>
                          )}
                          {event.media.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {event.media.map((media, index) => (
                                <a key={`${media.url}-${index}`} href={media.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-cyan-200">
                                  <ExternalLink className="h-3 w-3" /> {media.alt || media.type}
                                </a>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" onClick={() => void act(pinned ? "unpin" : "pin", event.eventId)}>
                              {pinned ? <PinOff className="mr-1 h-3 w-3" /> : <Pin className="mr-1 h-3 w-3" />}{pinned ? "Unpin" : "Pin"}
                            </Button>
                            <Button size="sm" variant={queued ? "secondary" : "ghost"} onClick={() => void act(queued ? "unqueue" : "queue", event.eventId)}>
                              <Play className="mr-1 h-3 w-3" />{queued ? "Queued" : "Queue"}
                            </Button>
                            <Button size="sm" variant={isFeatured ? "default" : "ghost"} onClick={() => void act(isFeatured ? "clear" : "feature", event.eventId)}>
                              <Star className="mr-1 h-3 w-3" />{isFeatured ? "Featured" : "Feature"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => listen(event)} disabled={!event.text}>
                              {speakingEventId === event.eventId ? <VolumeX className="mr-1 h-3 w-3" /> : <Volume2 className="mr-1 h-3 w-3" />}
                              {speakingEventId === event.eventId ? "Stop" : "Listen"}
                            </Button>
                            {event.routing.canReply && event.platform === "twitch" && (
                              <Button size="sm" variant="ghost" onClick={() => setReplyEventId(replyEventId === event.eventId ? null : event.eventId)}>
                                <Send className="mr-1 h-3 w-3" />Reply
                              </Button>
                            )}
                            <Badge variant="outline" className="ml-auto">{event.routing.canReply ? "reply route known" : "view only"}</Badge>
                          </div>
                          {replyEventId === event.eventId && (
                            <form className="mt-2 flex gap-2" onSubmit={(formEvent) => {
                              formEvent.preventDefault();
                              if (replyText.trim()) void sendReply(event.eventId);
                            }}>
                              <Input value={replyText} onChange={(inputEvent) => setReplyText(inputEvent.target.value)} maxLength={500} placeholder={`Reply to ${event.sender.displayName} on Twitch…`} />
                              <Button type="submit" size="sm" disabled={!replyText.trim()}>Send</Button>
                            </form>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">On stream</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {featured ? (
                <div className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 p-3">
                  <div className="text-xs text-cyan-200">{featured.platform} · {featured.sender.displayName}</div>
                  <p className="mt-1 text-sm">{featured.text}</p>
                </div>
              ) : <p className="text-sm text-muted-foreground">No featured message.</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => void act("next")} disabled={operator.queuedEventIds.length === 0}><SkipForward className="mr-1 h-4 w-4" /> Next</Button>
                <Button size="sm" variant="outline" onClick={() => void act("clear")} disabled={!operator.featuredEventId}>Clear</Button>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                Auto-show first queued
                <Switch checked={operator.autoShow} onCheckedChange={(enabled) => void act("set-auto-show", undefined, enabled)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Auto-advance queue
                <Switch checked={operator.autoAdvance} onCheckedChange={(enabled) => void setFeatureOptions({ autoAdvance: enabled })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Duration
                <select
                  value={operator.featureDurationSeconds}
                  onChange={(event) => void setFeatureOptions({ durationSeconds: Number(event.target.value) })}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <option value={0}>Until cleared</option>
                  <option value={8}>8 seconds</option>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>60 seconds</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Style
                <select
                  value={operator.featureStyle}
                  onChange={(event) => void setFeatureOptions({ style: event.target.value as OperatorState["featureStyle"] })}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <option value="glass">Glass</option>
                  <option value="solid">Solid</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
              {tenantId && (
                <a
                  href={`/overlay/shared-chat-featured?tenant=${encodeURIComponent(tenantId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all rounded-md border p-2 text-xs text-cyan-200"
                >
                  Open featured-message OBS source
                </a>
              )}
            </CardContent>
          </Card>
          <Card className="min-h-0 flex-1">
            <CardHeader className="pb-2"><CardTitle className="text-base">Show queue · {operator.queuedEventIds.length}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {operator.queuedEventIds.length === 0 && <p className="text-muted-foreground">Queue a message from the feed.</p>}
                {operator.queuedEventIds.map((id, index) => {
                  const event = events.find((entry) => entry.eventId === id);
                  return (
                    <div key={id} className="rounded-md border p-2">
                      <span className="text-xs text-muted-foreground">#{index + 1} {event?.sender.displayName || "Message outside current filter"}</span>
                      <p className="line-clamp-2">{event?.text || id}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <div className="rounded-lg border border-amber-400/25 bg-amber-500/5 p-3 text-xs text-amber-100/80">
            Twitch replies use the tenant&apos;s verified outbound adapter. Discord, YouTube, Kick, and Social Stream moderation/replies stay view-only until their destination-scoped adapters are proven.
          </div>
        </div>
      </div>
    </div>
  );
}
