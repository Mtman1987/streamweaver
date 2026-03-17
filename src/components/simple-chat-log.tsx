'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

export function SimpleChatLog() {
    const [messages, setMessages] = useState<any[]>([]);
    const [status, setStatus] = useState('Connecting...');

    useEffect(() => {
        // Connect to the WebSocket server on port 8090
        // We assume the WS server is on the same hostname as the dashboard
        const ws = new WebSocket(getBrowserWebSocketUrl());

        ws.onopen = () => {
            setStatus('Connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'chat-history') {
                    console.log('SimpleChatLog: Received history', data.payload);
                    setMessages(data.payload);
                } else if (data.type === 'chat-message') {
                    console.log('SimpleChatLog: Received message', data.payload);
                    setMessages(prev => [...prev, data.payload]);
                }
            } catch (e) {
                console.error('SimpleChatLog: Error parsing message', e);
            }
        };

        ws.onclose = () => setStatus('Disconnected');
        ws.onerror = (e) => {
            console.error('SimpleChatLog: WebSocket error', e);
            setStatus('Error');
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div className="w-full max-w-md p-4 border rounded-lg bg-slate-900 text-slate-100 shadow-lg my-4">
            <div className="flex items-center justify-between mb-3 border-b border-slate-700 pb-2">
                <h3 className="font-bold text-sm">Raw Chat Log</h3>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${status === 'Connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className="text-xs text-slate-400">{status} ({messages.length})</span>
                </div>
            </div>
            
            <div className="h-64 overflow-y-auto font-mono text-xs space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                {messages.length === 0 ? (
                    <div className="text-slate-500 italic p-2 text-center">Waiting for messages...</div>
                ) : (
                    messages.map((msg, i) => (
                        <div key={i} className="break-words hover:bg-slate-800/50 p-0.5 rounded">
                            <span className="text-slate-500 mr-2">
                                {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour12: false })}
                            </span>
                            <span className="font-bold text-indigo-400 mr-1">
                                {msg.user || msg.displayName || msg.username}:
                            </span>
                            <span className="text-slate-300">{msg.message || msg.content}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}