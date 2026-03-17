"use client";

import { useEffect, useRef, useState } from "react";
import { useLogPanel } from "./log-panel-context";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
}

let nextId = 0;

export function LogPanel() {
  const { visible, setVisible } = useLogPanel();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;

    const wsPort = process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || "8090";
    const wsHost = process.env.NEXT_PUBLIC_STREAMWEAVE_WS_HOST || "127.0.0.1";
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(`ws://${wsHost}:${wsPort}`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log" || data.type === "server-log") {
            setLogs((prev) => {
              const entry: LogEntry = {
                id: nextId++,
                timestamp: new Date().toLocaleTimeString(),
                message: typeof data.payload === "string" ? data.payload : data.payload?.message || JSON.stringify(data.payload),
              };
              const updated = [...prev, entry];
              return updated.length > 500 ? updated.slice(-500) : updated;
            });
          }
        } catch {}
      };
    } catch {}

    return () => {
      ws?.close();
    };
  }, [visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (!visible) return null;

  return (
    <div className="border-t bg-card mt-4">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Logs</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setVisible(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="h-48">
        <div className="p-2 font-mono text-xs space-y-0.5">
          {logs.length === 0 && (
            <p className="text-muted-foreground text-center py-4">No logs yet</p>
          )}
          {logs.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="text-muted-foreground shrink-0">{entry.timestamp}</span>
              <span className="break-all">{entry.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
