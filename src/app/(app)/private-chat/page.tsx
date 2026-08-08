"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";

const QWEN_ENDPOINT_OPTIONS = [
  { label: "MountainView rotator (Fly.io)", value: "https://mtman-machine-rotator.fly.dev" },
  { label: "Ollama local", value: "http://localhost:11434" },
  { label: "Custom...", value: "__custom__" },
];

const QWEN_MODEL_OPTIONS = [
  { label: "qwen2.5", value: "qwen2.5" },
  { label: "qwen2.5:7b", value: "qwen2.5:7b" },
  { label: "qwen2.5:14b", value: "qwen2.5:14b" },
  { label: "qwen2.5:32b", value: "qwen2.5:32b" },
  { label: "qwen2.5:72b", value: "qwen2.5:72b" },
  { label: "qwen3", value: "qwen3" },
  { label: "qwen3:8b", value: "qwen3:8b" },
  { label: "qwen3:14b", value: "qwen3:14b" },
  { label: "qwen3:32b", value: "qwen3:32b" },
  { label: "Custom...", value: "__custom__" },
];
import { useToast } from "@/hooks/use-toast";

interface Message {
  type: "user" | "ai";
  username: string;
  message: string;
  timestamp: string;
}

interface PrivateChatSettings {
  adultMode: boolean;
  qwenBaseUrl: string;
  qwenModel: string;
  qwenEndpointConfigured: boolean;
  qwenModelConfigured: boolean;
  qwenApiKeyConfigured: boolean;
}

const defaultSettings: PrivateChatSettings = {
  adultMode: false,
  qwenBaseUrl: "",
  qwenModel: "",
  qwenEndpointConfigured: false,
  qwenModelConfigured: false,
  qwenApiKeyConfigured: false,
};

export default function PrivateChatPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<PrivateChatSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customUrl, setCustomUrl] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chatResponse, settingsResponse] = await Promise.all([
        fetch("/api/private-chat", { cache: "no-store" }),
        fetch("/api/private-chat/settings", { cache: "no-store" }),
      ]);
      if (chatResponse.ok) {
        const data = await chatResponse.json();
        setMessages(data.messages || data.data?.messages || []);
      }
      if (settingsResponse.ok) {
        const data = await settingsResponse.json();
        const loaded = { ...defaultSettings, ...(data.settings || data.data?.settings || {}) };
        setSettings(loaded);
        setCustomUrl(!QWEN_ENDPOINT_OPTIONS.some((o) => o.value === loaded.qwenBaseUrl && o.value !== "__custom__") && loaded.qwenBaseUrl !== "");
        setCustomModel(!QWEN_MODEL_OPTIONS.some((o) => o.value === loaded.qwenModel && o.value !== "__custom__") && loaded.qwenModel !== "");
      }
    } catch {
      // Keep the page usable if one private endpoint is temporarily offline.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = async () => {
    if (!confirm("Clear all private chat history?")) return;
    await fetch("/api/private-chat", { method: "DELETE" });
    setMessages([]);
    toast({ title: "Cleared" });
  };

  const saveSettings = async (patch: Partial<PrivateChatSettings> = {}) => {
    setSaving(true);
    const next = { ...settings, ...patch };
    try {
      const response = await fetch("/api/private-chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultMode: next.adultMode,
          qwenBaseUrl: next.qwenBaseUrl,
          qwenModel: next.qwenModel,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Settings were not saved");
      const saved = data.settings || data.data?.settings;
      if (saved) setSettings({ ...defaultSettings, ...saved });
      else setSettings(next);
      toast({ title: "Private Qwen settings saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Private chat settings were not saved",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const statusText = [
    settings.qwenEndpointConfigured ? "endpoint ready" : "endpoint missing",
    settings.qwenModelConfigured ? "model ready" : "model missing",
    settings.qwenApiKeyConfigured ? "server key set" : "no server key",
  ].join(" · ");

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adult Mode and hosted Qwen</CardTitle>
          <CardDescription>
            Adult Mode sends private DMs only to the Qwen endpoint that you control. It does not fall back to EdenAI, Gemini, OpenAI, or SeaArt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
            <div>
              <Label htmlFor="adult-mode">Adult Mode</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Fictional roleplay is limited to consenting adults age 18 or older. If Qwen is unavailable, Athena reports the failure without forwarding the prompt elsewhere.
              </p>
            </div>
            <Switch
              id="adult-mode"
              checked={settings.adultMode}
              onCheckedChange={(adultMode) => {
                setSettings((current) => ({ ...current, adultMode }));
                void saveSettings({ adultMode });
              }}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qwen-url">Qwen API base URL</Label>
            <Select
              value={customUrl ? "__custom__" : (settings.qwenBaseUrl || "")}
              onValueChange={(v) => {
                if (v === "__custom__") { setCustomUrl(true); return; }
                setCustomUrl(false);
                setSettings((c) => ({ ...c, qwenBaseUrl: v }));
              }}
            >
              <SelectTrigger id="qwen-url"><SelectValue placeholder="Select endpoint..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— use server env var —</SelectItem>
                {QWEN_ENDPOINT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {customUrl && (
              <Input
                value={settings.qwenBaseUrl}
                onChange={(e) => setSettings((c) => ({ ...c, qwenBaseUrl: e.target.value }))}
                placeholder="https://your-qwen-host/v1"
              />
            )}
            <p className="text-xs text-muted-foreground">Leave blank to use PRIVATE_QWEN_BASE_URL server secret.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qwen-model">Qwen model</Label>
            <Select
              value={customModel ? "__custom__" : (settings.qwenModel || "")}
              onValueChange={(v) => {
                if (v === "__custom__") { setCustomModel(true); return; }
                setCustomModel(false);
                setSettings((c) => ({ ...c, qwenModel: v }));
              }}
            >
              <SelectTrigger id="qwen-model"><SelectValue placeholder="Select model..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— use server env var —</SelectItem>
                {QWEN_MODEL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {customModel && (
              <Input
                value={settings.qwenModel}
                onChange={(e) => setSettings((c) => ({ ...c, qwenModel: e.target.value }))}
                placeholder="model name exposed by your server"
              />
            )}
            <p className="text-xs text-muted-foreground">Leave blank to use PRIVATE_QWEN_MODEL. API key stays server-side in PRIVATE_QWEN_API_KEY.</p>
          </div>

          <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            Qwen status: {statusText}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void saveSettings()} disabled={saving}>
              {saving ? "Saving..." : "Save Qwen settings"}
            </Button>
            <span className="text-xs text-muted-foreground">
              DM commands: <code>adult mode on</code>, <code>adult mode off</code>, and <code>adult mode status</code>.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Private Chat History</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clear}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <ScrollArea className="h-[70vh]">
              <div className="space-y-3 pr-4">
                {messages.map((entry, index) => (
                  <div key={index} className={`flex flex-col ${entry.type === "user" ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${entry.type === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap">{entry.message.replace("[Private conversation] ", "")}</p>
                    </div>
                    <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                      {entry.username} · {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
