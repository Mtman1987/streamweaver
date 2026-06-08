"use client";

import * as React from "react";
import Image from "next/image";
import { Loader2, MessageSquare, Mic, MicOff, Monitor, MonitorOff, RefreshCw, Send, Volume2, VolumeX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type DiscordChannelOption = {
  id: string;
  name: string;
  type?: number;
  purpose?: string;
};

type DiscordMention = {
  id: string;
  username: string;
  global_name?: string | null;
};

type DiscordAttachment = {
  id: string;
  url: string;
  filename: string;
  content_type?: string;
};

type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  image?: { url?: string };
  thumbnail?: { url?: string };
  author?: { name?: string; icon_url?: string; url?: string };
  fields?: Array<{ name?: string; value?: string; inline?: boolean }>;
  footer?: { text?: string; icon_url?: string };
};

type DiscordMessage = {
  id: string;
  content?: string;
  timestamp?: string;
  mentions?: DiscordMention[];
  attachments?: DiscordAttachment[];
  embeds?: DiscordEmbed[];
  author?: {
    id?: string;
    username?: string;
    global_name?: string;
    avatar?: string | null;
    bot?: boolean;
  };
};

type ChatTarget = "discord" | "twitch";
type AppMemoryMessage = {
  type: "user" | "ai";
  username: string;
  message: string;
  timestamp: string;
};

const APP_PRIVATE_CHANNEL_ID = "__app_private__";
const APP_PUBLIC_CHANNEL_ID = "__app_public__";

function useSpeechToText() {
  const [isListening, setIsListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const recognitionRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let next = "";
      for (let index = 0; index < event.results.length; index += 1) {
        next += event.results[index][0].transcript;
      }
      setTranscript(next);
    };
    recognition.onerror = (event: any) => {
      setError(String(event?.error || "Speech recognition failed."));
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const start = React.useCallback(() => {
    setError(null);
    setTranscript("");
    recognitionRef.current?.start();
    setIsListening(true);
  }, []);

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, transcript, error, start, stop };
}

function channelIcon(type?: number) {
  if (type === 5) return "📢";
  if (type === 2) return "🔊";
  if (type === 11) return "🧵";
  if (type === 13) return "🎭";
  return "#";
}

function discordAvatarUrl(message: DiscordMessage): string | undefined {
  const author = message.author;
  if (!author?.id || !author.avatar) return undefined;
  const ext = author.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${ext}`;
}

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ParsedMessageContent({ content, mentions }: { content: string; mentions?: DiscordMention[] }) {
  const parts = React.useMemo(() => {
    if (!content) return [];
    const decoded = content
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    const regex = /(<@!?(\d+)>)|(<a?:\w+:(\d+)>)|(https?:\/\/[^\s]+)/g;
    const elements: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(decoded)) !== null) {
      if (match.index > lastIndex) {
        elements.push(decoded.substring(lastIndex, match.index));
      }

      const [fullMatch, mention, userId, emoji, emojiId, url] = match;
      if (mention && userId) {
        const user = mentions?.find((entry) => entry.id === userId);
        const username = user?.global_name || user?.username || "unknown-user";
        elements.push(
          <strong key={`mention-${match.index}`} className="rounded-sm bg-primary/10 px-1 py-0.5 text-primary">
            @{username}
          </strong>
        );
      } else if (emoji && emojiId) {
        const animated = fullMatch.startsWith("<a:");
        elements.push(
          <Image
            key={`emoji-${match.index}`}
            src={`https://cdn.discordapp.com/emojis/${emojiId}.${animated ? "gif" : "png"}`}
            alt={fullMatch}
            width={20}
            height={20}
            unoptimized
            className="mx-0.5 inline-block"
          />
        );
      } else if (url) {
        if (/\.(gif|jpe?g|png|webp)$/i.test(url)) {
          elements.push(
            <a key={`image-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <Image src={url} alt="Embedded media" width={320} height={220} unoptimized className="max-w-xs rounded-md" />
            </a>
          );
        } else {
          elements.push(
            <a key={`url-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
              {url}
            </a>
          );
        }
      }
      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < decoded.length) {
      elements.push(decoded.substring(lastIndex));
    }
    return elements;
  }, [content, mentions]);

  return <div className="whitespace-pre-wrap text-sm leading-6">{parts}</div>;
}

function AttachmentRenderer({ attachment }: { attachment: DiscordAttachment }) {
  const isImage = attachment.content_type?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(attachment.filename);
  const isVideo = attachment.content_type?.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(attachment.filename);

  if (isImage) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
        <Image src={attachment.url} alt={attachment.filename} width={420} height={260} unoptimized className="max-w-sm rounded-md" />
      </a>
    );
  }

  if (isVideo) {
    return <video src={attachment.url} controls className="mt-2 max-w-sm rounded-md" />;
  }

  return (
    <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-accent hover:underline">
      Attachment: {attachment.filename}
    </a>
  );
}

function EmbedRenderer({ embed }: { embed: DiscordEmbed }) {
  const borderColor = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : "#5865F2";
  return (
    <div className="mt-2 max-w-md rounded bg-muted/40 p-3" style={{ borderLeft: `4px solid ${borderColor}` }}>
      {embed.author?.name ? (
        <div className="mb-1 flex items-center gap-2">
          {embed.author.icon_url ? <Image src={embed.author.icon_url} alt="" width={20} height={20} unoptimized className="rounded-full" /> : null}
          <span className="text-xs font-semibold">{embed.author.name}</span>
        </div>
      ) : null}
      {embed.title ? (
        <div className="text-sm font-semibold">
          {embed.url ? (
            <a href={embed.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {embed.title}
            </a>
          ) : (
            embed.title
          )}
        </div>
      ) : null}
      {embed.description ? <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{embed.description}</div> : null}
      {embed.fields?.length ? (
        <div className="mt-2 grid gap-1">
          {embed.fields.map((field, index) => (
            <div key={`field-${index}`} className={field.inline ? "inline-block mr-4" : ""}>
              <div className="text-xs font-semibold">{field.name}</div>
              <div className="text-xs text-muted-foreground">{field.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {embed.thumbnail?.url ? <Image src={embed.thumbnail.url} alt="" width={96} height={96} unoptimized className="mt-2 rounded-md" /> : null}
      {embed.image?.url ? <Image src={embed.image.url} alt="" width={420} height={260} unoptimized className="mt-2 rounded-md" /> : null}
      {embed.footer?.text ? (
        <div className="mt-2 flex items-center gap-1">
          {embed.footer.icon_url ? <Image src={embed.footer.icon_url} alt="" width={16} height={16} unoptimized className="rounded-full" /> : null}
          <span className="text-xs text-muted-foreground">{embed.footer.text}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function ChatPage() {
  const { toast } = useToast();
  const [target, setTarget] = React.useState<ChatTarget>("discord");
  const [discordChannels, setDiscordChannels] = React.useState<DiscordChannelOption[]>([]);
  const [selectedDiscordChannel, setSelectedDiscordChannel] = React.useState("");
  const [messages, setMessages] = React.useState<DiscordMessage[]>([]);
  const [messageText, setMessageText] = React.useState("");
  const [isLoadingMessages, setIsLoadingMessages] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [twitchChannel, setTwitchChannel] = React.useState("");
  const [twitchSender, setTwitchSender] = React.useState<"broadcaster" | "bot">("broadcaster");
  const [showTwitchVideo, setShowTwitchVideo] = React.useState(false);
  const [twitchMuted, setTwitchMuted] = React.useState(false);
  const [profile, setProfile] = React.useState<{ name?: string; avatar?: string }>({});
  const speech = useSpeechToText();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeChannel = React.useMemo(
    () => discordChannels.find((channel) => channel.id === selectedDiscordChannel),
    [discordChannels, selectedDiscordChannel],
  );

  const loadChatConfig = React.useCallback(async () => {
    const [settingsResponse, profileResponse] = await Promise.all([
      fetch("/api/discord/channels", { cache: "no-store" }).catch(() => null),
      fetch("/api/user-profile", { cache: "no-store" }).catch(() => null),
    ]);

    const settings = settingsResponse?.ok ? await settingsResponse.json().catch(() => ({})) : {};
    const profileBody = profileResponse?.ok ? await profileResponse.json().catch(() => ({})) : {};
    const guildId = String(settings?.guildId || "").trim();

    let discoveredChannels: DiscordChannelOption[] = [];
    if (guildId) {
      const guildResponse = await fetch(`/api/discord/guilds/${encodeURIComponent(guildId)}?membersLimit=1`, { cache: "no-store" }).catch(() => null);
      const guildBody = guildResponse?.ok ? await guildResponse.json().catch(() => ({})) : {};
      const guildChannels = Array.isArray(guildBody?.channels) ? guildBody.channels : [];
      discoveredChannels = guildChannels
        .filter((channel: any) => [0, 5, 10, 11, 12, 15].includes(Number(channel.type)))
        .sort((a: any, b: any) => Number(a.position ?? 0) - Number(b.position ?? 0))
        .map((channel: any) => ({
          id: String(channel.id),
          name: String(channel.name || channel.id),
          type: Number(channel.type),
        }));
    }

    const pinned = [
      { id: APP_PRIVATE_CHANNEL_ID, name: "App private memory", type: 1, purpose: "Discord DMs and private app chat" },
      { id: APP_PUBLIC_CHANNEL_ID, name: "App public memory", type: 0, purpose: "Twitch chat and public Discord messages" },
      settings.dmChannelId ? { id: String(settings.dmChannelId), name: "Private DMs", type: 1, purpose: "Private broadcaster replies" } : null,
      settings.aiChatChannelId ? { id: String(settings.aiChatChannelId), name: "AI chat", purpose: "AI conversation" } : null,
      settings.logChannelId ? { id: String(settings.logChannelId), name: "Log channel", purpose: "Logs and bridge history" } : null,
      settings.shoutoutChannelId ? { id: String(settings.shoutoutChannelId), name: "Shoutouts", purpose: "Share posts and shoutouts" } : null,
    ].filter(Boolean) as DiscordChannelOption[];

    const merged = [...pinned, ...discoveredChannels].filter(
      (channel, index, list) => list.findIndex((entry) => entry.id === channel.id) === index,
    );

    setDiscordChannels(merged);
    setSelectedDiscordChannel((current) => current || APP_PRIVATE_CHANNEL_ID);

    const twitchName = String(profileBody?.twitch?.name || "").trim().toLowerCase();
    setProfile({ name: twitchName, avatar: profileBody?.twitch?.avatar || "" });
    setTwitchChannel((current) => current || twitchName);
  }, []);

  React.useEffect(() => {
    void loadChatConfig();
  }, [loadChatConfig]);

  React.useEffect(() => {
    if (speech.isListening) {
      setMessageText(speech.transcript);
    }
  }, [speech.isListening, speech.transcript]);

  const mapAppMemoryMessage = React.useCallback((message: AppMemoryMessage, index: number): DiscordMessage => ({
    id: `${message.timestamp}-${index}`,
    content: message.message.replace(/^\[Private conversation\]\s*/i, ""),
    timestamp: message.timestamp,
    author: {
      id: `${message.type}-${message.username}-${index}`,
      username: message.username,
      global_name: message.username,
      bot: message.type === "ai",
    },
  }), []);

  const fetchDiscordMessages = React.useCallback(async (silent = false) => {
    if (!selectedDiscordChannel) return;
    if (!silent) setIsLoadingMessages(true);
    try {
      if (selectedDiscordChannel === APP_PRIVATE_CHANNEL_ID) {
        const response = await fetch("/api/private-chat", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Failed to load private messages.");
        const appMessages = Array.isArray(body.messages) ? body.messages : [];
        setMessages(appMessages.map(mapAppMemoryMessage));
      } else if (selectedDiscordChannel === APP_PUBLIC_CHANNEL_ID) {
        const response = await fetch("/api/public-chat", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Failed to load public messages.");
        const appMessages = Array.isArray(body.messages) ? body.messages : [];
        setMessages(appMessages.map(mapAppMemoryMessage));
      } else {
        const response = await fetch(`/api/discord/chat-messages?channelId=${encodeURIComponent(selectedDiscordChannel)}&limit=75`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Failed to load Discord messages.");
        setMessages(Array.isArray(body.messages) ? [...body.messages].reverse() : []);
      }
    } catch (error: any) {
      if (!silent) {
        toast({ variant: "destructive", title: "Discord messages failed", description: error?.message || "Could not load messages." });
      }
    } finally {
      if (!silent) setIsLoadingMessages(false);
    }
  }, [mapAppMemoryMessage, selectedDiscordChannel, toast]);

  React.useEffect(() => {
    if (!selectedDiscordChannel) return;
    void fetchDiscordMessages();
    const timer = window.setInterval(() => void fetchDiscordMessages(true), 20000);
    return () => window.clearInterval(timer);
  }, [fetchDiscordMessages, selectedDiscordChannel]);

  React.useEffect(() => {
    const viewport = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  const refreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadChatConfig(), fetchDiscordMessages(true)]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const sendMessage = async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    try {
      if (target === "discord") {
        if (!selectedDiscordChannel) throw new Error("Choose a Discord channel first.");
        if (selectedDiscordChannel === APP_PRIVATE_CHANNEL_ID) {
          const response = await fetch("/api/private-chat/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: profile.name || "Commander",
              message: text,
              historyLimit: 20,
            }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body?.error || "Private chat send failed.");
        } else {
          const response = await fetch("/api/discord/send-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channelId: selectedDiscordChannel,
              message: text,
              username: profile.name || "StreamWeaver",
              avatarUrl: profile.avatar || undefined,
            }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body?.error || "Discord send failed.");
        }
        await fetchDiscordMessages(true);
      } else {
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, as: twitchSender }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Twitch send failed.");
      }

      setMessageText("");
      if (speech.isListening) speech.stop();
      toast({ title: "Message sent", description: target === "discord" ? "Posted to Discord." : "Sent to Twitch chat." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Send failed", description: error?.message || "Could not send message." });
    } finally {
      setIsSending(false);
    }
  };

  const twitchParent = typeof window === "undefined" ? "" : window.location.hostname;
  const twitchPlayerUrl = twitchChannel && twitchParent
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(twitchChannel)}&parent=${encodeURIComponent(twitchParent)}&muted=${twitchMuted ? "true" : "false"}`
    : "";
  const twitchChatUrl = twitchChannel && twitchParent
    ? `https://www.twitch.tv/embed/${encodeURIComponent(twitchChannel)}/chat?parent=${encodeURIComponent(twitchParent)}&darkpopout`
    : "";

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[42rem] flex-col gap-4 pb-6">
      {twitchPlayerUrl ? (
        <div
          className={showTwitchVideo ? "block" : "pointer-events-none fixed -left-[9999px] -top-[9999px] h-px w-px overflow-hidden"}
          aria-hidden={!showTwitchVideo}
        >
          <iframe
            src={twitchPlayerUrl}
            title={`Twitch stream for ${twitchChannel}`}
            className={showTwitchVideo ? "h-[240px] w-full rounded-2xl border border-border/70 bg-background" : "h-px w-px"}
            allowFullScreen
            allow="autoplay"
          />
        </div>
      ) : null}

      <Card className="border-border/70 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle>Messaging</CardTitle>
          <CardDescription>Browse real Discord channels, keep Twitch chat open beside it, and send through one shared composer.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2">
            <div className="text-sm font-medium">Discord channel</div>
            <Select value={selectedDiscordChannel} onValueChange={setSelectedDiscordChannel}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a Discord channel" />
              </SelectTrigger>
              <SelectContent>
                {discordChannels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channelIcon(channel.type)} {channel.name}{channel.purpose ? ` - ${channel.purpose}` : ""}
                  </SelectItem>
                ))}
                {discordChannels.length === 0 ? <SelectItem value="_none" disabled>No channels found</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_170px_110px]">
            <div className="space-y-2">
              <div className="text-sm font-medium">Twitch channel</div>
              <Input value={twitchChannel} onChange={(event) => setTwitchChannel(event.target.value.trim().toLowerCase())} placeholder="mtman1987" />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Video</div>
              <Button variant={showTwitchVideo ? "default" : "outline"} className="w-full" onClick={() => setShowTwitchVideo((current) => !current)}>
                {showTwitchVideo ? <Monitor className="mr-2 h-4 w-4" /> : <MonitorOff className="mr-2 h-4 w-4" />}
                {showTwitchVideo ? "Hide" : "Show"}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Audio</div>
              <Button variant="outline" className="w-full" onClick={() => setTwitchMuted((current) => !current)}>
                {twitchMuted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}
                {twitchMuted ? "Muted" : "Live"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="flex min-h-0 flex-col overflow-hidden border-border/70 bg-card/80">
          <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-base">
                {activeChannel?.id === APP_PRIVATE_CHANNEL_ID ? "Private chat" : activeChannel?.id === APP_PUBLIC_CHANNEL_ID ? "Public chat" : "Discord"}
              </CardTitle>
              <CardDescription>
                {activeChannel?.id === APP_PRIVATE_CHANNEL_ID
                  ? "Unified private memory from Discord DMs and app private chat."
                  : activeChannel?.id === APP_PUBLIC_CHANNEL_ID
                    ? "Unified public memory from Twitch chat and public Discord traffic."
                    : selectedDiscordChannel
                      ? "Recent messages from the selected channel."
                      : "Choose a Discord channel above."}
              </CardDescription>
            </div>
            <Badge variant="outline">{messages.length} loaded</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea ref={scrollRef} className="h-full pr-4">
              {isLoadingMessages ? (
                <div className="flex h-full min-h-[28rem] items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading Discord messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full min-h-[28rem] items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
                  No messages loaded.
                </div>
              ) : (
                <div className="space-y-4 pb-2">
                  {messages.map((message) => {
                    const author = message.author?.global_name || message.author?.username || "Unknown";
                    return (
                      <div key={message.id} className="flex gap-3 rounded-2xl border border-border/70 bg-background/35 p-3">
                        <Avatar className="h-10 w-10 border border-border/70">
                          <AvatarImage src={discordAvatarUrl(message)} alt={author} />
                          <AvatarFallback>{author.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-baseline gap-2">
                            <span className="font-medium">{author}</span>
                            {message.author?.bot ? <Badge variant="outline" className="text-[10px]">bot</Badge> : null}
                            <span className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</span>
                          </div>
                          {message.content ? <ParsedMessageContent content={message.content} mentions={message.mentions} /> : null}
                          {message.attachments?.map((attachment) => <AttachmentRenderer key={attachment.id} attachment={attachment} />)}
                          {message.embeds?.map((embed, index) => <EmbedRenderer key={`${message.id}-embed-${index}`} embed={embed} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden border-border/70 bg-card/80">
          <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-base">Twitch</CardTitle>
              <CardDescription>Keep chat visible while the stream player can stay playing in the background.</CardDescription>
            </div>
            <Badge variant="outline">
              <Monitor className="mr-1 h-3.5 w-3.5" />
              {twitchChannel || "No channel"}
            </Badge>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {showTwitchVideo && twitchPlayerUrl ? (
              <iframe src={twitchPlayerUrl} title={`Twitch player for ${twitchChannel}`} className="h-[240px] w-full rounded-2xl border border-border/70 bg-background" allowFullScreen allow="autoplay" />
            ) : null}
            {twitchChatUrl ? (
              <iframe src={twitchChatUrl} title={`Twitch chat for ${twitchChannel}`} className="min-h-0 flex-1 rounded-2xl border border-border/70 bg-background" />
            ) : (
              <div className="flex min-h-[28rem] flex-1 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
                Enter a Twitch channel to load chat.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="sticky bottom-4 z-10 border-border/70 bg-card/95 shadow-lg backdrop-blur">
        <CardContent className="grid gap-3 p-3 lg:grid-cols-[1fr_240px]">
          <Textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={2}
            placeholder={`Type or dictate a message for ${target === "discord" ? "Discord" : "Twitch"}...`}
            className="min-h-16 resize-none"
          />
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Tabs value={target} onValueChange={(value) => setTarget(value as ChatTarget)} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="discord">Discord</TabsTrigger>
                  <TabsTrigger value="twitch">Twitch</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" onClick={() => void refreshAll()} disabled={isRefreshing}>
                {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={speech.isListening ? "secondary" : "outline"} onClick={speech.isListening ? speech.stop : speech.start}>
                {speech.isListening ? <MicOff className="mr-2 h-4 w-4 text-red-500" /> : <Mic className="mr-2 h-4 w-4" />}
                {speech.isListening ? "Stop" : "Voice"}
              </Button>
              <Button onClick={() => void sendMessage()} disabled={isSending || !messageText.trim()}>
                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send
              </Button>
            </div>
            {target === "twitch" ? (
              <Select value={twitchSender} onValueChange={(value) => setTwitchSender(value as "broadcaster" | "bot")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="broadcaster">Send as broadcaster</SelectItem>
                  <SelectItem value="bot">Send as bot</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                Sending to the selected Discord channel.
              </div>
            )}
          </div>
          {speech.error ? <div className="text-xs text-destructive lg:col-span-2">{speech.error}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
