'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type FileKey = 'actions' | 'commands' | 'private-chat' | 'public-chat' | 'points' | 'point-settings' | 'channel-point-rewards' | 'shoutout-audit' | 'fly-logs' | 'gen-mode' | 'gen-settings' | 'dm-sweep-state' | 'generated-images-index';

type FileSnapshot = {
  file: FileKey;
  path: string;
  mtimeMs: number;
  size: number;
  count: number | null;
  preview: string;
};

async function fetchSnapshot(file: FileKey, tenantId?: string, username?: string): Promise<FileSnapshot> {
  const params = new URLSearchParams({ file });
  if (tenantId) params.set('tenantId', tenantId);
  if (file === 'shoutout-audit' && username?.trim()) {
    params.set('username', username.trim().replace(/^@/, ''));
  }
  const res = await fetch(`/api/debug/data-files?${params.toString()}`, { cache: 'no-store' });
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
  const [streamerFilter, setStreamerFilter] = useState('');
  const [tenantId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('tenantId') || '';
  });

  const lastUpdated = useMemo(() => {
    if (!snapshot) return '—';
    return new Date(snapshot.mtimeMs).toLocaleString();
  }, [snapshot]);

  const load = async () => {
    try {
      setError(null);
      const next = await fetchSnapshot(selected, tenantId, streamerFilter);
      setSnapshot(next);
    } catch (e: any) {
      setError(e?.message || 'Failed to load file');
    }
  };

  const downloadUrl = selected === 'shoutout-audit'
    ? `/api/shoutout-audit/download${(() => {
        const params = new URLSearchParams();
        if (tenantId) params.set('tenantId', tenantId);
        if (streamerFilter.trim()) params.set('username', streamerFilter.trim().replace(/^@/, ''));
        const query = params.toString();
        return query ? `?${query}` : '';
      })()}`
    : null;

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, streamerFilter]);

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      void load();
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, selected, streamerFilter]);

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
            <Button
              variant={selected === 'shoutout-audit' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('shoutout-audit')}
            >
              shoutout-audit.json
            </Button>

            <Button
              variant={selected === 'gen-mode' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('gen-mode')}
            >
              gen-mode.json
            </Button>
            <Button
              variant={selected === 'gen-settings' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('gen-settings')}
            >
              gen-settings.json
            </Button>
            <Button
              variant={selected === 'dm-sweep-state' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('dm-sweep-state')}
            >
              dm-sweep-state.json
            </Button>
            <Button
              variant={selected === 'generated-images-index' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('generated-images-index')}
            >
              generated-images-index.json
            </Button>
            <Button
              variant={selected === 'fly-logs' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelected('fly-logs')}
            >
              fly-logs.txt
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

          {selected === 'shoutout-audit' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={streamerFilter}
                onChange={(event) => setStreamerFilter(event.target.value)}
                placeholder="streamer username"
                className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
              />
              <Button asChild size="sm" variant="outline">
                <a href={`/api/shoutout-audit/download${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`}>Download all</a>
              </Button>
              <Button asChild size="sm" variant="outline" disabled={!downloadUrl}>
                <a href={downloadUrl || '/api/shoutout-audit/download'}>Download filtered</a>
              </Button>
            </div>
          )}

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
