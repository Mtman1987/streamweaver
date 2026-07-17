'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getEnvironmentAppUrl } from '@/lib/app-urls';

type AnimationType = 'lottie' | 'gif' | 'mp4';

export default function AvatarControl() {
    const [animationType, setAnimationType] = useState<AnimationType>('mp4');
    const [idleUrl, setIdleUrl] = useState('');
    const [talkingUrl, setTalkingUrl] = useState('');
    const [gestureUrl, setGestureUrl] = useState('');
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [overlayUrl, setOverlayUrl] = useState(`${getEnvironmentAppUrl()}/overlay/avatar`);
    const [uploading, setUploading] = useState<string | null>(null);

    useEffect(() => {
        let websocket: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;
        fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => {
            if (session?.id) setOverlayUrl(`${window.location.origin}/overlay/avatar?tenant=${encodeURIComponent(session.id)}`);
        }).catch(() => {});
        fetch('/api/avatars?type=settings').then(r => r.ok ? r.json() : null).then(payload => {
            const data = payload?.data;
            if (!data) return;
            const type = data.animationType === 'json' ? 'lottie' : data.animationType;
            if (type === 'lottie' || type === 'gif' || type === 'mp4') setAnimationType(type);
            if (data.idleFile) setIdleUrl(`/api/avatars?type=idle&format=${encodeURIComponent(type || 'lottie')}`);
            if (data.talkingFile) setTalkingUrl(`/api/avatars?type=talking&format=${encodeURIComponent(type || 'lottie')}`);
        }).catch(() => {});
        const connectWebSocket = () => {
            if (cancelled) return;
            websocket = new WebSocket(getBrowserWebSocketUrl());
            
            websocket.onopen = () => {
                console.log('[Avatar Control] Connected to WebSocket');
                setWs(websocket);
            };
            
            websocket.onclose = () => {
                console.log('[Avatar Control] WebSocket closed, reconnecting...');
                reconnectTimer = setTimeout(connectWebSocket, 1000);
            };
        };
        
        connectWebSocket();
        
        return () => {
            cancelled = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            websocket?.close();
        };
    }, []);

    const handleFileSelect = async (type: 'idle' | 'talking' | 'gesture', file: File) => {
        setUploading(type);
        try {
            const formData = new FormData();
            formData.set('type', type);
            formData.set('file', file);
            const response = await fetch('/api/avatars', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Avatar upload failed');
            const format = file.name.toLowerCase().endsWith('.json') ? 'lottie' : file.name.split('.').pop()?.toLowerCase() || animationType;
            const url = `/api/avatars?type=${type}&format=${encodeURIComponent(format)}`;
            if (type === 'idle') setIdleUrl(url);
            else if (type === 'talking') setTalkingUrl(url);
            else setGestureUrl(url);
            if (format === 'lottie' || format === 'gif' || format === 'mp4') setAnimationType(format);
        } finally {
            setUploading(null);
        }
    };

    const updateAvatarSettings = () => {
        if (!ws) return;
        
        ws.send(JSON.stringify({
            type: 'update-avatar-settings',
            payload: {
                idleUrl,
                talkingUrl,
                gestureUrl,
                animationType
            }
        }));
    };

    const showAvatar = () => {
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'show-avatar' }));
    };

    const hideAvatar = () => {
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'hide-avatar' }));
    };

    return (
        <Card className="w-full max-w-2xl">
            <CardHeader>
                <CardTitle>Avatar Control</CardTitle>
                <CardDescription>
                    Configure and control your stream avatar. Browser source URL:
                    <code className="ml-2 px-2 py-1 bg-gray-100 rounded">
                        {overlayUrl}
                    </code>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="animationType">Animation Type</Label>
                    <Select value={animationType} onValueChange={(value: AnimationType) => setAnimationType(value)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="lottie">Lottie JSON</SelectItem>
                            <SelectItem value="gif">GIF</SelectItem>
                            <SelectItem value="mp4">MP4 Video</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div>
                    <Label htmlFor="idleFile">Idle Animation File</Label>
                    <Input
                        id="idleFile"
                        type="file"
                        accept={animationType === 'lottie' ? '.json' : animationType === 'mp4' ? '.mp4' : '.gif'}
                        onChange={(e) => e.target.files?.[0] && handleFileSelect('idle', e.target.files[0])}
                    />
                    {idleUrl && <p className="text-sm text-gray-600 mt-1">Selected: {idleUrl.substring(0, 50)}...</p>}
                </div>

                <div>
                    <Label htmlFor="talkingFile">Talking Animation File</Label>
                    <Input
                        id="talkingFile"
                        type="file"
                        accept={animationType === 'lottie' ? '.json' : animationType === 'mp4' ? '.mp4' : '.gif'}
                        onChange={(e) => e.target.files?.[0] && handleFileSelect('talking', e.target.files[0])}
                    />
                    {talkingUrl && <p className="text-sm text-gray-600 mt-1">Selected: {talkingUrl.substring(0, 50)}...</p>}
                </div>

                <div className="flex gap-2">
                    <Button onClick={updateAvatarSettings} disabled={Boolean(uploading)}>
                        {uploading ? 'Uploading...' : 'Update Settings'}
                    </Button>
                    <Button onClick={showAvatar} variant="outline">
                        Show Avatar
                    </Button>
                    <Button onClick={hideAvatar} variant="outline">
                        Hide Avatar
                    </Button>
                </div>

                <div className="text-sm text-gray-600">
                    <p><strong>Usage:</strong></p>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Select animation type (MP4, GIF, or Lottie JSON)</li>
                        <li>Choose idle and talking animation files</li>
                        <li>Click "Update Settings" to apply</li>
                        <li>Avatar shows automatically when TTS plays</li>
                        <li>Add browser source to OBS: <code>{overlayUrl}</code></li>
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}
