'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type FileKey = 'actions' | 'commands' | 'private-chat' | 'public-chat' | 'points' | 'point-settings' | 'channel-point-rewards';

type FileSnapshot = {
  file: FileKey;
  path: string;
  mtimeMs: number;
  size: number;
  count: number | null;
  preview: string;
};

async function fetchSnapshot(file: FileKey): Promise<FileSnapshot> {
  const res = await fetch(`/api/debug/data-files?file=${file}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || res.statusText || 'Failed to fetch');
  }
  return res.json();
}

export default function DebugDataFilesPage() {
  const [selected, setSelected] = useState<FileKey>('actions');
  const [polling, setPolling] = useState(true);
  const [snapshot, setSnapshot] = useState<FileSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastUpdated = useMemo(() => {
    if (!snapshot) return '—';
    return new Date(snapshot.mtimeMs).toLocaleString();
  }, [snapshot]);

  const load = async () => {
    try {
      setError(null);
      const next = await fetchSnapshot(selected);
      setSnapshot(next);
    } catch (e: any) {
      setError(e?.message || 'Failed to load file');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      void load();
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, selected]);

  return (
    <div className="container mx-auto p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Live Data Files</CardTitle>
          <CardDescription>
            Watch actions/commands JSON update in real time. This is raw text (no highlighting).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selected === 'actions' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('actions')}
            >
              actions.json
            </Button>
            <Button
              variant={selected === 'commands' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('commands')}
            >
              commands.json
            </Button>
            <Button
              variant={selected === 'private-chat' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('private-chat')}
            >
              private-chat.json
            </Button>
            <Button
              variant={selected === 'points' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('points')}
            >
              points.json
            </Button>
            <Button
              variant={selected === 'point-settings' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('point-settings')}
            >
              point-settings.json
            </Button>
            <Button
              variant={selected === 'channel-point-rewards' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('channel-point-rewards')}
            >
              channel-point-rewards.json
            </Button>
            <Button variant="outline" size="sm" onClick={load}>
              Refresh now
            </Button>
            <Button
              variant={polling ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPolling((v) => !v)}
            >
              {polling ? 'Polling: On' : 'Polling: Off'}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <div>Last update: {lastUpdated}</div>
            <div>Count: {snapshot?.count ?? '—'} | Size: {snapshot?.size ?? '—'} bytes</div>
            <div className="break-all">Path: {snapshot?.path ?? '—'}</div>
          </div>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          <label htmlFor="live-file-contents" className="sr-only">
            Live file contents
          </label>
          <textarea
            id="live-file-contents"
            value={snapshot?.preview ?? ''}
            readOnly
            className="w-full h-[70vh] rounded-md border bg-background p-3 font-mono text-xs"
            spellCheck={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
