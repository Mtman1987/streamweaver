"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message {
  type: "user" | "ai";
  username: string;
  message: string;
  timestamp: string;
}

interface PrivateChatSettings {
  adultMode: boolean;
  qwenProvider: "spmt-qwen";
  qwenModel: string;
  qwenTransport: "fly-private-network";
  qwenReady: boolean;
}

const defaultSettings: PrivateChatSettings = {
  adultMode: false,
  qwenProvider: "spmt-qwen",
  qwenModel: "spmt-qwen3-4b",
  qwenTransport: "fly-private-network",
  qwenReady: true,
};

export default function PrivateChatPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<PrivateChatSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    if (!confirm("Clear all private chat history?")) return;
    await fetch("/api/private-chat", { method: "DELETE" });
    setMessages([]);
    toast({ title: "Cleared" });
  };

  const saveAdultMode = async (adultMode: boolean) => {
    setSaving(true);
    setSettings((current) => ({ ...current, adultMode }));
    try {
      const response = await fetch("/api/private-chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultMode }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Adult Mode was not saved");
      const saved = data.settings || data.data?.settings;
      if (saved) setSettings({ ...defaultSettings, ...saved });
      toast({ title: `Adult Mode ${adultMode ? "enabled" : "disabled"}` });
    } catch (error) {
      setSettings((current) => ({ ...current, adultMode: !adultMode }));
      toast({
        variant: "destructive",
        title: "Adult Mode was not saved",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adult Mode — SPMT Qwen</CardTitle>
          <CardDescription>
            Private Discord DMs use the Qwen worker that already runs for SPMT. There is no URL, model, GPU-host, or API-key setup on this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
            <div>
              <Label htmlFor="adult-mode">Adult Mode</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                When enabled, Athena routes this tenant&apos;s private Discord conversation to SPMT Qwen only. It does not fall back to EdenAI, Gemini, OpenAI, or SeaArt.
              </p>
            </div>
            <Switch
              id="adult-mode"
              checked={settings.adultMode}
              onCheckedChange={(adultMode) => void saveAdultMode(adultMode)}
              disabled={saving}
            />
          </div>

          <div className="rounded-md border px-3 py-3 text-sm">
            <div className="font-medium">Current private model: {settings.qwenModel}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              SPMT-owned Qwen worker · private Fly network · {settings.qwenReady ? "ready by configuration" : "unavailable"}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            DM controls: <code>adult mode on</code>, <code>adult mode off</code>, <code>adult mode toggle</code>, or <code>adult mode status</code>.
          </p>
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
