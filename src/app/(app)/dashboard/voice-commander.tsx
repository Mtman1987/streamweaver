
'use client';

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, LoaderCircle, Bot, Send, User, Maximize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { transcribeAudio } from "@/services/speech";
import { browserSpeechRecognition } from "@/services/browser-speech";
import { translateToLanguage, type TargetLanguage } from "@/services/translation";
import { createTwitchClip } from "@/services/twitch";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { TwitchIcon, DiscordIcon } from "@/components/icons";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getBrowserWebSocketUrl } from "@/lib/ws-config";
import { applySavedSink } from '@/services/audio-sink';
import Link from "next/link";

// AI and service flows
import { sendTwitchMessage } from "@/ai/flows/send-twitch-message";
import { sendDiscordMessage } from "@/ai/flows/send-discord-message";
import { conversationalResponse } from "@/ai/flows/conversational-response";

type UserConfigPayload = {
    config?: Record<string, string>;
    complete?: boolean;
};

type Destination = 'twitch' | 'discord' | 'ai' | 'private';
type Speaker = 'broadcaster' | 'bot';

interface TranscribedMessage {
    id: number;
    text: string;
    status: 'pending' | 'sent' | 'error';
    speaker: 'commander' | 'ai-input'; // To distinguish user's speech to AI
}

type VoiceCommanderVariant = 'card' | 'embedded';

interface VoiceCommanderProps {
    variant?: VoiceCommanderVariant;
    className?: string;
}


export function VoiceCommander({ variant = 'card', className }: VoiceCommanderProps) {
    const { toast } = useToast();
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [userConfig, setUserConfig] = useState<Record<string, string>>({});
    const [messages, setMessages] = useState<TranscribedMessage[]>([]);
    const [destination, setDestination] = useState<Destination>('ai');
    const [sendAsCommander, setSendAsCommander] = useState(true);
    const [useBrowserSTT, setUseBrowserSTT] = useState(true);
    const [translateLanguage, setTranslateLanguage] = useState<TargetLanguage | 'none'>('none');

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const ws = useRef<WebSocket | null>(null);
    const personalityRef = useRef<string>("");
    const voiceRef = useRef<string>("Ashley");
    const audioContextRef = useRef<AudioContext | null>(null);

    // Load destination from localStorage after mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('voice_commander_destination') as Destination;
            if (saved) setDestination(saved);
        }
    }, []);

    // Save destination preference
    useEffect(() => {
        localStorage.setItem('voice_commander_destination', destination);
    }, [destination]);

    // Initialize audio context on mount
    useEffect(() => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContextRef.current = new AudioContextClass();
            console.log('[VoiceCommander] Audio context created, state:', audioContextRef.current.state);

            // Try to resume audio context immediately
            if (audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume().then(() => {
                    console.log('[VoiceCommander] Audio context resumed on mount');
                }).catch(e => {
                    console.warn('[VoiceCommander] Failed to resume audio context on mount:', e);
                });
            }
        } catch (e) {
            console.warn('[VoiceCommander] Failed to create audio context:', e);
        }
    }, []);

    console.log('[VoiceCommander] Component initialized with settings:', { variant, className, isRecording, isTranscribing, isProcessing, destination, sendAsCommander, useBrowserSTT });


      useEffect(() => {
          console.log('[VoiceCommander] useEffect starting - loading config and initializing WebSocket');
          
          // Load user-specific config (saved by /setup) so this works for anyone without editing .env
          console.log('[VoiceCommander] Fetching user config...');
          fetch('/api/user-config', { cache: 'no-store' })
                .then((res) => {
                    console.log('[VoiceCommander] User config response status:', res.status);
                    return res.json();
                })
                .then((data: UserConfigPayload) => {
                    console.log('[VoiceCommander] User config data:', data);
                    setUserConfig(data?.config || {});
                })
                .catch((error) => {
                    console.error('[VoiceCommander] Failed to load user config:', error);
                    setUserConfig({});
                });

        const wsUrl = getBrowserWebSocketUrl();
        console.log('[VoiceCommander] WebSocket URL:', wsUrl);
        if (!wsUrl) {
            console.error('[VoiceCommander] No WebSocket URL available');
            return;
        }

        // Load settings from localStorage first, then fall back to global (set by bot-settings API)
        let savedPersonality = localStorage.getItem("bot_personality") || "";
        let savedVoice = localStorage.getItem("bot_tts_voice") || "Ashley";
        
        // If localStorage is empty, try to get from global (set by bot-settings API)
        if (!savedPersonality && typeof window !== 'undefined') {
            const globalPersonality = (window as any).botPersonality;
            if (globalPersonality) {
                savedPersonality = globalPersonality;
                console.log('[VoiceCommander] Loaded personality from global:', savedPersonality.substring(0, 50) + '...');
            }
        }
        
        // If voice is still default, try global
        if (savedVoice === "Algieba" && typeof window !== 'undefined') {
            const globalVoice = (window as any).botVoice;
            if (globalVoice) {
                savedVoice = globalVoice;
                console.log('[VoiceCommander] Loaded voice from global:', savedVoice);
            }
        }
        
        console.log('[VoiceCommander] Loaded settings:', { 
            savedPersonality: savedPersonality ? '(set)' : '(empty)', 
            savedVoice 
        });
        
        personalityRef.current = savedPersonality;
        voiceRef.current = savedVoice;

        let isCancelled = false;
        
        const handleBotMessageTTS = async (event: Event) => {
            console.log('[VoiceCommander] Bot message TTS event received');
            const customEvent = event as CustomEvent;
            const textToSpeak = customEvent.detail.text;
            console.log('[VoiceCommander] Text to speak:', textToSpeak);
            
            try {
                console.log('[VoiceCommander] Generating TTS with voice:', voiceRef.current);
                const ttsRes = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: textToSpeak, voice: voiceRef.current })
                });
                if (!ttsRes.ok) {
                    console.error('[VoiceCommander] TTS failed for bot message:', ttsRes.status);
                    return;
                }
                const ttsData = await ttsRes.json();
                console.log('[VoiceCommander] TTS generated successfully');
                
                // Create and play audio directly
                const audio = new Audio(ttsData.audioDataUri);
                console.log('[VoiceCommander] Created audio element with data URI length:', ttsData.audioDataUri.length);
                try {
                    await applySavedSink(audio);
                    console.log('[VoiceCommander] Applied saved audio sink for bot TTS');
                } catch (e) {
                    console.warn('[VoiceCommander] applySavedSink failed for bot TTS:', e);
                }
                try {
                    await audio.play();
                    console.log('[VoiceCommander] Bot TTS audio playback started successfully');
                } catch (e: any) {
                    console.error('[VoiceCommander] Bot TTS audio playback failed:', e);
                    // Try to resume audio context if needed
                    if (e?.name === 'NotAllowedError') {
                        console.log('[VoiceCommander] Audio playback blocked by browser policy, trying to resume context');
                        try {
                            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                            if (audioContext.state === 'suspended') {
                                await audioContext.resume();
                                console.log('[VoiceCommander] Audio context resumed');
                                await audio.play();
                                console.log('[VoiceCommander] Bot TTS audio playback started after context resume');
                            }
                        } catch (contextError) {
                            console.error('[VoiceCommander] Failed to resume audio context:', contextError);
                        }
                    }
                }
            } catch (error) {
                 console.error('[VoiceCommander] Failed to generate TTS for bot message:', error);
            }
        };

        console.log('[VoiceCommander] Adding bot TTS event listener');
        window.addEventListener('play-bot-tts', handleBotMessageTTS);

        function connect() {
            if (isCancelled || !wsUrl) {
                console.log('[VoiceCommander] Connect cancelled or no URL');
                return;
            }
            
            console.log('[VoiceCommander] Connecting to WebSocket:', wsUrl);
            ws.current = new WebSocket(wsUrl);

            ws.current.onopen = () => {
                if (isCancelled) {
                    console.log('[VoiceCommander] WebSocket opened but component cancelled');
                    return;
                }
                console.log('[VoiceCommander] WebSocket connected to server');
                const botSettings = { 
                    personality: personalityRef.current,
                    voice: voiceRef.current
                };
                console.log('[VoiceCommander] Sending bot settings:', botSettings);
                ws.current?.send(JSON.stringify({
                    type: 'update-bot-settings',
                    payload: botSettings
                }));
            };

            ws.current.onmessage = async (event: MessageEvent) => {
                if (isCancelled) {
                    console.log('[VoiceCommander] WebSocket message received but component cancelled');
                    return;
                }
                try {
                    console.log('[VoiceCommander] WebSocket message received:', event.data);
                    const data = JSON.parse(event.data);
                    console.log('[VoiceCommander] Parsed WebSocket data:', data);
                    
                    if (data.type === 'set-translation-mode') {
                        const lang = data.payload?.language || 'none';
                        console.log('[VoiceCommander] Setting translation mode to:', lang);
                        setTranslateLanguage(lang);
                    }
                    
                    if (data.type === 'play-tts' && data.payload?.audioDataUri) {
                        console.log('[VoiceCommander] Playing TTS from WebSocket');
                        // Create and play audio directly
                        const audio = new Audio(data.payload.audioDataUri);
                        try {
                            await applySavedSink(audio);
                            console.log('[VoiceCommander] Applied saved audio sink');
                        } catch (e) {
                            console.warn('[VoiceCommander] applySavedSink failed:', e);
                        }
                        audio.play().catch(e => console.error('[VoiceCommander] WebSocket audio playback failed:', e));
                    }
                    
                    if (data.type === 'play-system-tts' && data.payload?.audioDataUri) {
                        console.log('[VoiceCommander] Playing system TTS for Discord');
                        // Play through default system audio (SteelSeries virtual cable)
                        const audio = new Audio(data.payload.audioDataUri);
                        audio.play().catch(e => console.error('[VoiceCommander] System TTS playback failed:', e));
                    }
                } catch (error) {
                    console.error('[VoiceCommander] Error parsing WebSocket message:', error);
                }
            };

            ws.current.onclose = () => {
                if (isCancelled) {
                    console.log('[VoiceCommander] WebSocket closed but component cancelled');
                    return;
                }
                console.log('[VoiceCommander] WebSocket closed, reconnecting in 5 seconds...');
                setTimeout(connect, 5000);
            };
            
            ws.current.onerror = (error) => {
                if (isCancelled) {
                    console.log('[VoiceCommander] WebSocket error but component cancelled');
                    return;
                }
                console.error('[VoiceCommander] WebSocket error:', error);
                ws.current?.close(); 
            };
        }

        console.log('[VoiceCommander] Starting WebSocket connection...');
        connect();
        
        const handleStorageChange = (e: StorageEvent) => {
            console.log('[VoiceCommander] Storage change event:', e.key, e.newValue);
            if (e.key === 'bot_personality' && e.newValue) {
                personalityRef.current = e.newValue;
                console.log('[VoiceCommander] Updated personality from storage:', e.newValue);
                 ws.current?.send(JSON.stringify({
                    type: 'update-bot-settings',
                    payload: { personality: e.newValue }
                }));
            }
             if (e.key === 'bot_tts_voice' && e.newValue) {
                voiceRef.current = e.newValue;
                console.log('[VoiceCommander] Updated voice from storage:', e.newValue);
                 ws.current?.send(JSON.stringify({
                    type: 'update-bot-settings',
                    payload: { voice: e.newValue }
                }));
            }
        }
        
        console.log('[VoiceCommander] Adding storage event listener');
        window.addEventListener('storage', handleStorageChange);

        return () => {
            console.log('[VoiceCommander] Cleanup - cancelling connections and removing listeners');
            isCancelled = true;
            ws.current?.close();
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('play-bot-tts', handleBotMessageTTS);
        };
    }, []); 

    const processTranscription = async (transcription: string) => {
        console.log('[VoiceCommander] processTranscription() called with:', transcription);
        
        if (!transcription || transcription === "Could not understand audio. Please try again.") {
            console.log('[VoiceCommander] Invalid transcription, skipping processing');
            return;
        }

        // Prevent recursion
        if (isProcessing) {
            console.log('[VoiceCommander] Already processing, skipping...');
            return;
        }
        
        const lowerTranscription = transcription.toLowerCase();
        
        // Check for voice commands (translation on/off)
        if (lowerTranscription.includes('translation on') || lowerTranscription.includes('translation begin')) {
            console.log('[VoiceCommander] Translation ON voice command detected');
            ws.current?.send(JSON.stringify({
                type: 'voice-command',
                payload: { command: transcription }
            }));
            toast({ title: "Translation Mode", description: "Translation enabled - incoming messages will be auto-translated" });
            return;
        }
        
        if (lowerTranscription.includes('translation off') || lowerTranscription.includes('translation end')) {
            console.log('[VoiceCommander] Translation OFF voice command detected');
            ws.current?.send(JSON.stringify({
                type: 'voice-command',
                payload: { command: transcription }
            }));
            toast({ title: "Translation Mode", description: "Translation disabled" });
            return;
        }

        // Check for clip command
        if (lowerTranscription.includes('clip that') || lowerTranscription.includes('clip it')) {
            console.log('[VoiceCommander] Clip command detected');
            const newMessage: TranscribedMessage = { 
                id: Date.now(), 
                text: `Creating clip...`, 
                status: 'pending', 
                speaker: 'commander' 
            };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const clipResult = await createTwitchClip();
                if (clipResult) {
                    console.log('[VoiceCommander] Clip created successfully:', clipResult);
                    toast({ 
                        title: "Clip Created!", 
                        description: "Your Twitch clip has been created" 
                    });
                    setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                        msg.id === newMessage.id ? { ...msg, text: 'Clip created!', status: 'sent' } : msg
                    ));
                } else {
                    throw new Error('Failed to create clip');
                }
            } catch (error: any) {
                console.error('[VoiceCommander] Failed to create clip:', error);
                toast({ 
                    variant: "destructive",
                    title: "Clip Failed", 
                    description: "Could not create clip. Make sure you're live!" 
                });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                    msg.id === newMessage.id ? { ...msg, status: 'error' } : msg
                ));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // Check for BRB commands
        if (lowerTranscription.includes('be right back') || lowerTranscription.includes('brb')) {
            console.log('[VoiceCommander] BRB command detected');
            const newMessage: TranscribedMessage = { 
                id: Date.now(), 
                text: `Starting BRB mode...`, 
                status: 'pending', 
                speaker: 'commander' 
            };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const response = await fetch('/api/brb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start' })
                });
                
                if (response.ok) {
                    console.log('[VoiceCommander] BRB started');
                    toast({ 
                        title: "BRB Mode Active", 
                        description: "Playing clips until you return" 
                    });
                    setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                        msg.id === newMessage.id ? { ...msg, text: 'BRB mode active', status: 'sent' } : msg
                    ));
                } else {
                    throw new Error('Failed to start BRB');
                }
            } catch (error: any) {
                console.error('[VoiceCommander] Failed to start BRB:', error);
                toast({ 
                    variant: "destructive",
                    title: "BRB Failed", 
                    description: "Could not start BRB mode" 
                });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                    msg.id === newMessage.id ? { ...msg, status: 'error' } : msg
                ));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // Check for toggle clip mode
        if (lowerTranscription.includes('toggle') && lowerTranscription.includes('clip')) {
            console.log('[VoiceCommander] Toggle clip mode detected');
            setIsProcessing(true);

            try {
                const response = await fetch('/api/brb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'toggle-mode' })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const mode = data.mode === 'viewer' ? 'viewer clips' : 'your clips';
                    console.log('[VoiceCommander] Clip mode toggled to:', data.mode);
                    toast({ 
                        title: "Clip Mode Changed", 
                        description: `Now playing ${mode}` 
                    });
                }
            } catch (error: any) {
                console.error('[VoiceCommander] Failed to toggle clip mode:', error);
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // Check for shoutout command
        const shoutoutMatch = lowerTranscription.match(/(?:shout\s*out|shoutout)\s+(.+)/i);
        if (shoutoutMatch) {
            const spokenName = shoutoutMatch[1].trim();
            console.log('[VoiceCommander] Shoutout command detected for:', spokenName);
            const newMessage: TranscribedMessage = { 
                id: Date.now(), 
                text: `Shoutout: ${spokenName}`, 
                status: 'pending', 
                speaker: 'commander' 
            };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const response = await fetch('/api/voice-shoutout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: spokenName })
                });
                
                if (response.ok) {
                    console.log('[VoiceCommander] Shoutout triggered for:', spokenName);
                    toast({ title: "Shoutout", description: `Shoutout triggered for ${spokenName}` });
                    setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                        msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg
                    ));
                } else {
                    throw new Error('Shoutout failed');
                }
            } catch (error: any) {
                console.error('[VoiceCommander] Shoutout failed:', error);
                toast({ variant: "destructive", title: "Shoutout Failed", description: error.message });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                    msg.id === newMessage.id ? { ...msg, status: 'error' } : msg
                ));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // Handle translation if enabled - send ONLY translated text
        if (translateLanguage !== 'none') {
            console.log('[VoiceCommander] Translation enabled, translating to:', translateLanguage);
            const translationResult = await translateToLanguage(transcription, translateLanguage);
            
            if (!translationResult.error) {
                console.log('[VoiceCommander] Translated:', translationResult.translatedText);
                
                const newMessage: TranscribedMessage = { 
                    id: Date.now(), 
                    text: `Translated: ${translationResult.translatedText}`, 
                    status: 'pending', 
                    speaker: 'commander' 
                };
                setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
                
                try {
                    const response = await fetch('/api/chat/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: translationResult.translatedText, 
                            as: 'broadcaster' 
                        })
                    });
                    
                    if (response.ok) {
                        toast({ 
                            title: "Translation Sent", 
                            description: `Translated and sent to chat` 
                        });
                        setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                            msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg
                        ));
                    } else {
                        throw new Error('Failed to send translation');
                    }
                } catch (error) {
                    console.warn('[VoiceCommander] Failed to send translation to Twitch:', error);
                    toast({ 
                        variant: "destructive", 
                        title: "Translation Failed", 
                        description: "Could not send to chat" 
                    });
                    setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => 
                        msg.id === newMessage.id ? { ...msg, status: 'error' } : msg
                    ));
                }
                
                // Translation sent, stop processing
                return;
            } else {
                console.error('[VoiceCommander] Translation failed:', translationResult.error);
            }
        }
        
        // Private mode: silent AI conversation only (no commands, no chat)
        if (destination === 'private') {
            console.log('[VoiceCommander] Private mode - STT->AI->TTS only');
            const newMessage: TranscribedMessage = { id: Date.now(), text: transcription, status: 'pending', speaker: 'ai-input' };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const username = userConfig.TWITCH_BROADCASTER_USERNAME || 'Commander';
                const resp = await fetch('/api/private-chat/respond', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        message: `[Private conversation] ${transcription}`,
                        personality: personalityRef.current,
                        historyLimit: 20
                    })
                });

                if (!resp.ok) throw new Error(`Private chat AI failed: ${resp.status}`);
                const data = await resp.json();
                const reply = data?.response?.trim();

                if (reply) {
                    try {
                        const ttsRes = await fetch('/api/tts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: reply, voice: voiceRef.current })
                        });
                        if (ttsRes.ok) {
                            const ttsData = await ttsRes.json();
                            await fetch('/api/tts/current', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ audioUrl: ttsData.audioDataUri })
                            });
                        }
                    } catch (ttsError) {
                        console.error('[VoiceCommander] TTS failed:', ttsError);
                    }
                }

                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg));
            } catch (error: any) {
                console.error('[VoiceCommander] Private chat failed:', error);
                toast({ variant: "destructive", title: "Error", description: error.message });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'error' } : msg));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // AI Bot mode: same as Twitch (commands + AI + TTS) but nothing sent to chat
        if (destination === 'ai') {
            console.log('[VoiceCommander] AI Bot mode - commands + AI + TTS (no chat output)');
            const newMessage: TranscribedMessage = { id: Date.now(), text: transcription, status: 'pending', speaker: 'ai-input' };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const username = userConfig.TWITCH_BROADCASTER_USERNAME || 'Commander';
                const resp = await fetch('/api/ai/chat-with-memory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        message: transcription,
                        personality: personalityRef.current
                    })
                });

                if (!resp.ok) throw new Error(`AI Bot failed: ${resp.status}`);
                const data = await resp.json();
                const reply = data?.response?.trim();
                console.log('[VoiceCommander] AI Bot reply:', reply);

                if (reply) {
                    try {
                        const ttsRes = await fetch('/api/tts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: reply, voice: voiceRef.current })
                        });
                        if (ttsRes.ok) {
                            const ttsData = await ttsRes.json();
                            await fetch('/api/tts/current', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ audioUrl: ttsData.audioDataUri })
                            });
                        }
                    } catch (ttsError) {
                        console.error('[VoiceCommander] TTS failed:', ttsError);
                    }
                }

                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg));
            } catch (error: any) {
                console.error('[VoiceCommander] AI Bot failed:', error);
                toast({ variant: "destructive", title: "Error", description: error.message });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'error' } : msg));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // For Twitch/Discord modes, only send AI response if AI name is mentioned
        const botName = localStorage.getItem('bot_name') || (global as any).botName || 'AI Bot';
        const botUsername = userConfig.TWITCH_BOT_USERNAME || 'streamweaverbot';
        const aiTriggers = [botName.toLowerCase(), botUsername.toLowerCase(), `@${botUsername.toLowerCase()}`];
        const hasAiTrigger = aiTriggers.some(trigger => lowerTranscription.includes(trigger));
        
        if (hasAiTrigger) {
            // AI processing for twitch/discord destinations - send both user message and AI response
            const aiMessage = transcription.replace(new RegExp(`(${aiTriggers.join('|')})`, 'gi'), '').trim();
            
            const newMessage: TranscribedMessage = { id: Date.now(), text: `${botName}: ${aiMessage}`, status: 'pending', speaker: 'ai-input' };
            setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
            setIsProcessing(true);

            try {
                const discordSettings = await fetch('/api/discord/channels').then(res => res.json()).catch(() => ({}));
                const aiChannelId = discordSettings.aiChatChannelId || null;
                const username = userConfig.TWITCH_BROADCASTER_USERNAME || 'Commander';

                // Generate AI response
                console.log('[VoiceCommander] Using AI for', destination, 'mode');
                let reply: string | undefined;

                // Try chat-with-memory if Discord AI channel exists, otherwise use private-chat
                if (aiChannelId) {
                    const resp = await fetch('/api/ai/chat-with-memory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username,
                            message: aiMessage,
                            personality: personalityRef.current,
                            channelId: aiChannelId
                        })
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        reply = data?.response?.trim();
                    }
                } else {
                    const resp = await fetch('/api/private-chat/respond', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username,
                            message: aiMessage,
                            personality: personalityRef.current,
                            historyLimit: 20
                        })
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        reply = data?.response?.trim();
                    }
                }

                // Truncate AI reply for chat destinations
                const chatReply = reply && reply.length > 500 ? reply.slice(0, 497) + '...' : reply;

                // Always send user message to destination, plus AI reply if available
                if (destination === 'twitch') {
                    console.log('[VoiceCommander] Sending to Twitch: user message' + (chatReply ? ' and AI response' : ''));
                    try {
                        await fetch('/api/chat/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ message: transcription, as: 'broadcaster' })
                        });
                        if (chatReply) {
                            await fetch('/api/chat/send', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ message: chatReply, as: 'bot' })
                            });
                        }
                    } catch (error) {
                        console.warn('[VoiceCommander] Failed to send to Twitch:', error);
                    }
                } else if (destination === 'discord') {
                    console.log('[VoiceCommander] Sending to Discord: user message' + (chatReply ? ' and AI response' : ''));
                    const logChannelId = discordSettings.logChannelId;
                    if (logChannelId) {
                        try {
                            const { sendDiscordMessage } = await import('@/services/discord');
                            let avatarUrl = null;
                            try {
                                const profileResponse = await fetch('/api/user-profile');
                                if (profileResponse.ok) {
                                    const profileData = await profileResponse.json();
                                    avatarUrl = profileData.twitch?.avatar;
                                }
                            } catch {}
                            await sendDiscordMessage(logChannelId, transcription, username, avatarUrl);
                            if (chatReply) await sendDiscordMessage(logChannelId, chatReply, botUsername);
                        } catch (error) {
                            console.warn('[VoiceCommander] Failed to send to Discord:', error);
                        }
                    }
                }

                // Generate TTS for AI reply if available
                if (reply) {
                    try {
                        const ttsRes = await fetch('/api/tts', { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify({ text: reply, voice: voiceRef.current }) 
                        });
                        if (ttsRes.ok) {
                            const ttsData = await ttsRes.json();
                            const useTTSPlayer = process.env.NEXT_PUBLIC_USE_TTS_PLAYER !== 'false';
                            if (useTTSPlayer) {
                                await fetch('/api/tts/current', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ audioUrl: ttsData.audioDataUri })
                                });
                            } else {
                                const audio = new Audio(ttsData.audioDataUri);
                                try { await applySavedSink(audio); } catch {}
                                await audio.play();
                            }
                        }
                    } catch (ttsError) {
                        console.error('TTS failed:', ttsError);
                    }
                }
                
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg));
            } catch (error: any) {
                console.error(`Failed to process ${botName} command:`, error);
                toast({ variant: "destructive", title: "Error", description: error.message });
                setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'error' } : msg));
            } finally {
                setIsProcessing(false);
            }
            return;
        }

        // Continue with normal processing based on destination
        let processedText = transcription;

        const speakerForHistory: TranscribedMessage['speaker'] = 'commander';
        const newMessage: TranscribedMessage = { id: Date.now(), text: processedText, status: 'pending', speaker: speakerForHistory };
        setMessages((prev: TranscribedMessage[]) => [newMessage, ...prev.slice(0, 4)]);
        setIsProcessing(true);

        try {
            const speaker: Speaker = 'broadcaster'; // Voice commands are always from the broadcaster

            if (destination === 'twitch') {
                console.log('[VoiceCommander] Sending to Twitch:', processedText);
                const response = await fetch('/api/chat/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: processedText,
                        as: 'broadcaster' // Always send voice commands as broadcaster
                    })
                });
                
                console.log('[VoiceCommander] Twitch API response status:', response.status);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('[VoiceCommander] Twitch API error:', errorData);
                    throw new Error(errorData.error || `Failed to send message: ${response.status}`);
                }
                
                console.log('[VoiceCommander] Message sent to Twitch successfully');
            } else if (destination === 'discord') {
                console.log('[VoiceCommander] Sending to Discord:', processedText);
                const discordSettings = await fetch('/api/discord/channels').then(res => res.json()).catch(() => ({}));
                const logChannelId = discordSettings.logChannelId;
                if (!logChannelId) throw new Error("Discord log channel ID not configured.");
                
                // Use Discord service with webhook impersonation
                const { sendDiscordMessage } = await import('@/services/discord');
                const username = userConfig.TWITCH_BROADCASTER_USERNAME || 'StreamWeaver';
                
                // Get avatar from existing user profile (same source as sidebar)
                let avatarUrl = null;
                try {
                    const profileResponse = await fetch('/api/user-profile');
                    if (profileResponse.ok) {
                        const profileData = await profileResponse.json();
                        avatarUrl = profileData.twitch?.avatar;
                        console.log('[VoiceCommander] Avatar URL from profile:', avatarUrl);
                    } else {
                        console.log('[VoiceCommander] Profile API failed:', profileResponse.status);
                    }
                } catch (error) {
                    console.log('[VoiceCommander] Profile API error:', error);
                }
                
                console.log('[VoiceCommander] Sending Discord message with avatar:', avatarUrl);
                await sendDiscordMessage(logChannelId, processedText, username, avatarUrl);
            }

            setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg));

        } catch (error: any) {
            console.error("Failed to process transcription:", error);
            toast({
                variant: "destructive",
                title: "Error Sending Message",
                description: error.message || "An unknown error occurred.",
            });
            setMessages((prev: TranscribedMessage[]) => prev.map((msg: TranscribedMessage) => msg.id === newMessage.id ? { ...msg, status: 'error' } : msg));
        } finally {
            setIsProcessing(false);
        }
    };

    const startRecording: () => Promise<void> = async () => {
        console.log('[VoiceCommander] startRecording() called, useBrowserSTT:', useBrowserSTT);
        
        if (useBrowserSTT) {
            // Use browser speech recognition
            console.log('[VoiceCommander] Using browser STT');
            try {
                if (!browserSpeechRecognition) {
                    console.error('[VoiceCommander] browserSpeechRecognition is null/undefined');
                    throw new Error('Browser speech recognition not available');
                }
                
                console.log('[VoiceCommander] Checking if browser STT is available...');
                const isAvailable = browserSpeechRecognition.isAvailable();
                console.log('[VoiceCommander] Browser STT available:', isAvailable);
                
                if (!isAvailable) {
                    throw new Error('Browser speech recognition not supported');
                }
                
                setIsTranscribing(true);
                console.log('[VoiceCommander] Starting browser speech recognition...');
                
                const results = await browserSpeechRecognition.startRecognition({
                    continuous: false,
                    interimResults: true,
                    language: 'en-US'
                });
                
                console.log('[VoiceCommander] Speech recognition completed, results:', results);
                
                // Get the best result (final first, then highest confidence)
                const finalResult = results.find(r => r.isFinal);
                const bestResult = finalResult || results.reduce((best, current) => 
                    (current.confidence || 0) > (best.confidence || 0) ? current : best, results[0]
                );
                
                console.log('[VoiceCommander] Best result:', bestResult);
                
                if (bestResult?.transcription?.trim()) {
                    console.log('[VoiceCommander] Processing transcription:', bestResult.transcription.trim());
                    await processTranscription(bestResult.transcription.trim());
                } else {
                    console.warn('[VoiceCommander] No valid transcription found');
                    toast({ variant: "destructive", title: "No speech detected", description: "Please try speaking more clearly" });
                }
            } catch (error: any) {
                console.error('[VoiceCommander] Browser STT error:', error);
                if (error.message !== 'No speech detected') {
                    toast({ variant: "destructive", title: "Speech Recognition Failed", description: error.message });
                }
            } finally {
                console.log('[VoiceCommander] Setting isTranscribing to false');
                setIsTranscribing(false);
            }
            return;
        }

        // Use Google Cloud STT with recording
        console.log('[VoiceCommander] Using Google Cloud STT with recording');
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                console.log('[VoiceCommander] Requesting microphone access...');
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                console.log('[VoiceCommander] Microphone access granted, creating MediaRecorder');
                
                mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunksRef.current = [];

                mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
                    console.log('[VoiceCommander] Audio data available, size:', event.data.size);
                    audioChunksRef.current.push(event.data);
                };

                mediaRecorderRef.current.onstop = async () => {
                    console.log('[VoiceCommander] Recording stopped, processing audio...');
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    console.log('[VoiceCommander] Audio blob created, size:', audioBlob.size);
                    
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = async () => {
                        setIsTranscribing(true);
                        try {
                            console.log('[VoiceCommander] Converting audio to base64...');
                            const base64DataUri = reader.result as string;
                            const base64Audio = base64DataUri.split(',')[1];
                            console.log('[VoiceCommander] Base64 audio length:', base64Audio.length);
                            
                            console.log('[VoiceCommander] Calling transcribeAudio...');
                            const result = await transcribeAudio(base64Audio);
                            console.log('[VoiceCommander] Transcription result:', result);
                            
                            if (result.error) {
                                console.error('[VoiceCommander] Transcription error:', result.error);
                                throw new Error(result.error);
                            }
                            
                            console.log('[VoiceCommander] Processing transcription:', result.transcription);
                            await processTranscription(result.transcription);
                        } catch (error: any) {
                            console.error('[VoiceCommander] Transcription failed:', error);
                            toast({ variant: "destructive", title: "Transcription Failed", description: error.message });
                        } finally {
                            console.log('[VoiceCommander] Cleaning up recording resources');
                            setIsTranscribing(false);
                            stream.getTracks().forEach(track => track.stop());
                        }
                    };
                };

                console.log('[VoiceCommander] Starting MediaRecorder...');
                mediaRecorderRef.current.start();
                setIsRecording(true);
                console.log('[VoiceCommander] Recording started successfully');
            } catch (err) {
                console.error('[VoiceCommander] Microphone access error:', err);
                toast({ variant: "destructive", title: "Microphone Access Denied" });
            }
        } else {
            console.error('[VoiceCommander] MediaDevices API not available');
            toast({ variant: "destructive", title: "Media API Not Available", description: "Your browser doesn't support audio recording" });
        }
    };

    const stopRecording = () => {
        console.log('[VoiceCommander] stopRecording() called');
        if (mediaRecorderRef.current?.state === "recording") {
            console.log('[VoiceCommander] Stopping MediaRecorder...');
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            console.log('[VoiceCommander] MediaRecorder stopped');
        } else {
            console.log('[VoiceCommander] MediaRecorder not in recording state:', mediaRecorderRef.current?.state);
        }
    };
    
    const handleMicClick = () => {
        if (useBrowserSTT) {
            if (!isTranscribing) {
                startRecording();
            }
        } else {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        }
    };

    const getStatusText = () => {
        return isRecording ? "Recording... Click to stop." : 
               isTranscribing ? "Transcribing..." : 
               isProcessing ? "Processing..." : 
               "Push to talk";
    }

    const commanderBody = (
        <div className="flex flex-col gap-3 w-full min-w-0 overflow-x-auto">
            <div className="flex flex-col items-center gap-2">
                <motion.div whileTap={{ scale: 0.95 }}>
                    <Button
                        onClick={handleMicClick}
                        disabled={isTranscribing || isProcessing}
                        className={cn("w-16 h-16 rounded-full transition-colors flex-shrink-0", isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90')}
                    >
                        {isTranscribing || isProcessing ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
                    </Button>
                </motion.div>
                <p className="text-xs text-muted-foreground text-center truncate">{getStatusText()}</p>
            </div>
            <div className="space-y-2 min-w-0">
                <div className="min-w-0">
                    <h4 className="font-medium mb-1 text-xs truncate">Destination</h4>
                    <RadioGroup value={destination} onValueChange={(v) => setDestination(v as Destination)} className="flex flex-wrap gap-1 text-xs min-w-0">
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="private" id="dest-private" className="w-3 h-3" />
                            <Label htmlFor="dest-private" className="text-xs whitespace-nowrap">Private</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="ai" id="dest-ai" className="w-3 h-3" />
                            <Label htmlFor="dest-ai" className="text-xs whitespace-nowrap">AI Bot</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="twitch" id="dest-twitch" className="w-3 h-3" />
                            <Label htmlFor="dest-twitch" className="text-xs whitespace-nowrap">Twitch</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="discord" id="dest-discord" className="w-3 h-3" />
                            <Label htmlFor="dest-discord" className="text-xs whitespace-nowrap">Discord</Label>
                        </div>
                    </RadioGroup>
                </div>
                <div className="min-w-0">
                    <h4 className="font-medium mb-1 text-xs truncate">Translate</h4>
                    <RadioGroup value={translateLanguage} onValueChange={(v) => setTranslateLanguage(v as TargetLanguage | 'none')} className="flex flex-wrap gap-1 text-xs min-w-0">
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="none" id="translate-none" className="w-3 h-3" />
                            <Label htmlFor="translate-none" className="text-xs whitespace-nowrap">Off</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="es" id="translate-es" className="w-3 h-3" />
                            <Label htmlFor="translate-es" className="text-xs whitespace-nowrap">Spanish</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="fr" id="translate-fr" className="w-3 h-3" />
                            <Label htmlFor="translate-fr" className="text-xs whitespace-nowrap">French</Label>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                            <RadioGroupItem value="ru" id="translate-ru" className="w-3 h-3" />
                            <Label htmlFor="translate-ru" className="text-xs whitespace-nowrap">Russian</Label>
                        </div>
                    </RadioGroup>
                </div>
                {messages.length > 0 && (
                    <div className="mt-2">
                        <h4 className="font-medium mb-1 text-xs truncate">History</h4>
                        <div className="space-y-1 max-h-16 overflow-y-auto">
                            {messages.slice(0, 3).map(msg => {
                                const botName = localStorage.getItem('bot_name') || 'AI Bot';
                                const isAiMessage = msg.speaker === 'ai-input' || msg.text.toLowerCase().includes(botName.toLowerCase());
                                return (
                                    <div key={msg.id} className="text-xs text-muted-foreground p-1 bg-muted/50 rounded flex gap-1 items-center">
                                        {isAiMessage ? <Bot className="h-3 w-3 shrink-0" /> : <User className="h-3 w-3 shrink-0" />}
                                        <span className={cn("truncate", msg.status === 'error' && 'text-destructive')}>"{msg.text}"</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    if (variant === 'embedded') {
        return (
            <div className={cn("min-w-0 overflow-x-auto", className)}>
                {commanderBody}
            </div>
        );
    }

    return (
        <Card className={className}>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Voice Commander</CardTitle>
                        <CardDescription>Use your voice to control your stream and interact with your bot.</CardDescription>
                    </div>
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => window.open('/voice', 'voiceWidget', 'width=300,height=280,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no')}
                    >
                        <Maximize2 className="mr-2 h-4 w-4" />
                        Widget
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {commanderBody}
            </CardContent>
        </Card>
    );
}
