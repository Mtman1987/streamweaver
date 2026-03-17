'use client';

import { useEffect, useState } from 'react';

/**
 * CSS-rendered Pokemon-style card back with streamer avatar.
 * Fetches avatar from /api/user-profile (same source as sidebar).
 */
export default function CardBack({ width = 240, height = 336, avatarUrl }: {
  width?: number;
  height?: number;
  avatarUrl?: string;
}) {
  const [avatar, setAvatar] = useState(avatarUrl || '');
  const r = Math.min(width, height) * 0.22;

  useEffect(() => {
    if (avatarUrl) return;
    fetch('/api/user-profile').then(r => r.json()).then(d => {
      if (d.twitch?.avatar) setAvatar(d.twitch.avatar);
    }).catch(() => {});
  }, [avatarUrl]);

  return (
    <div style={{
      width, height, borderRadius: 12, overflow: 'hidden', position: 'relative',
      background: 'linear-gradient(135deg, #1a3a6e 0%, #2563eb 40%, #1e40af 60%, #1a3a6e 100%)',
      boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4)',
    }}>
      {/* Swirl pattern */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 120% 80% at 30% 20%, rgba(96,165,250,0.25) 0%, transparent 60%),
          radial-gradient(ellipse 120% 80% at 70% 80%, rgba(96,165,250,0.25) 0%, transparent 60%)
        `,
      }} />

      {/* Border frame */}
      <div style={{
        position: 'absolute', inset: 8, borderRadius: 8,
        border: '2px solid rgba(255,255,255,0.2)',
      }} />

      {/* Inner border */}
      <div style={{
        position: 'absolute', inset: 14, borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.1)',
      }} />

      {/* Pokeball top accent */}
      <div style={{
        position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
        width: 18, height: 18, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.3)',
        background: 'radial-gradient(circle, rgba(255,255,255,0.15) 40%, transparent 41%)',
      }} />

      {/* Avatar circle */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: r * 2, height: r * 2, borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.4)',
        boxShadow: '0 0 20px rgba(37,99,235,0.6), inset 0 0 10px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        background: '#1e3a6e',
      }}>
        {avatar && (
          <img
            src={avatar}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>

      {/* Pokeball bottom accent */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        width: 18, height: 18, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.3)',
        background: 'radial-gradient(circle, rgba(255,255,255,0.15) 40%, transparent 41%)',
      }} />

      {/* Corner pokeballs */}
      {[[16, 16], [16, null], [null, 16], [null, null]].map(([t, l], i) => (
        <div key={i} style={{
          position: 'absolute',
          top: t !== null ? t : undefined,
          bottom: t === null ? 16 : undefined,
          left: l !== null ? l : undefined,
          right: l === null ? 16 : undefined,
          width: 10, height: 10, borderRadius: '50%',
          border: '1.5px solid rgba(255,255,255,0.2)',
        }} />
      ))}
    </div>
  );
}
