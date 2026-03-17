'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

export function DashboardConnection() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(getBrowserWebSocketUrl());
    
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({
        type: 'app-register',
        payload: { 
          name: 'streamweave',
          port: 3000,
          status: 'running'
        }
      }));
    };

    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, []);

  return null; // Silent connection component
}