'use client';
import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

interface PartnerData {
  id: number;
  name: string;
  avatarUrl: string;
  imageUrl?: string;
}

export default function PartnerCheckinPage() {
  const [phase, setPhase] = useState<'hidden' | 'pending' | 'reveal'>('hidden');
  const [username, setUsername] = useState('');
  const [partner, setPartner] = useState<PartnerData | null>(null);
  const broadcasterAvatar = useRef('');
  const hideTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    fetch('/api/user-profile').then(r => r.json()).then(d => {
      if (d.twitch?.avatar) broadcasterAvatar.current = d.twitch.avatar;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        ws.onopen = () => console.log('[Partner Overlay] Connected');
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'partner-checkin-pending') {
              clearTimeout(hideTimer.current);
              setUsername(data.payload.username);
              setPartner(null);
              setPhase('pending');
              hideTimer.current = setTimeout(() => setPhase('hidden'), 45000);
            }

            if (data.type === 'partner-checkin') {
              clearTimeout(hideTimer.current);
              setUsername(data.payload.username);
              setPartner(data.payload.partner);
              setPhase('reveal');
              hideTimer.current = setTimeout(() => { setPhase('hidden'); setPartner(null); }, 25000);
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

  if (phase === 'hidden') return null;

  const isPending = phase === 'pending';
  const avatarSrc = isPending ? broadcasterAvatar.current : (partner?.imageUrl || partner?.avatarUrl || '');
  const label = isPending ? 'Partner Check-In!' : partner?.name || '';
  const sublabel = isPending ? `${username} is choosing...` : `Checked in by ${username}`;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'transparent' }}>
      <div key={phase} style={{
        position: 'absolute', top: 40, left: 40,
        textAlign: 'center', animation: 'popIn 0.5s ease-out',
      }}>
        {avatarSrc && (
          <img
            src={avatarSrc}
            alt=""
            style={{
              width: 192, height: 192, borderRadius: '50%',
              border: `5px solid ${isPending ? '#3b82f6' : '#ffd700'}`,
              boxShadow: `0 6px 30px ${isPending ? 'rgba(59,130,246,0.7)' : 'rgba(255,215,0,0.7)'}`,
              marginBottom: 12,
            }}
          />
        )}
        <div style={{ fontSize: '32px', fontWeight: 'bold', color: isPending ? '#3b82f6' : '#FFD700', textShadow: '2px 2px 8px black' }}>
          {label}
        </div>
        <div style={{ fontSize: '22px', color: 'white', textShadow: '2px 2px 6px black', marginTop: 6 }}>
          {sublabel}
        </div>
      </div>
      <style jsx>{`
        @keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}
