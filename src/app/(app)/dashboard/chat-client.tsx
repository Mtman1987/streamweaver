
'use client';

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, LoaderCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
// import { getChatHistory } from "@/ai/flows/get-chat-history";
import { useToast } from "@/hooks/use-toast";
import { VoiceCommander } from "./voice-commander";
import styles from './chat-client.module.css';
import { getBrowserWebSocketUrl } from "@/lib/ws-config";
import { applySavedSink } from "@/services/audio-sink";

// This will be populated by the server
type BadgeVersion = {
    image_url_1x: string;
    image_url_2x: string;
    image_url_4x: string;
    description: string;
    title: string;
};
type BadgeSet = Record<string, BadgeVersion>;
type BadgeCache = Record<string, BadgeSet>;


// A simple component to render badges
const ChatBadge = ({ name, version, badgeCache }: { name: string; version: string; badgeCache: BadgeCache }) => {
    // Manually add a bot badge if it's not in the cache
    if (name === 'bot' && !badgeCache['bot']) {
        return <span className="mr-1 text-primary">[BOT]</span>;
    }

    const badgeSet = badgeCache[name];
    if (!badgeSet) return null;

    const badgeInfo = badgeSet[version];
    if (!badgeInfo) return null;

    return <img src={badgeInfo.image_url_1x} alt={`${badgeInfo.title} badge`} className="inline h-4 w-4 mr-1" />;
}

interface ChatMessage {
    user?: string;
    message: string;
    color?: string;
    emotes?: { [emoteid: string]: string[] };
    id: string;
    badges?: { [name: string]: string };
    isSystemMessage?: boolean;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

// Simple emote parser
function parseMessage(message: string, emotes: { [emoteid: string]: string[] } | undefined): (string | JSX.Element)[] {
    if (!emotes) {
        return [message];
    }

    let messageParts: (string | JSX.Element)[] = [];
    let lastIndex = 0;

    // Get all emote positions
    const positions: { id: string; start: number; end: number; }[] = [];
    Object.keys(emotes).forEach(id => {
        emotes[id].forEach(position => {
            const [start, end] = position.split('-').map(Number);
            positions.push({ id, start, end });
        });
    });

    // Sort by start position
    positions.sort((a, b) => a.start - b.start);

    positions.forEach(({ id, start, end }) => {
        // Add text before the emote
        if (start > lastIndex) {
            messageParts.push(message.substring(lastIndex, start));
        }
        // Add the emote image
        messageParts.push(<img key={`${id}-${start}`} src={`https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`} alt="emote" className="inline h-6 w-6" />);
        lastIndex = end + 1;
    });

    // Add any remaining text
    if (lastIndex < message.length) {
        messageParts.push(message.substring(lastIndex));
    }

    return messageParts;
}


export function ChatClient() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [twitchStatus, setTwitchStatus] = useState<ConnectionStatus>('connecting');
    const [badgeCache, setBadgeCache] = useState<BadgeCache>({});
    const [sendAsBot, setSendAsBot] = useState(false);

    const ws = useRef<WebSocket | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    
    useEffect(() => {
        const wsUrl = getBrowserWebSocketUrl();
        if (!wsUrl) return;

        let isCancelled = false;
        
        // Bot username will be fetched from stored tokens via WebSocket
        // let botUsername = ""; // Removed unused variable

        // Chat history will be sent via WebSocket when connected
        if (!isCancelled) {
            setMessages([]);
        }


        function connect() {
            if (isCancelled || !wsUrl) return;
            
            ws.current = new WebSocket(wsUrl);
            setTwitchStatus('connecting');

            ws.current.onopen = () => {
                if (isCancelled) return;
                console.log('[WebSocket] Chat client connected to server');
                // The server will send status and badges on connection
            };

            ws.current.onmessage = async (event) => {
                if (isCancelled) return;
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'twitch-message') {
                        const incomingMsg: ChatMessage = data.payload;
                        setMessages(prev => [...prev, incomingMsg]);
                        
                        // Check if the message is from our bot (simplified check)
                        // Note: This could be enhanced to properly identify bot messages
                        // if (incomingMsg.user?.toLowerCase().includes('bot')) {
                        //    const ttsEvent = new CustomEvent('play-bot-tts', { detail: { text: incomingMsg.message }});
                        //    window.dispatchEvent(ttsEvent);
                        // }

                    } else if (data.type === 'twitch-system-message') {
                         const incomingMsg: ChatMessage = { ...data.payload, isSystemMessage: true };
                         setMessages(prev => [...prev, incomingMsg]);
                    } else if (data.type === 'chat-history') {
                        const historyMessages = data.payload;
                        if (Array.isArray(historyMessages)) {
                            const formattedMessages = historyMessages.map((m: any, index: number) => ({
                                id: `history-${index}`,
                                user: m.user,
                                message: m.message,
                                isSystemMessage: false
                            }));
                            setMessages(prev => [...formattedMessages, ...prev]);
                        }
                    }
                    else if (data.type === 'twitch-status') {
                        setTwitchStatus(data.payload.status);
                    } else if (data.type === 'twitch-badges') {
                        setBadgeCache(data.payload.badges);
                    } else if (data.type === 'tts-audio') {
                        // Play TTS audio
                        const audio = new Audio(data.payload.audioDataUri);
                        try {
                            await applySavedSink(audio);
                        } catch (e) {
                            console.warn('applySavedSink failed', e);
                        }
                        audio.play().catch(error => {
                            console.error('[TTS] Failed to play audio:', error);
                        });
                        console.log(`[TTS] Playing audio for: ${data.payload.text}`);
                    }
                } catch (error) {
                    console.error("Error parsing message from WebSocket:", error);
                }
            };

            ws.current.onclose = (event) => {
                if (isCancelled) return;
                console.log(`[WebSocket] Chat client disconnected: Code ${event.code}`);
                setTwitchStatus('disconnected');
                setTimeout(connect, 5000);
            };
            
            ws.current.onerror = (error) => {
                if (isCancelled) return;
                console.error('[WebSocket] Chat client connection error. Make sure server.ts is running on port 8090');
                setTwitchStatus('disconnected');
                ws.current?.close(); 
            };
        }

        connect();
        
        // Trigger Twitch reconnection every 10 seconds if disconnected
        const reconnectInterval = setInterval(() => {
            if (twitchStatus === 'disconnected' && ws.current?.readyState === WebSocket.OPEN) {
                console.log('[Chat Client] Twitch disconnected, requesting reconnection...');
                ws.current.send(JSON.stringify({ type: 'reconnect-twitch' }));
            }
        }, 10000);

        return () => {
            isCancelled = true;
            if (reconnectInterval) clearInterval(reconnectInterval);
            ws.current?.close();
        };
    }, [toast]); 

    useEffect(() => {
        // Auto-scroll to bottom
        if (scrollAreaRef.current) {
            const scrollableViewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
            if (scrollableViewport) {
                // A small delay to allow the new message to render before scrolling
                setTimeout(() => {
                     scrollableViewport.scrollTop = scrollableViewport.scrollHeight;
                }, 50);
            }
        }
    }, [messages]);

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && ws.current?.readyState === WebSocket.OPEN && twitchStatus === 'connected') {
            const messagePayload = {
                type: 'send-twitch-message',
                payload: {
                    message: input,
                    as: sendAsBot ? 'bot' : 'broadcaster'
                }
            };
            ws.current.send(JSON.stringify(messagePayload));
            setInput('');
        }
    };
    
    const getStatusContent = () => {
        switch (twitchStatus) {
            case 'connected':
                return 'Connected to Twitch';
            case 'connecting':
                return (
                    <>
                        <LoaderCircle className="h-3 w-3 mr-1.5 animate-spin"/>
                        Connecting...
                    </>
                );
            case 'disconnected':
                return 'Twitch Disconnected';
        }
    };

    return (
        <Card className="flex flex-col h-96">
            <CardHeader className="flex-shrink-0">
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Live Chat</CardTitle>
                        <CardDescription>Your native Twitch chat client with Discord history.</CardDescription>
                    </div>
                    <Badge variant={twitchStatus === 'connected' ? 'default' : twitchStatus === 'connecting' ? 'secondary' : 'destructive'} className={cn(twitchStatus === 'connected' ? 'bg-green-600' : '', "transition-colors flex items-center")}>
                       {getStatusContent()}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 p-0">
                <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
                    <div className="space-y-4">
                        {messages.length === 0 && (
                            <div className="text-center text-muted-foreground py-10">
                                {twitchStatus === 'connecting' && 'Attempting to connect to Twitch chat...'}
                                {twitchStatus === 'connected' && 'Loading chat history...'}
                                {twitchStatus === 'disconnected' && 'Connection to Twitch failed. Check server logs and .env file.'}
                            </div>
                        )}
                        {messages.map((msg, index) => (
                            <div key={`${msg.id}-${index}`} className="text-sm">
                                {msg.isSystemMessage ? (
                                    <div className="text-muted-foreground italic px-2 py-1 bg-muted/50 rounded-md">
                                        {msg.message}
                                    </div>
                                ) : (
                                    <>
                                        {msg.badges && Object.entries(msg.badges).map(([name, version]) => (
                                            <ChatBadge key={name} name={name} version={version} badgeCache={badgeCache} />
                                        ))}
                                        <span 
                                            className={`font-bold pr-2 ${styles.username}`}
                                            {...(msg.color && { 'data-color': msg.color })}
                                        >
                                            {msg.message.startsWith('[Discord]') ? '' : `${msg.user}:`}
                                        </span>
                                        <div className="inline">{parseMessage(msg.message, msg.emotes).map((part, i) => <span key={i}>{part}</span>)}</div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <div className="p-4 border-t flex-shrink-0 space-y-2">
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="send-as-bot"
                            checked={sendAsBot}
                            onCheckedChange={setSendAsBot}
                        />
                        <Label htmlFor="send-as-bot">Send as bot</Label>
                    </div>
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={twitchStatus === 'connected' ? "Type a message..." : "Waiting for Twitch connection..."}
                            disabled={twitchStatus !== 'connected'}
                        />
                        <Button type="submit" disabled={!input.trim() || twitchStatus !== 'connected'}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            </CardContent>
        </Card>
    );
}
