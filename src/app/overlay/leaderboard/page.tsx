'use client';

import { useState, useEffect } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

interface LeaderboardEntry {
  rank: number;
  user: string;
  value: number;
  badges?: string[];
}

export default function LeaderboardOverlay() {
  const [data, setData] = useState<{ title: string; entries: LeaderboardEntry[]; you?: LeaderboardEntry } | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'show'>('hidden');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    let hideTimer: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'leaderboard-top' || msg.type === 'leaderboard-profile' || msg.type === 'leaderboard-compare') {
              setData(msg.payload);
              setPhase('show');
              clearTimeout(hideTimer);
              hideTimer = setTimeout(() => setPhase('hidden'), 15000);
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnect); clearTimeout(hideTimer); ws?.close(); };
  }, []);

  if (phase === 'hidden' || !data) return null;

  const entries: LeaderboardEntry[] = data.entries || [];
  const title = data.title || 'Leaderboard';

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 50,
      background: 'rgba(0,0,0,0.9)', border: '2px solid rgba(255,215,0,0.3)',
      borderRadius: 12, padding: 16, minWidth: 320, maxWidth: 400,
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#e0e0e0',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>🏆</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#ffd700' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((entry, i) => (
          <div key={entry.user} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: 6,
            background: i === 0 ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#888', minWidth: 28 }}>
                #{entry.rank}
              </span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{entry.user}</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#ffd700' }}>
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
      {data.you && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 13, color: '#888', textAlign: 'center' }}>
          You: #{data.you.rank} — {typeof data.you.value === 'number' ? data.you.value.toLocaleString() : data.you.value}
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
}
