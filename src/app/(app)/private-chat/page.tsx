"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message {
  type: "user" | "ai";
  username: string;
  message: string;
  timestamp: string;
}

export default function PrivateChatPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/private-chat")
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const clear = async () => {
    if (!confirm("Clear all private chat history?")) return;
    await fetch("/api/private-chat", { method: "DELETE" });
    setMessages([]);
    toast({ title: "Cleared" });
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Private Chat History</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clear}><Trash2 className="h-4 w-4" /></Button>
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
                {messages.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.type === "user" ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.type === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap">{m.message.replace("[Private conversation] ", "")}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      {m.username} · {new Date(m.timestamp).toLocaleString()}
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
