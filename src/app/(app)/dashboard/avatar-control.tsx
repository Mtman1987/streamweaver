'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

type AnimationType = 'lottie' | 'gif' | 'mp4';

export default function AvatarControl() {
    const [animationType, setAnimationType] = useState<AnimationType>('mp4');
    const [idleUrl, setIdleUrl] = useState('');
    const [talkingUrl, setTalkingUrl] = useState('');
    const [gestureUrl, setGestureUrl] = useState('');
    const [ws, setWs] = useState<WebSocket | null>(null);

    useEffect(() => {
        // Connect to WebSocket
        const connectWebSocket = () => {
            const websocket = new WebSocket(getBrowserWebSocketUrl());
            
            websocket.onopen = () => {
                console.log('[Avatar Control] Connected to WebSocket');
                setWs(websocket);
            };
            
            websocket.onclose = () => {
                console.log('[Avatar Control] WebSocket closed, reconnecting...');
                setTimeout(connectWebSocket, 1000);
            };
        };
        
        connectWebSocket();
        
        return () => {
            if (ws) {
                ws.close();
            }
        };
    }, []);

    const handleFileSelect = async (type: 'idle' | 'talking' | 'gesture', file: File) => {
        const url = URL.createObjectURL(file);
        if (type === 'idle') setIdleUrl(url);
        else if (type === 'talking') setTalkingUrl(url);
        else setGestureUrl(url);
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
                        http://localhost:3100/overlay/avatar
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
                    <Button onClick={updateAvatarSettings}>
                        Update Settings
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
                        <li>Add browser source to OBS: <code>http://localhost:3100/overlay/avatar</code></li>
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}