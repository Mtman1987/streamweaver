'use client';
import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

export default function PartnerCheckinPage() {
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [partner, setPartner] = useState<any>(null);

  useEffect(() => {
    const ws = new WebSocket(getBrowserWebSocketUrl());
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'partner-checkin') {
          setPartnerId(data.payload.square);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!partnerId) return;
    
    fetch(`/api/partner-checkin?id=${partnerId}`)
      .then(res => res.json())
      .then(data => setPartner(data))
      .catch(console.error);

    // Clear after 15 seconds
    const timer = setTimeout(() => {
      setPartner(null);
      setPartnerId(null);
    }, 15000);

    return () => clearTimeout(timer);
  }, [partnerId]);

  if (!partner) return null;

  return (
    <div style={{
      width: '1920px',
      height: '1080px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent'
    }}>
      <img 
        src={`/api/partner-checkin/image?id=${partnerId}`}
        alt={partner.name}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
