"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getBrowserWebSocketUrl } from "@/lib/ws-config";

type FlowLogEvent = {
  actionId?: string;
  actionName?: string;
  trigger?: string;
  type: string;
  message: string;
  nodeId?: string;
  label?: string;
  outcome?: string;
  error?: string;
  timestamp?: number;
};

type GroupedFlowLogs = Record<string, FlowLogEvent[]>;

export function FlowRunViewer() {
  const [events, setEvents] = useState<FlowLogEvent[]>([]);
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  useEffect(() => {
    const wsUrl = getBrowserWebSocketUrl();
    if (!wsUrl) return;
    let cancelled = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(wsUrl);
      setStatus('connecting');

      socket.onopen = () => {
        if (cancelled) return;
        setStatus('connected');
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'flow-log') {
            const payload = data.payload ?? {};
            setEvents(prev => [
              ...prev,
              {
                ...payload,
                timestamp: payload.timestamp || Date.now(),
              },
            ]);
          }
        } catch (error) {
          console.error('[Flow Viewer] Failed to parse log', error);
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus('disconnected');
        setTimeout(connect, 4000);
      };

      socket.onerror = (event) => {
        console.warn('[Flow Viewer] WebSocket error, retrying...', event);
        setStatus('disconnected');
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);

  const grouped = useMemo<GroupedFlowLogs>(() => {
    const map: GroupedFlowLogs = {};
    for (const event of events) {
      const key = event.actionId
        ? `${event.actionId}:${event.trigger || ''}`
        : `flow:${event.trigger || 'unknown'}`;
      map[key] = map[key] ? [...map[key], event] : [event];
    }
    return map;
  }, [events]);

  const statusVariant =
    status === 'connected' ? 'default' : status === 'connecting' ? 'secondary' : 'destructive';

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row justify-between items-center">
        <div>
          <CardTitle>Flow Run Debugger</CardTitle>
          <CardDescription>Live node-by-node execution logs.</CardDescription>
        </div>
        <Badge variant={statusVariant}>{status.toUpperCase()}</Badge>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-4">
          <div className="space-y-6">
            {Object.entries(grouped)
              .reverse()
              .map(([key, logs]) => {
                const [actionId, trigger] = key.split(':');
                const header = logs[0];
                return (
                  <div key={key} className="border rounded-md p-4 bg-muted/30">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-semibold">
                          {header.actionName || 'Unnamed Action'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Trigger: {trigger || header.trigger || 'N/A'}
                        </p>
                      </div>
                      <Badge>{new Date(logs[0].timestamp || Date.now()).toLocaleTimeString()}</Badge>
                    </div>
                    <Separator className="my-3" />
                    <div className="space-y-3 text-sm">
                      {logs.map((event, index) => (
                        <div
                          key={`${event.timestamp}-${index}`}
                          className={cn(
                            'border-l pl-3 py-1',
                            event.type === 'node-error'
                              ? 'border-destructive text-destructive'
                              : event.type === 'node-complete'
                              ? 'border-primary'
                              : 'border-muted-foreground/40'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{event.type}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {event.nodeId ? `Node: ${event.label || event.nodeId}` : 'Flow'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {event.outcome ? `Outcome: ${event.outcome}` : ''}
                            </span>
                          </div>
                          <p>{event.message}</p>
                          {event.error && (
                            <pre className="text-xs text-destructive/80 whitespace-pre-wrap mt-1">
                              {event.error}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Waiting for flow runs… Trigger a command to see step-by-step telemetry.
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
