'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getClientTenantId } from '@/lib/client-tenant';

export function OBSBridge() {
  const obsRef = useRef<WebSocket | null>(null);
  const [obsConnected, setObsConnected] = useState(false);
  const obsSettingsRef = useRef<{ ip: string; port: string; password: string } | null>(null);

  // Load OBS settings from vault
  useEffect(() => {
    fetch('/api/obs/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ip && d?.port) {
          obsSettingsRef.current = { ip: d.ip, port: String(d.port), password: d.password || '' };
          connectOBS();
        }
      })
      .catch(() => {});
  }, []);

  function connectOBS() {
    const s = obsSettingsRef.current;
    if (!s) return;
    try {
      const url = `ws://${s.ip}:${s.port}`;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        console.log('[OBS Bridge] Connected to OBS');
        // OBS WebSocket v5 requires identification
        // The browser WebSocket API doesn't support obs-websocket-js directly,
        // so we handle the protocol manually
        setObsConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // Handle OBS WebSocket v5 Hello message
          if (msg.op === 0) {
            // Send Identify
            const identify: any = { op: 1, d: { rpcVersion: 1 } };
            if (s.password) {
              // For password auth, we'd need to compute the auth string
              // For now, try without password first
            }
            ws.send(JSON.stringify(identify));
          }
          if (msg.op === 2) {
            // Identified successfully
            console.log('[OBS Bridge] Identified with OBS');
            setObsConnected(true);
          }
        } catch {}
      };
      ws.onclose = () => {
        setObsConnected(false);
        // Reconnect after 10s
        setTimeout(connectOBS, 10000);
      };
      ws.onerror = () => {};
      obsRef.current = ws;
    } catch {
      setTimeout(connectOBS, 10000);
    }
  }

  function sendOBSRequest(requestType: string, requestData?: any) {
    const ws = obsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg: any = {
      op: 6, // Request
      d: {
        requestType,
        requestId: `sw-${Date.now()}`,
        ...(requestData ? { requestData } : {})
      }
    };
    ws.send(JSON.stringify(msg));
  }

  // Listen for StreamWeaver commands via WebSocket
  useEffect(() => {
    let sw: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;

    const connect = () => {
      try {
        sw = new WebSocket(getBrowserWebSocketUrl(getClientTenantId() || undefined));
        sw.onclose = () => { reconnect = setTimeout(connect, 3000); };
        sw.onerror = () => {};
        sw.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'obs-switch-scene' && msg.payload?.sceneName) {
              console.log('[OBS Bridge] Switching scene to:', msg.payload.sceneName);
              sendOBSRequest('SetCurrentProgramScene', { sceneName: msg.payload.sceneName });
            }
            if (msg.type === 'obs-set-source-url' && msg.payload?.sourceName) {
              console.log('[OBS Bridge] Setting source URL:', msg.payload.sourceName);
              sendOBSRequest('SetInputSettings', {
                inputName: msg.payload.sourceName,
                inputSettings: { url: msg.payload.url }
              });
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnect); sw?.close(); };
  }, []);

  // This component is invisible — it just bridges the connections
  return null;
}
