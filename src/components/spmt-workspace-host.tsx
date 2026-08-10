'use client';

import * as React from 'react';
import { LayoutGrid, PanelsTopLeft, Settings, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';

const SPMT_ORIGIN = 'https://spmt.live';
const APP_ID = 'streamweaver';
type Surface = 'worktray' | 'settings' | 'overlays';
const SURFACE_URLS: Record<Surface, string> = { worktray: `${SPMT_ORIGIN}/embed/worktray?mode=dock&app=${APP_ID}`, settings: `${SPMT_ORIGIN}/embed/settings?mode=full&app=${APP_ID}`, overlays: `${SPMT_ORIGIN}/embed/overlays?mode=full&app=${APP_ID}` };
const SURFACE_META = {
  worktray: { label: 'Workspace', Icon: LayoutGrid },
  settings: { label: 'Settings', Icon: Settings },
  overlays: { label: 'Overlay Bay', Icon: PanelsTopLeft },
} satisfies Record<Surface, { label: string; Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }>;

export function SpmtWorkspaceHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname) || pathname.startsWith('/overlay/') || pathname === '/quackverse-overlay';
  const [embedded, setEmbedded] = React.useState(true);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [surface, setSurface] = React.useState<Surface>('worktray');
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) { setConnected(false); return; }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) return;
      setTokens(body.tokens as WorkspaceThemeTokensV1);
      setConnected(true);
    } catch { setConnected(false); }
  }, [hiddenRoute]);
  React.useEffect(() => { setEmbedded(window.self !== window.top); void refresh(); }, [refresh]);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh().finally(() => window.dispatchEvent(new Event('focus')));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);
  if (hiddenRoute || embedded || !connected) return null;
  const overlay = tokens?.overlayWorkspace;
  const widgets = overlay?.enabled ? (overlay.widgets || []).filter((widget) => widget.visible && widget.url) : [];
  return <>
    <div aria-hidden={!overlay?.enabled} className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">{widgets.map((widget) => { const rawOpacity = Number(widget.opacity ?? 1); const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity; return <iframe key={widget.id} src={widget.url} title={widget.title || widget.id} className={widget.interactive ? 'pointer-events-auto absolute border-0 bg-transparent' : 'pointer-events-none absolute border-0 bg-transparent'} style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height, opacity: Math.max(0, Math.min(1, opacity)) }} allow="autoplay; microphone; camera; fullscreen; clipboard-write" />; })}</div>
    {open && <section className="fixed inset-x-3 bottom-16 z-[100] mx-auto flex h-[min(78vh,760px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/85 shadow-2xl backdrop-blur-xl sm:inset-x-6"><header className="flex items-center gap-2 border-b border-white/10 p-2">{(['worktray','settings','overlays'] as Surface[]).map((item) => { const { label, Icon } = SURFACE_META[item]; return <button key={item} type="button" onClick={() => setSurface(item)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${surface === item ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}><Icon className="h-4 w-4" aria-hidden /><span>{label}</span></button>; })}<button type="button" onClick={() => setOpen(false)} className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close workspace"><X className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Close</span></button></header><iframe key={surface} src={SURFACE_URLS[surface]} title={`SPMT ${surface}`} className="min-h-0 flex-1 border-0 bg-transparent" allow="autoplay; microphone; camera; fullscreen; clipboard-write" /></section>}
    <button type="button" onClick={() => { setSurface('worktray'); setOpen((value) => !value); }} className="fixed bottom-3 right-3 z-[110] inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-4 py-2.5 text-sm font-semibold text-white shadow-xl backdrop-blur-xl transition hover:bg-black/90 sm:right-5" aria-expanded={open}><LayoutGrid className="h-4 w-4" aria-hidden /><span>Workspace</span></button>
  </>;
}
