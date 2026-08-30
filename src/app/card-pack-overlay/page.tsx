'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';
import type { CardPackOpenedEvent } from '@/lib/card-pack-event';

type Phase = 'hidden' | 'pack' | 'deal' | 'flip' | 'feature';

function decodeEvent(value: string | null): CardPackOpenedEvent | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function legacyToEvent(data: any): CardPackOpenedEvent | null {
  const payload = data?.payload || data;
  const cards = Array.isArray(payload?.cards || payload?.pack) ? (payload.cards || payload.pack) : [];
  if (!cards.length) return null;
  const game = data?.type === 'quackverse-pack-opened' || payload?.source === 'quackverse' ? 'quackverse' : 'pokemon';
  const normalizedCards = cards.map((card: any) => ({
    id: String(card?.id || ''),
    number: String(card?.number || ''),
    name: String(card?.name || 'Unknown Card'),
    rarity: String(card?.rarity || ''),
    setCode: String(card?.setCode || ''),
    imageUrl: String(card?.imageUrl || card?.cardImageUrl || ''),
  })).filter((card: any) => card.imageUrl);
  if (!normalizedCards.length) return null;
  const featureCard = [...normalizedCards].sort((a: any, b: any) => {
    const score = (rarity: string) => /secret|legendary/i.test(rarity) ? 7 : /ultra|epic/i.test(rarity) ? 5 : /holo/i.test(rarity) ? 4 : /rare/i.test(rarity) ? 3 : /uncommon/i.test(rarity) ? 2 : 1;
    return score(b.rarity) - score(a.rarity);
  })[0];
  return {
    eventId: String(payload?.eventId || payload?.packId || `${game}-${Date.now()}`),
    type: 'card-pack-opened',
    game,
    username: String(payload?.username || payload?.twitchUsername || 'player'),
    setName: String(payload?.setName || (game === 'quackverse' ? 'Quackverse' : 'Pokemon')),
    cards: normalizedCards,
    featureCard,
    openedAt: String(payload?.openedAt || payload?.at || new Date().toISOString()),
  };
}

export default function CardPackOverlay() {
  const [event, setEvent] = useState<CardPackOpenedEvent | null>(null);
  const [phase, setPhase] = useState<Phase>('hidden');
  const lastEventId = useRef('');
  const captureMode = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('capture') === '1', []);

  const play = (next: CardPackOpenedEvent) => {
    if (!next?.cards?.length || (next.eventId && next.eventId === lastEventId.current && !captureMode)) return;
    lastEventId.current = next.eventId;
    setEvent(next);
    setPhase('pack');
    window.setTimeout(() => setPhase('deal'), 900);
    window.setTimeout(() => setPhase('flip'), 2600);
    window.setTimeout(() => setPhase('feature'), 7600);
    if (!captureMode) {
      window.setTimeout(() => {
        setPhase('hidden');
        setEvent(null);
      }, 13_500);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inline = decodeEvent(params.get('event'));
    if (inline) {
      play(inline);
      return;
    }

    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        socket.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data);
            if (!['card-pack-opened', 'pokemon-pack-opened', 'quackverse-pack-opened'].includes(String(data?.type || ''))) return;
            const normalized = legacyToEvent(data);
            if (normalized) play(normalized);
          } catch {}
        };
        socket.onclose = () => {
          if (!stopped) reconnect = setTimeout(connect, 3000);
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, []);

  if (!event || phase === 'hidden') return null;
  const isQuackverse = event.game === 'quackverse';
  const feature = event.featureCard || event.cards[event.cards.length - 1];
  const regularCards = event.cards.filter((card) => card !== feature).slice(0, 8);

  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-transparent p-4 text-white">
      <div className={`relative h-[510px] w-[920px] overflow-hidden rounded-[32px] border shadow-2xl ${isQuackverse ? 'border-cyan-300/60 bg-slate-950/95' : 'border-yellow-300/60 bg-slate-950/95'}`}>
        <div className={`absolute inset-0 opacity-40 ${isQuackverse ? 'bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,.45),transparent_38%),radial-gradient(circle_at_80%_75%,rgba(168,85,247,.35),transparent_42%)]' : 'bg-[radial-gradient(circle_at_20%_20%,rgba(250,204,21,.4),transparent_38%),radial-gradient(circle_at_80%_75%,rgba(239,68,68,.3),transparent_42%)]'}`} />
        <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-8 py-6">
          <div>
            <div className={`text-xs font-black uppercase tracking-[.28em] ${isQuackverse ? 'text-cyan-200' : 'text-yellow-200'}`}>{isQuackverse ? 'Quackverse Booster' : 'Pokemon Booster'}</div>
            <div className="mt-1 text-3xl font-black">@{event.username}</div>
          </div>
          <div className="rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm font-bold">{event.setName}</div>
        </header>

        <div className="absolute inset-x-0 bottom-4 top-24">
          {phase === 'pack' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`flex h-72 w-52 rotate-[-4deg] items-center justify-center rounded-3xl border-4 text-center shadow-[0_30px_90px_rgba(0,0,0,.7)] animate-in zoom-in duration-500 ${isQuackverse ? 'border-cyan-300 bg-gradient-to-br from-cyan-950 via-slate-900 to-fuchsia-950' : 'border-yellow-300 bg-gradient-to-br from-red-900 via-slate-900 to-yellow-900'}`}>
                <div>
                  <div className="text-5xl">{isQuackverse ? '🦆' : '⚡'}</div>
                  <div className="mt-4 text-2xl font-black uppercase">{isQuackverse ? 'Quackverse' : 'Pokemon'}</div>
                  <div className="mt-2 text-xs uppercase tracking-[.25em] text-white/70">Booster Pack</div>
                </div>
              </div>
            </div>
          )}

          {(phase === 'deal' || phase === 'flip' || phase === 'feature') && (
            <div className="absolute inset-0 grid grid-cols-4 grid-rows-2 gap-3 px-7 pb-4">
              {regularCards.map((card, index) => (
                <div
                  key={`${card.id || card.number || card.name}-${index}`}
                  className="relative min-h-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 shadow-xl transition-all duration-700"
                  style={{
                    opacity: phase === 'feature' ? 0.28 : 1,
                    transform: phase === 'deal' ? `translateY(${index % 2 ? 18 : -18}px) rotate(${(index - 3) * 1.5}deg)` : 'translateY(0) rotate(0deg)',
                  }}
                >
                  {phase === 'deal' ? (
                    <div className={`flex h-full items-center justify-center text-4xl ${isQuackverse ? 'bg-cyan-950' : 'bg-red-950'}`}>{isQuackverse ? '🦆' : '⚡'}</div>
                  ) : (
                    <img src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" />
                  )}
                </div>
              ))}
            </div>
          )}

          {phase === 'feature' && feature && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <div className={`absolute h-80 w-64 rounded-3xl blur-2xl ${isQuackverse ? 'bg-cyan-400/35' : 'bg-yellow-300/35'}`} />
              <div className="relative flex items-center gap-8 rounded-3xl border border-white/20 bg-black/65 p-6 shadow-[0_30px_100px_rgba(0,0,0,.8)] animate-in zoom-in duration-700">
                <img src={feature.imageUrl} alt={feature.name} className="h-[320px] w-[230px] rounded-xl object-contain" />
                <div className="max-w-[360px]">
                  <div className={`text-sm font-black uppercase tracking-[.24em] ${isQuackverse ? 'text-cyan-200' : 'text-yellow-200'}`}>Featured Pull</div>
                  <div className="mt-3 text-4xl font-black leading-tight">{feature.name}</div>
                  <div className="mt-3 text-xl text-white/75">{feature.rarity || 'Card'}{feature.number ? ` · #${feature.number}` : ''}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
