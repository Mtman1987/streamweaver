"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Images, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AUTO_QWEN_MODEL = "spmt-qwen3-4b";

interface Message {
  type: "user" | "ai";
  username: string;
  message: string;
  timestamp: string;
}

interface PrivateChatSettings {
  adultMode: boolean;
  ttsEnabled: boolean;
  gifEnabled: boolean;
  qwenBaseUrl: string;
  qwenModel: string;
  configuredQwenModel: string;
  effectiveQwenModel: string;
  availableQwenModels: string[];
  qwenAutoSelectEnabled: boolean;
  qwenModelDiscoveryAvailable: boolean;
  qwenEndpointConfigured: boolean;
  qwenModelConfigured: boolean;
  qwenApiKeyConfigured: boolean;
}

const defaultSettings: PrivateChatSettings = {
  adultMode: false,
  ttsEnabled: false,
  gifEnabled: true,
  qwenBaseUrl: "",
  qwenModel: AUTO_QWEN_MODEL,
  configuredQwenModel: AUTO_QWEN_MODEL,
  effectiveQwenModel: AUTO_QWEN_MODEL,
  availableQwenModels: [],
  qwenAutoSelectEnabled: true,
  qwenModelDiscoveryAvailable: false,
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
  const [savingModel, setSavingModel] = useState(false);

  const modelOptions = useMemo(() => {
    const options = new Set<string>(settings.availableQwenModels || []);
    if (settings.configuredQwenModel && settings.configuredQwenModel !== AUTO_QWEN_MODEL) {
      options.add(settings.configuredQwenModel);
    }
    return [...options].filter((model) => model && model !== AUTO_QWEN_MODEL);
  }, [settings.availableQwenModels, settings.configuredQwenModel]);

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
        setSettings({ ...defaultSettings, ...(data.settings || data.data?.settings || {}) });
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
    if (!confirm("Clear all private chat history for this StreamWeaver account?")) return;
    await fetch("/api/private-chat", { method: "DELETE" });
    setMessages([]);
    toast({ title: "Private chat history cleared" });
  };

  const setAdultMode = async (adultMode: boolean) => {
    setSaving(true);
    setSettings((current) => ({ ...current, adultMode }));
    try {
      const response = await fetch("/api/private-chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultMode }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Setting was not saved");
      const saved = data.settings || data.data?.settings;
      if (saved) setSettings({ ...defaultSettings, ...saved });
      toast({ title: `Adult Mode ${adultMode ? "enabled" : "disabled"}` });
    } catch (error) {
      setSettings((current) => ({ ...current, adultMode: !adultMode }));
      toast({
        variant: "destructive",
        title: "Private chat setting was not saved",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const setQwenModel = async (qwenModel: string) => {
    const previous = settings;
    setSavingModel(true);
    setSettings((current) => ({
      ...current,
      qwenModel,
      configuredQwenModel: qwenModel,
    }));
    try {
      const response = await fetch("/api/private-chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qwenModel }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Model selection was not saved");
      const saved = data.settings || data.data?.settings;
      if (saved) setSettings({ ...defaultSettings, ...saved });
      toast({
        title: qwenModel === AUTO_QWEN_MODEL ? "Private model set to Auto" : "Private model updated",
        description: saved?.effectiveQwenModel
          ? `Athena will use ${saved.effectiveQwenModel}.`
          : undefined,
      });
    } catch (error) {
      setSettings(previous);
      toast({
        variant: "destructive",
        title: "Private model was not changed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingModel(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Private Chat</CardTitle>
              <CardDescription>
                These settings and this history belong to your signed-in StreamWeaver tenant. The SPMT worker URL stays managed by StreamWeaver, while the model selector below shows what the private worker actually advertises.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/private-gallery" target="_blank" rel="noreferrer">
                <Images className="mr-2 h-4 w-4" />
                Open private gallery
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
            <div>
              <Label htmlFor="adult-mode">Adult Mode</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                This changes Athena&apos;s private-chat policy only. It does not switch to a different moderation path or provider.
              </p>
            </div>
            <Switch
              id="adult-mode"
              checked={settings.adultMode}
              onCheckedChange={(enabled) => void setAdultMode(enabled)}
              disabled={saving}
            />
          </div>

          <div className="space-y-3 rounded-md border px-3 py-3 text-sm">
            <div>
              <div className="font-medium">Private LLM</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {`Effective runtime model: ${settings.effectiveQwenModel || settings.qwenModel || "SPMT Qwen"}`}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="private-qwen-model">Model selection</Label>
              <select
                id="private-qwen-model"
                value={settings.configuredQwenModel || AUTO_QWEN_MODEL}
                disabled={savingModel}
                onChange={(event) => void setQwenModel(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={AUTO_QWEN_MODEL}>
                  {`Auto — best available (4B fallback${settings.qwenAutoSelectEnabled && settings.effectiveQwenModel ? `; now ${settings.effectiveQwenModel}` : ""})`}
                </option>
                {modelOptions.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {settings.qwenModelDiscoveryAvailable
                  ? `Worker currently advertises: ${settings.availableQwenModels.join(", ")}.`
                  : "The worker model list could not be read right now. Auto safely falls back to spmt-qwen3-4b."}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            DM controls also accept <code>adult mode on</code>, <code>adult mode off</code>, and <code>adult mode status</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Private Chat History</CardTitle>
            <CardDescription>Only the current tenant&apos;s private conversation history is shown here.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clear} aria-label="Clear private chat history">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No private messages yet.</p>
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
