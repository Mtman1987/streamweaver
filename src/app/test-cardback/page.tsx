'use client';
import CardBack from '@/components/CardBack';

export default function TestCardBackPage() {
  return (
    <div style={{ display: 'flex', gap: 40, padding: 40, background: '#111', minHeight: '100vh', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <CardBack width={240} height={336} />
        <p style={{ marginTop: 12 }}>Auto-fetch avatar</p>
      </div>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <CardBack width={240} height={336} avatarUrl="https://static-cdn.jtvnw.net/jtv_user_pictures/5aef0d0f-f978-42c5-95df-c33e5e3208c6-profile_image-300x300.png" />
        <p style={{ marginTop: 12 }}>Hardcoded avatar</p>
      </div>
    </div>
  );
}
