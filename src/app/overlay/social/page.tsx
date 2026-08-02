'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type SocialCommand =
  | 'hug' | 'boop' | 'cuddle' | 'fistbump' | 'headpat' | 'highfive'
  | 'love' | 'tickle' | 'hover' | 'lurk' | 'unlurk';

type SocialOverlayEvent = {
  eventId: string;
  createdAt: string;
  command: SocialCommand;
  actor: { name: string; avatarUrl?: string };
  target?: { name: string; avatarUrl?: string };
  bot: { name: string; avatarUrl?: string };
  animation: { durationMs: number; particleCount: number };
};

const EMOTES: Record<SocialCommand, string[]> = {
  hug: ['🤗', '🫂', '💞'],
  boop: ['👉', '✨', '😸'],
  cuddle: ['🧸', '☁️', '💗'],
  fistbump: ['👊', '💥', '⚡'],
  headpat: ['🫳', '✨', '🥰'],
  highfive: ['🙌', '👏', '⭐'],
  love: ['❤️', '💖', '💕', '💘'],
  tickle: ['😂', '✨', '🪶'],
  hover: ['👀', '🛸', '✨'],
  lurk: ['🥷', '🌙', '👀'],
  unlurk: ['👋', '☀️', '✨'],
};

function hash(value: string): number {
  return Array.from(value).reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
}

function particleStyle(event: SocialOverlayEvent, index: number): React.CSSProperties {
  const seed = hash(`${event.eventId}:${index}`);
  const left = seed % 94;
  const top = (seed >>> 5) % 82;
  const delay = ((seed >>> 11) % 1400) / 1000;
  const duration = 2.8 + ((seed >>> 17) % 2400) / 1000;
  const size = 34 + ((seed >>> 21) % 50);
  return {
    left: `${left}%`,
    top: `${top}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    fontSize: `${size}px`,
  };
}

function SocialOverlayContent() {
  const searchParams = useSearchParams();
  const tenant = searchParams.get('tenant') || '';
  const [event, setEvent] = useState<SocialOverlayEvent | null>(null);
  const lastSeenRef = useRef('');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const response = await fetch(`/api/overlay/social?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const events = Array.isArray(data?.events) ? data.events : [];
        const next = events.at(-1) as SocialOverlayEvent | undefined;
        if (!next) return;
        lastSeenRef.current = next.createdAt;
        if (!cancelled) setEvent(next);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          if (!cancelled) setEvent(null);
        }, Math.max(1500, next.animation.durationMs));
      } catch {
        // Browser-source overlays should stay silent during transient reconnects.
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, 350);
    return () => {
      cancelled = true;
      clearInterval(interval);
      activeController?.abort();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [tenant]);

  const particles = useMemo(() => {
    if (!event) return [];
    const count = Math.max(8, Math.min(64, event.animation.particleCount));
    return Array.from({ length: count }, (_, index) => ({
      key: `${event.eventId}:${index}`,
      emoji: EMOTES[event.command][index % EMOTES[event.command].length],
      style: particleStyle(event, index),
    }));
  }, [event]);

  if (!event) return null;

  const target = event.target?.name || event.bot.name;
  return (
    <main className={`social-overlay social-${event.command}`} aria-label={`${event.command} animation`}>
      <section className="social-banner">
        <strong>{event.actor.name}</strong>
        <span>{event.command === 'hover' ? 'is hovering near' : `${event.command}s`}</span>
        <strong>{target}</strong>
      </section>
      {particles.map((particle) => (
        <span key={particle.key} className="social-particle" style={particle.style}>
          {particle.emoji}
        </span>
      ))}
      <style jsx>{`
        :global(html), :global(body) {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: transparent !important;
        }
        .social-overlay {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          font-family: Inter, system-ui, sans-serif;
        }
        .social-banner {
          position: absolute;
          left: 50%;
          bottom: 8%;
          z-index: 3;
          display: flex;
          gap: 0.5rem;
          align-items: center;
          transform: translateX(-50%);
          padding: 0.8rem 1.2rem;
          border: 2px solid rgba(255,255,255,.82);
          border-radius: 999px;
          background: rgba(20, 20, 32, .78);
          box-shadow: 0 14px 44px rgba(0,0,0,.4);
          color: white;
          font-size: clamp(20px, 2vw, 34px);
          backdrop-filter: blur(8px);
          animation: banner-in .45s cubic-bezier(.2,.9,.2,1);
        }
        .social-particle {
          position: absolute;
          display: block;
          filter: drop-shadow(0 8px 10px rgba(0,0,0,.35));
          animation-name: pounce;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          will-change: transform, opacity;
        }
        .social-love .social-particle {
          animation-name: heart-pounce;
        }
        .social-cuddle .social-particle,
        .social-lurk .social-particle {
          animation-name: float-softly;
        }
        .social-fistbump .social-particle,
        .social-highfive .social-particle {
          animation-name: impact;
        }
        .social-tickle .social-particle,
        .social-boop .social-particle {
          animation-name: chaos;
        }
        .social-hover .social-particle {
          animation-name: hover;
        }
        @keyframes banner-in {
          from { opacity: 0; transform: translate(-50%, 40px) scale(.88); }
          to { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes pounce {
          0%,100% { transform: translate3d(-12px,18px,0) rotate(-8deg) scale(.8); opacity: .35; }
          45% { transform: translate3d(20px,-48px,0) rotate(8deg) scale(1.18); opacity: 1; }
          70% { transform: translate3d(42px,0,0) rotate(-4deg) scale(.94); opacity: .8; }
        }
        @keyframes heart-pounce {
          0%,100% { transform: translate3d(-18px,22px,0) rotate(-12deg) scale(.55); opacity: .3; }
          50% { transform: translate3d(34px,-58px,0) rotate(12deg) scale(1.55); opacity: 1; }
        }
        @keyframes float-softly {
          0%,100% { transform: translate3d(-8px,18px,0) rotate(-4deg) scale(.85); opacity: .45; }
          50% { transform: translate3d(16px,-34px,0) rotate(4deg) scale(1.15); opacity: 1; }
        }
        @keyframes impact {
          0%,100% { transform: translateX(-44px) scale(.72); opacity: .25; }
          48% { transform: translateX(0) scale(1.35); opacity: 1; }
          58% { transform: translateX(16px) scale(.92); opacity: .75; }
        }
        @keyframes chaos {
          0%,100% { transform: translate3d(-30px,18px,0) rotate(-24deg) scale(.7); }
          30% { transform: translate3d(40px,-38px,0) rotate(20deg) scale(1.2); }
          65% { transform: translate3d(-6px,-70px,0) rotate(-16deg) scale(.9); }
        }
        @keyframes hover {
          0%,100% { transform: translateY(16px) scale(.88); opacity: .5; }
          50% { transform: translateY(-28px) scale(1.12); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .social-particle { animation: reduced-pulse 1.5s ease-in-out infinite; }
          @keyframes reduced-pulse {
            0%,100% { transform: scale(.9); opacity: .45; }
            50% { transform: scale(1.08); opacity: 1; }
          }
        }
      `}</style>
    </main>
  );
}

export default function SocialOverlayPage() {
  return (
    <Suspense fallback={null}>
      <SocialOverlayContent />
    </Suspense>
  );
}
