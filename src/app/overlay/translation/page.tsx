'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type TranslationEvent = {
  eventId: string;
  createdAt: string;
  displayName: string;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  durationMs: number;
};

function TranslationSubtitleContent() {
  const searchParams = useSearchParams();
  const tenant = searchParams.get('tenant') || '';
  const [event, setEvent] = useState<TranslationEvent | null>(null);
  const lastSeenRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let activeController: AbortController | null = null;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      const params = new URLSearchParams();
      if (tenant) params.set('tenant', tenant);
      if (lastSeenRef.current) params.set('after', lastSeenRef.current);
      try {
        const response = await fetch(`/api/overlay/translation?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const events = Array.isArray(data?.events) ? data.events : [];
        const next = events.at(-1) as TranslationEvent | undefined;
        if (!next) return;
        lastSeenRef.current = next.createdAt;
        if (!cancelled) setEvent(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (!cancelled) setEvent(null);
        }, Math.max(3000, Math.min(20_000, Number(next.durationMs || 9000))));
      } catch {
        // A browser source should remain transparent through transient misses.
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        inFlight = false;
      }
    };

    void poll();
    const interval = setInterval(poll, 400);
    return () => {
      cancelled = true;
      clearInterval(interval);
      activeController?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tenant]);

  if (!event) return null;
  return (
    <main className="translation-subtitle">
      <section className="translation-card">
        <p className="translated">{event.translatedText}</p>
        <p className="source">@{event.displayName} · {event.targetLanguage.toUpperCase()} · {event.sourceText}</p>
      </section>
      <style jsx>{`
        :global(html), :global(body) {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: transparent !important;
        }
        .translation-subtitle {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: end center;
          padding: 0 6% 7%;
          pointer-events: none;
          font-family: Inter, system-ui, sans-serif;
        }
        .translation-card {
          width: min(92vw, 1200px);
          padding: 18px 28px 16px;
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(7,17,30,.86), rgba(2,6,23,.94));
          box-shadow: 0 12px 40px rgba(0,0,0,.55);
          backdrop-filter: blur(10px);
          animation: subtitle-in .22s ease-out;
        }
        .translated {
          margin: 0;
          color: white;
          font-size: clamp(22px, 3.1vw, 52px);
          font-weight: 800;
          line-height: 1.12;
          text-shadow: 0 2px 8px #000;
          text-wrap: balance;
        }
        .source {
          margin: .45em 0 0;
          color: #9bdcff;
          font-size: clamp(11px, 1.25vw, 20px);
          line-height: 1.3;
          opacity: .95;
        }
        @keyframes subtitle-in {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .translation-card { animation: none; }
        }
      `}</style>
    </main>
  );
}

export default function TranslationSubtitlePage() {
  return (
    <Suspense fallback={null}>
      <TranslationSubtitleContent />
    </Suspense>
  );
}
