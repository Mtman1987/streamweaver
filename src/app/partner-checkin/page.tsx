'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

type CheckinKind = 'partner' | 'crew' | 'mod' | 'space-mountain';

interface EntryData {
  id: number;
  name: string;
  imageUrl?: string;
}

interface OverlayState {
  phase: 'hidden' | 'pending' | 'reveal';
  kind: CheckinKind;
  username: string;
  sourceLabel: string;
  title: string;
  subtitle: string;
  accentColor: string;
  emoji: string;
  entry: EntryData | null;
  count?: number;
  names?: string[];
}

const THEMES: Record<CheckinKind, { glow: string; gradient: string; label: string; badge: string }> = {
  partner: {
    glow: 'rgba(255,215,0,0.65)',
    gradient: 'linear-gradient(135deg, rgba(255,215,0,0.22), rgba(255,140,0,0.10), rgba(0,0,0,0.25))',
    label: 'PARTNER SIGNAL',
    badge: '#FFD700',
  },
  crew: {
    glow: 'rgba(0,210,255,0.7)',
    gradient: 'linear-gradient(135deg, rgba(0,210,255,0.22), rgba(0,110,255,0.12), rgba(0,0,0,0.28))',
    label: 'CREW ROSTER',
    badge: '#00D2FF',
  },
  mod: {
    glow: 'rgba(155,92,255,0.7)',
    gradient: 'linear-gradient(135deg, rgba(155,92,255,0.22), rgba(82,35,255,0.12), rgba(0,0,0,0.28))',
    label: 'MOD SQUAD',
    badge: '#9B5CFF',
  },
  'space-mountain': {
    glow: 'rgba(255,77,109,0.75)',
    gradient: 'linear-gradient(135deg, rgba(255,77,109,0.24), rgba(0,211,255,0.12), rgba(0,0,0,0.34))',
    label: 'SPACE MOUNTAIN',
    badge: '#FF4D6D',
  },
};

const MODE_COPY: Record<CheckinKind, { pendingTag: string; revealTag: string; statLabel: string }> = {
  partner: {
    pendingTag: 'Partner lock-in',
    revealTag: 'Partner locked',
    statLabel: 'Community match',
  },
  crew: {
    pendingTag: 'Crew roster spinning',
    revealTag: 'Crew member selected',
    statLabel: 'Crew spotlight',
  },
  mod: {
    pendingTag: 'Mod squad spinning',
    revealTag: 'Mod selected',
    statLabel: 'Moderator spotlight',
  },
  'space-mountain': {
    pendingTag: 'Ride loading',
    revealTag: 'Ride launched',
    statLabel: 'Rider count',
  },
};

const DEFAULT_STATE: OverlayState = {
  phase: 'hidden',
  kind: 'partner',
  username: '',
  sourceLabel: '',
  title: '',
  subtitle: '',
  accentColor: '#FFD700',
  emoji: '🤝',
  entry: null,
};

export default function PartnerCheckinPage() {
  const [state, setState] = useState<OverlayState>(DEFAULT_STATE);
  const broadcasterAvatar = useRef('');
  const hideTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const tenantId = getOverlayTenantId();
    const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    fetch(`/api/user-profile${tenantParam}`).then(r => r.json()).then(d => {
      if (d.twitch?.avatar) broadcasterAvatar.current = d.twitch.avatar;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Legacy partner-checkin-pending / partner-checkin events are
            // ignored — checkin-pending / checkin-reveal carry the correct
            // kind and all payload fields for every check-in type.

            if (data.type === 'checkin-pending') {
              clearTimeout(hideTimer.current);
              setState({
                phase: 'pending',
                kind: data.payload?.kind || 'partner',
                username: data.payload?.username || '',
                sourceLabel: data.payload?.sourceLabel || '',
                title: data.payload?.title || 'Check-In',
                subtitle: data.payload?.subtitle || '',
                accentColor: data.payload?.accentColor || '#FFD700',
                emoji: data.payload?.emoji || '✨',
                entry: null,
                count: data.payload?.count,
              });
              hideTimer.current = setTimeout(() => setState(DEFAULT_STATE), 45000);
            }

            if (data.type === 'checkin-reveal') {
              clearTimeout(hideTimer.current);
              setState({
                phase: 'reveal',
                kind: data.payload?.kind || 'partner',
                username: data.payload?.username || '',
                sourceLabel: data.payload?.sourceLabel || '',
                title: data.payload?.bulk ? `${data.payload?.emoji || '✨'} Mass Check-In` : 'Check-In Locked',
                subtitle: data.payload?.bulk
                  ? `${data.payload?.count || 0} checked in by ${data.payload?.username || ''}`
                  : `Checked in by ${data.payload?.username || ''}`,
                accentColor: data.payload?.accentColor || '#FFD700',
                emoji: data.payload?.emoji || '✨',
                entry: data.payload?.entry || null,
                count: data.payload?.count,
                names: data.payload?.names || [],
              });
              hideTimer.current = setTimeout(() => setState(DEFAULT_STATE), 25000);
            }
          } catch {}
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnectTimeout); clearTimeout(hideTimer.current); ws?.close(); };
  }, []);

  const theme = useMemo(() => THEMES[state.kind], [state.kind]);
  const modeCopy = useMemo(() => MODE_COPY[state.kind], [state.kind]);
  if (state.phase === 'hidden') return null;

  const isPending = state.phase === 'pending';
  const avatarSrc = isPending ? broadcasterAvatar.current : (state.entry?.imageUrl || '');
  const headline = isPending ? state.title : (state.entry?.name || state.title);
  const riderNames = state.names?.slice(0, 6).join(' • ');

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'transparent', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 18% 20%, ${theme.glow}, transparent 35%)`,
        opacity: 0.7,
      }} />
      <div style={{
        position: 'absolute',
        top: 18,
        left: state.kind === 'space-mountain' ? 690 : 540,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: theme.badge,
        boxShadow: `0 0 24px ${theme.glow}, 0 0 60px ${theme.glow}`,
        animation: 'checkinPulse 1.2s ease-in-out infinite',
      }} />
      <div key={`${state.phase}-${state.kind}-${state.username}-${state.entry?.name || ''}`} style={{
        position: 'absolute',
        top: 32,
        left: 32,
        width: state.kind === 'space-mountain' ? 720 : 560,
        borderRadius: 28,
        padding: 24,
        color: 'white',
        background: theme.gradient,
        border: `2px solid ${theme.badge}`,
        boxShadow: `0 18px 60px ${theme.glow}`,
        backdropFilter: 'blur(10px)',
        animation: 'checkinPop 0.45s ease-out',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{
            width: 188,
            minWidth: 188,
            height: 188,
            borderRadius: isPending ? 28 : '50%',
            overflow: 'hidden',
            border: `5px solid ${theme.badge}`,
            boxShadow: `0 0 24px ${theme.glow}`,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 64,
          }}>
            {avatarSrc ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : state.emoji}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: 999,
              background: theme.badge,
              color: '#120F1B',
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: 1.6,
            }}>
              {theme.label}
            </div>
            <div style={{
              marginTop: 14,
              fontSize: state.kind === 'space-mountain' ? 46 : 42,
              lineHeight: 1,
              fontWeight: 900,
              textShadow: '0 4px 18px rgba(0,0,0,0.45)',
            }}>
              {headline}
            </div>
            <div style={{
              marginTop: 10,
              fontSize: 21,
              lineHeight: 1.35,
              opacity: 0.95,
            }}>
              {state.subtitle}
            </div>
            <div style={{
              marginTop: 12,
              fontSize: 15,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              opacity: 0.82,
            }}>
              {state.sourceLabel}
            </div>
            <div style={{
              marginTop: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 18,
              background: 'rgba(255,255,255,0.08)',
              border: `1px solid ${theme.badge}`,
              fontSize: 15,
              lineHeight: 1.2,
            }}>
              <span style={{ fontWeight: 800 }}>{isPending ? modeCopy.pendingTag : modeCopy.revealTag}</span>
              <span style={{ opacity: 0.75 }}>•</span>
              <span style={{ opacity: 0.88 }}>
                {state.kind === 'space-mountain'
                  ? `${modeCopy.statLabel}: ${state.count || 0}`
                  : modeCopy.statLabel}
              </span>
            </div>
            {state.kind === 'space-mountain' && state.count ? (
              <div style={{
                marginTop: 16,
                padding: '10px 14px',
                borderRadius: 18,
                background: 'rgba(255,255,255,0.08)',
                fontSize: 17,
                lineHeight: 1.4,
              }}>
                {state.count} riders checked in
                {riderNames ? ` • ${riderNames}${(state.names?.length || 0) > 6 ? ' • ...' : ''}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes checkinPop {
          0% { transform: translateY(24px) scale(0.92); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes checkinPulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.3); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
