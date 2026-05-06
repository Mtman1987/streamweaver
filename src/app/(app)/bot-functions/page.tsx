
'use client';

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Languages, Mic, Bot, Upload, Waves, Music, ArrowRight, LoaderCircle, Copy } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { textToSpeech } from "@/ai/flows/text-to-speech";
import { transcribeAudio } from "@/services/speech";
import Lottie from "lottie-react";
import botAnimation from "@/lib/bot-animation.json";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


function isValidLottie(data: unknown): data is Record<string, unknown> {
    return !!data && typeof data === 'object' && Array.isArray((data as any).layers);
}

const availableVoices = [
    // === INWORLD VOICES ===
    { name: 'Ashley', gender: 'Female', description: 'Inworld — warm, friendly' },
    { name: 'Sarah (Inworld)', gender: 'Female', description: 'Inworld — soft, clear' },
    { name: 'Marcus', gender: 'Male', description: 'Inworld — confident' },
    { name: 'David', gender: 'Male', description: 'Inworld — calm, steady' },
    // === ELEVENLABS FEMALE VOICES (Youngest to Oldest) ===
    { name: 'Mimi', gender: 'Female', description: 'Childlike, sweet' },
    { name: 'Freya', gender: 'Female', description: 'Young, pleasant' },
    { name: 'Rachel', gender: 'Female', description: 'Calm, young adult' },
    { name: 'Elli', gender: 'Female', description: 'Emotional, soft' },
    { name: 'Elli (v2)', gender: 'Female', description: 'Emotional, expressive' },
    { name: 'Bella', gender: 'Female', description: 'Soft, gentle' },
    { name: 'Emily', gender: 'Female', description: 'Calm, soothing' },
    { name: 'Serena', gender: 'Female', description: 'Pleasant, clear' },
    { name: 'Nicole', gender: 'Female', description: 'Whisper, soft' },
    { name: 'Sarah', gender: 'Female', description: 'Soft, news anchor' },
    { name: 'Lily', gender: 'Female', description: 'British, warm' },
    { name: 'Alice', gender: 'Female', description: 'British, confident' },
    { name: 'Matilda', gender: 'Female', description: 'Warm, pleasant' },
    { name: 'Domi', gender: 'Female', description: 'Strong, confident' },
    { name: 'Dorothy', gender: 'Female', description: 'British, pleasant' },
    { name: 'Grace', gender: 'Female', description: 'Southern accent' },
    { name: 'Charlotte', gender: 'Female', description: 'Seductive, smooth' },
    { name: 'Glinda', gender: 'Female', description: 'Witch-like, mystical' },
    
    // === MALE VOICES (Youngest to Oldest) ===
    { name: 'Harry', gender: 'Male', description: 'Anxious, younger' },
    { name: 'Charlie', gender: 'Male', description: 'Casual, natural' },
    { name: 'Fin', gender: 'Male', description: 'Irish, friendly' },
    { name: 'Liam', gender: 'Male', description: 'Neutral, clear' },
    { name: 'Sam', gender: 'Male', description: 'Raspy, casual' },
    { name: 'Antoni', gender: 'Male', description: 'Well-rounded, warm' },
    { name: 'Antoni (v2)', gender: 'Male', description: 'Well-rounded, improved' },
    { name: 'Dave', gender: 'Male', description: 'British, conversational' },
    { name: 'Thomas', gender: 'Male', description: 'Calm, meditative' },
    { name: 'James', gender: 'Male', description: 'Calm, soothing' },
    { name: 'Josh', gender: 'Male', description: 'Deep, serious' },
    { name: 'Josh (v2)', gender: 'Male', description: 'Deep, improved' },
    { name: 'Adam', gender: 'Male', description: 'Deep, narrative' },
    { name: 'Adam (v2)', gender: 'Male', description: 'Narrative, engaging' },
    { name: 'Clyde', gender: 'Male', description: 'Middle-aged, warm' },
    { name: 'Patrick', gender: 'Male', description: 'Middle-aged, shouty' },
    { name: 'Daniel', gender: 'Male', description: 'Deep, authoritative' },
    { name: 'Arnold', gender: 'Male', description: 'Crisp, authoritative' },
    { name: 'Arnold (v2)', gender: 'Male', description: 'Crisp, enhanced' },
    { name: 'Callum', gender: 'Male', description: 'Hoarse, intense' }
];


export default function BotFunctionsPage() {
    const { toast } = useToast();
    const [ttsText, setTtsText] = useState("Hello! This is a test of the text-to-speech voice.");
    const [ttsVoice, setTtsVoice] = useState("Ashley");
    const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const [botName, setBotName] = useState("StreamWeaver87");
    const [botInterests, setBotInterests] = useState("");
    const [skipShoutoutOverlay, setSkipShoutoutOverlay] = useState(false);
    const [botPersonality, setBotPersonality] = useState(`You are StreamWeaver87, the onboard AI steward of the Space Mountain — a legendary interstellar cruise liner that drifts between streams. You're friendly, slightly theatrical, and obsessed with keeping passengers (chat) entertained. You speak with the flair of a theme park ride narrator mixed with a helpful concierge. Keep responses to 1-2 sentences. Address viewers as "passengers" and the streamer as "Captain."`);

    const [idleAnimationData, setIdleAnimationData] = useState<any>(botAnimation);
    const [talkingAnimationData, setTalkingAnimationData] = useState<any>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [animationType, setAnimationType] = useState<'lottie' | 'mp4' | 'gif' | null>(null);
    const [idleUrl, setIdleUrl] = useState<string>('');
    const [talkingUrl, setTalkingUrl] = useState<string>('');
    
    const idleFileInputRef = useRef<HTMLInputElement>(null);
    const talkingFileInputRef = useRef<HTMLInputElement>(null);

    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState("");
    const [transcribedText, setTranscribedText] = useState("");
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const [overlayUrl, setOverlayUrl] = useState("");
    const [displayMode, setDisplayMode] = useState('auto');
    const [isOptimizing, setIsOptimizing] = useState(false);

    useEffect(() => {
        // Load all settings from localStorage first, then sync with server
        const loadSettings = async () => {
            const savedIdle = localStorage.getItem("bot_idle_animation");
            const savedTalking = localStorage.getItem("bot_talking_animation");
            const savedVoice = localStorage.getItem("bot_tts_voice");
            const savedName = localStorage.getItem("bot_name");
            const savedPersonality = localStorage.getItem("bot_personality");
            const savedSkipShoutoutOverlay = localStorage.getItem("skip_shoutout_overlay");
            const savedIdleFile = localStorage.getItem("avatar_idle_file");
            const savedTalkingFile = localStorage.getItem("avatar_talking_file");
            const savedInterests = localStorage.getItem("bot_interests");
            const savedType = localStorage.getItem("avatar_type");

            if (savedIdle && savedIdle !== 'undefined') {
                try { const parsed = JSON.parse(savedIdle); if (isValidLottie(parsed)) setIdleAnimationData(parsed); } catch {}
            }
            if (savedTalking && savedTalking !== 'undefined') {
                try { const parsed = JSON.parse(savedTalking); if (isValidLottie(parsed)) setTalkingAnimationData(parsed); } catch {}
            }
            if (savedVoice) setTtsVoice(savedVoice);
            if (savedName) setBotName(savedName);
            if (savedPersonality) setBotPersonality(savedPersonality);
            if (savedSkipShoutoutOverlay) setSkipShoutoutOverlay(savedSkipShoutoutOverlay === 'true');
            if (savedInterests) setBotInterests(savedInterests);
            if (savedIdleFile) setIdleUrl(`/avatars/${savedIdleFile}`);
            if (savedTalkingFile) setTalkingUrl(`/avatars/${savedTalkingFile}`);
            if (savedType) setAnimationType(savedType as 'lottie' | 'mp4' | 'gif');
            else if (!savedType) setAnimationType('lottie');
            
            const savedDisplayMode = localStorage.getItem('avatar_display_mode');
            if (savedDisplayMode) setDisplayMode(savedDisplayMode);
            
            // Try to load bot settings from server (source of truth)
            try {
                const configRes = await fetch('/api/user-config');
                if (configRes.ok) {
                    const configData = await configRes.json();
                    const cfg = configData.data || configData;
                    if (cfg.AI_BOT_NAME && !savedName) setBotName(cfg.AI_BOT_NAME);
                    else if (cfg.AI_BOT_NAME) setBotName(cfg.AI_BOT_NAME);
                    if (cfg.AI_BOT_PERSONALITY && !savedPersonality) setBotPersonality(cfg.AI_BOT_PERSONALITY);
                    else if (cfg.AI_BOT_PERSONALITY) setBotPersonality(cfg.AI_BOT_PERSONALITY);
                    if (cfg.TTS_VOICE && !savedVoice) setTtsVoice(cfg.TTS_VOICE);
                    else if (cfg.TTS_VOICE) setTtsVoice(cfg.TTS_VOICE);
                    if (cfg.AI_BOT_INTERESTS) setBotInterests(cfg.AI_BOT_INTERESTS);
                    if (cfg.SKIP_SHOUTOUT_OVERLAY) setSkipShoutoutOverlay(cfg.SKIP_SHOUTOUT_OVERLAY === 'true');
                }
            } catch (error) {
                console.warn('Failed to load bot config from server:', error);
            }

            // Try to load avatar settings from server
            try {
                const settingsRes = await fetch('/api/avatars?type=settings');
                if (settingsRes.ok) {
                    const payload = await settingsRes.json();
                    const d = payload?.data;
                    if (d) {
                        const serverType = (d.animationType === 'json' ? 'lottie' : d.animationType) as 'lottie' | 'mp4' | 'gif';
                        if (serverType) setAnimationType(serverType);
                        if (d.idleFile) {
                            const url = serverType === 'lottie' ? `/avatars/${d.idleFile}` : `/api/avatars?type=idle&format=${serverType}`;
                            setIdleUrl(url);
                            localStorage.setItem('avatar_idle_file', d.idleFile);
                        }
                        if (d.talkingFile) {
                            const url = serverType === 'lottie' ? `/avatars/${d.talkingFile}` : `/api/avatars?type=talking&format=${serverType}`;
                            setTalkingUrl(url);
                            localStorage.setItem('avatar_talking_file', d.talkingFile);
                        }
                        if (serverType) localStorage.setItem('avatar_type', serverType);
                        if (d.displayMode) {
                            setDisplayMode(d.displayMode);
                            localStorage.setItem('avatar_display_mode', d.displayMode);
                        }
                        // Only sync Lottie animation data
                        if (serverType === 'lottie') {
                            if (d.idleFile) {
                                fetch(`/avatars/${d.idleFile}`).then(r => r.json()).then(json => {
                                    setIdleAnimationData(json);
                                    localStorage.setItem('bot_idle_animation', JSON.stringify(json));
                                }).catch(() => {});
                            }
                            if (d.talkingFile) {
                                fetch(`/avatars/${d.talkingFile}`).then(r => r.json()).then(json => {
                                    setTalkingAnimationData(json);
                                    localStorage.setItem('bot_talking_animation', JSON.stringify(json));
                                }).catch(() => {});
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to sync with server:', error);
            }
            
            // Send current settings to server when page loads
            if (savedPersonality || savedVoice || savedName) {
                const sendToServer = () => {
                    if (typeof window !== 'undefined' && (window as any).ws) {
                        (window as any).ws.send(JSON.stringify({
                            type: 'update-bot-settings',
                            payload: { 
                                personality: savedPersonality || botPersonality,
                                voice: savedVoice || ttsVoice,
                                name: savedName || botName,
                                skipShoutoutOverlay: savedSkipShoutoutOverlay === 'true'
                            }
                        }));
                    } else {
                        setTimeout(sendToServer, 1000);
                    }
                };
                sendToServer();
            }
        };
        
        loadSettings();
        
        // Set the overlay URL
        if (typeof window !== 'undefined') {
            setOverlayUrl(`${window.location.origin}/tts-player`);
        }
    }, []);

    const handleSaveBotIdentity = async () => {
        localStorage.setItem("bot_name", botName);
        localStorage.setItem("bot_personality", botPersonality);
        localStorage.setItem("bot_interests", botInterests);
        localStorage.setItem("skip_shoutout_overlay", skipShoutoutOverlay ? 'true' : 'false');
        
        // Send personality, name, and interests to server via WebSocket or API
        try {
            if (typeof window !== 'undefined' && (window as any).ws && (window as any).ws.readyState === WebSocket.OPEN) {
                (window as any).ws.send(JSON.stringify({
                    type: 'update-bot-settings',
                    payload: { personality: botPersonality, name: botName, interests: botInterests, skipShoutoutOverlay }
                }));
            } else {
                // Fallback to API if WebSocket not available
                await fetch('/api/bot-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ personality: botPersonality, name: botName, interests: botInterests, skipShoutoutOverlay })
                });
            }
        } catch (error) {
            console.error('Failed to update server settings:', error);
        }
        
        toast({ title: "Bot identity saved!" });
    }

    const handleVoiceChange = async (newVoice: string) => {
        setTtsVoice(newVoice);
        localStorage.setItem("bot_tts_voice", newVoice);
        
        // Send voice to server via WebSocket or API
        try {
            if (typeof window !== 'undefined' && (window as any).ws && (window as any).ws.readyState === WebSocket.OPEN) {
                (window as any).ws.send(JSON.stringify({
                    type: 'update-bot-settings',
                    payload: { voice: newVoice }
                }));
            } else {
                // Fallback to API if WebSocket not available
                await fetch('/api/bot-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ voice: newVoice })
                });
            }
        } catch (error) {
            console.error('Failed to update server settings:', error);
        }
    }

    const handleTestVoice = async () => {
        if (!ttsText) {
            toast({
                variant: "destructive",
                title: "Please enter some text to generate speech.",
            });
            return;
        }

        setIsGeneratingSpeech(true);
        setAudioUrl(null);

        try {
            // Use the server TTS endpoint
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: ttsText, voice: ttsVoice })
            });
            
            if (!response.ok) {
                throw new Error(`TTS API failed: ${response.status}`);
            }
            
            const result = await response.json();
            setAudioUrl(result.audioDataUri);
            
            // Route to TTS player (same as Athena uses)
            console.log('[Bot Functions] Sending TTS to player overlay...');
            await fetch('/api/tts/current', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioUrl: result.audioDataUri })
            });
            console.log('[Bot Functions] TTS sent to player successfully');
            
            toast({ title: "TTS sent to overlay player!" });

        } catch (error: any) {
            console.error("Failed to generate speech:", error);
            toast({
                variant: "destructive",
                title: "Speech Generation Failed",
                description: error.message || "An unknown error occurred.",
            });
        } finally {
            setIsGeneratingSpeech(false);
        }
    };
    
    const handleAvatarUploadClick = (type: 'idle' | 'talking') => {
        if (type === 'idle') {
            idleFileInputRef.current?.click();
        } else {
            talkingFileInputRef.current?.click();
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, type: 'idle' | 'talking') => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const fileExt = file.name.split('.').pop()?.toLowerCase();
        
        if (fileExt === 'mp4' || fileExt === 'gif') {
            // Create blob URL for immediate preview
            const url = URL.createObjectURL(file);
            if (type === 'idle') {
                setIdleUrl(url);
            } else {
                setTalkingUrl(url);
            }
            setAnimationType(fileExt as 'mp4' | 'gif');
            
            // Save file to server via FormData (handles large MP4/GIF)
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);
            
            try {
                const res = await fetch('/api/avatars', {
                    method: 'POST',
                    body: formData
                });
                if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
                
                localStorage.setItem(`avatar_${type}_file`, `${type}.${fileExt}`);
                localStorage.setItem('avatar_type', fileExt);
                
                if (typeof window !== 'undefined' && (window as any).ws) {
                    (window as any).ws.send(JSON.stringify({
                        type: 'update-avatar-settings',
                        payload: {
                            [type === 'idle' ? 'idleUrl' : 'talkingUrl']: `/avatars/${type}.${fileExt}`,
                            animationType: fileExt
                        }
                    }));
                }
            } catch (error) {
                console.error('Failed to save avatar:', error);
                toast({ variant: 'destructive', title: 'Upload failed', description: String(error) });
            }
            
            toast({
                title: `${type.charAt(0).toUpperCase() + type.slice(1)} avatar updated!`,
                description: `${fileExt.toUpperCase()} file loaded successfully.`,
            });
        } else if (fileExt === 'json') {
            // Handle Lottie JSON files
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target?.result;
                    if (typeof content === 'string') {
                        const parsedJson = JSON.parse(content);
                        const storageKey = type === 'idle' ? "bot_idle_animation" : "bot_talking_animation";
                        
                        if (type === 'idle') {
                            setIdleAnimationData(parsedJson);
                        } else {
                            setTalkingAnimationData(parsedJson);
                        }
                        localStorage.setItem(storageKey, JSON.stringify(parsedJson));
                        setAnimationType('lottie');

                        try {
                            await fetch('/api/avatars', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type, data: parsedJson })
                            });
                        } catch (error) {
                            console.warn('Failed to save to server:', error);
                        }

                        toast({
                            title: `${type.charAt(0).toUpperCase() + type.slice(1)} avatar updated!`,
                            description: "Lottie animation loaded successfully.",
                        });
                    }
                } catch (error) {
                    console.error("Failed to parse Lottie JSON:", error);
                    toast({
                        variant: "destructive",
                        title: "Invalid File",
                        description: "Please upload a valid Lottie JSON file.",
                    });
                }
            };
            reader.readAsText(file);
        }
    };

    const startRecording = async () => {
        if (isRecording) {
            // This case should ideally not be hit if UI is disabled, but as a safeguard.
            stopRecording();
            return;
        }

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunksRef.current = [];

                mediaRecorderRef.current.ondataavailable = (event) => {
                    audioChunksRef.current.push(event.data);
                };

                mediaRecorderRef.current.onstop = async () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = async () => {
                        const base64DataUri = reader.result as string;
                        setIsTranscribing("true");
                        setTranscribedText("");
                        try {
                            const result = await transcribeAudio(base64DataUri.split(',')[1]);
                            if (result.error) {
                                throw new Error(result.error);
                            }
                            setTranscribedText(result.transcription);
                        } catch (error: any) {
                            console.error("Transcription failed:", error);
                            toast({
                                variant: "destructive",
                                title: "Transcription Failed",
                                description: error.message || "Could not transcribe audio.",
                            });
                        } finally {
                            setIsTranscribing("false");
                            // Clean up the stream
                            stream.getTracks().forEach(track => track.stop());
                        }
                    };
                };

                mediaRecorderRef.current.start();
                setIsRecording(true);
            } catch (err) {
                console.error("Error accessing microphone:", err);
                toast({
                    variant: "destructive",
                    title: "Microphone Access Denied",
                    description: "Please allow microphone access in your browser settings to use this feature.",
                });
            }
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const handleRecordClick = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
    
    const handleCopyToClipboard = () => {
        navigator.clipboard.writeText(overlayUrl).then(() => {
            toast({ title: "Copied overlay URL to clipboard!" });
        }).catch(err => {
            toast({ variant: "destructive", title: "Failed to copy URL." });
        });
    }

  return (
    <div className="grid gap-6">
      <input 
        type="file" 
        ref={idleFileInputRef} 
        className="hidden" 
        accept=".json,.mp4,.gif"
        onChange={(e) => handleFileChange(e, 'idle')}
        aria-label="Upload idle animation file"
      />
       <input 
        type="file" 
        ref={talkingFileInputRef} 
        className="hidden" 
        accept=".json,.mp4,.gif"
        onChange={(e) => handleFileChange(e, 'talking')}
        aria-label="Upload talking animation file"
      />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bot Functions</h1>
        <p className="text-muted-foreground">
          Customize your bot's voice, appearance, and other capabilities.
        </p>
      </div>

       <Alert>
        <Bot className="h-4 w-4" />
        <AlertTitle>TTS + Avatar Overlay URL</AlertTitle>
        <AlertDescription>
            <p className="mb-2">Add this URL as a Browser Source in OBS/Streamlabs for TTS audio and bot avatar together.</p>
            <div className="flex items-center gap-2">
                <Input readOnly value={overlayUrl} className="bg-muted" />
                <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(overlayUrl)}>
                    <Copy className="h-4 w-4" />
                </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Width: 1920px, Height: 1080px — click the source once in OBS to unlock autoplay</p>
        </AlertDescription>
      </Alert>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Bot Identity</CardTitle>
                    <CardDescription>Define your bot's name and personality. This will influence how it responds.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="bot-name">Bot Name</Label>
                        <Input id="bot-name" value={botName} onChange={(e) => setBotName(e.target.value)} placeholder="e.g., Athena, Sparky" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bot-personality">Personality</Label>
                        <Textarea 
                            id="bot-personality" 
                            placeholder="e.g., A helpful and witty AI assistant who loves gaming and cracking jokes." 
                            rows={12}
                            value={botPersonality}
                            onChange={(e) => setBotPersonality(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bot-interests">Bot Interests (comma-separated)</Label>
                        <Input 
                            id="bot-interests" 
                            value={botInterests} 
                            onChange={(e) => setBotInterests(e.target.value)} 
                            placeholder="e.g., space, gaming, music, cooking" 
                        />
                        <p className="text-xs text-muted-foreground">Bot will randomly chime in when these topics are mentioned (50% chance)</p>
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-0.5">
                            <div className="text-sm font-medium">Skip shoutout overlay</div>
                            <div className="text-xs text-muted-foreground">Use one chat message with the AI greeting and Twitch link instead of the video/TTS overlay flow.</div>
                        </div>
                        <Switch checked={skipShoutoutOverlay} onCheckedChange={setSkipShoutoutOverlay} />
                    </div>
                </CardContent>
                <CardFooter className="flex gap-2">
                    <Button onClick={handleSaveBotIdentity}>Save Changes</Button>
                    <Button
                        variant="outline"
                        disabled={isOptimizing || botPersonality.length < 20}
                        onClick={async () => {
                            setIsOptimizing(true);
                            try {
                                const res = await fetch('/api/ai/optimize-personality', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ personality: botPersonality, botName }),
                                });
                                if (!res.ok) throw new Error('Optimization failed');
                                const data = await res.json();
                                const optimized = data.optimized || data.data?.optimized;
                                if (optimized) {
                                    setBotPersonality(optimized);
                                    toast({ title: 'Personality optimized!', description: 'Review the result, then hit Save.' });
                                } else {
                                    throw new Error(data.error || 'AI returned no optimized personality');
                                }
                            } catch (e: any) {
                                toast({ variant: 'destructive', title: 'Optimization failed', description: e.message });
                            } finally {
                                setIsOptimizing(false);
                            }
                        }}
                    >
                        {isOptimizing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                        Optimize Personality
                    </Button>
                </CardFooter>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Speech-to-Text (STT)</CardTitle>
                    <CardDescription>Use your voice to interact with your bot. Click the button to start/stop recording.</CardDescription>
                </CardHeader>
                <CardContent>
                    <motion.div
                        className="flex justify-center"
                        whileTap={{ scale: 0.95 }}
                    >
                        <Button
                            onClick={handleRecordClick}
                            className={ `w-24 h-24 rounded-full transition-colors ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90'}`}
                        >
                            <Mic className="h-10 w-10" />
                        </Button>
                    </motion.div>
                </CardContent>
                 {(isTranscribing || transcribedText) && (
                    <CardFooter>
                        <Card className="w-full">
                            <CardHeader>
                                <CardTitle className="text-lg">Transcribed Text</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {isTranscribing === "true" ? (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <LoaderCircle className="h-4 w-4 animate-spin"/>
                                        <span>Listening...</span>
                                    </div>
                                ) : (
                                    <p className="italic">"{transcribedText}"</p>
                                )}
                            </CardContent>
                        </Card>
                    </CardFooter>
                 )}
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Text-to-Speech (TTS)</CardTitle>
                    <CardDescription>Configure the bot's voice for reading messages aloud. This will play in your overlay.</CardDescription>
                </CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <Label htmlFor="tts-text">Text to Test</Label>
                        <Textarea
                            id="tts-text"
                            value={ttsText}
                            onChange={(e) => setTtsText(e.target.value)}
                            placeholder="Enter text to hear it spoken..."
                        />
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="tts-voice">Voice</Label>
                            <Select value={ttsVoice} onValueChange={handleVoiceChange}>
                                <SelectTrigger id="tts-voice">
                                    <SelectValue placeholder="Select a voice" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableVoices.map((voice, i) => (
                                        <SelectItem key={`${voice.name}-${i}`} value={voice.name}>
                                            <div className="flex justify-between w-full">
                                                <span>{voice.name} ({voice.gender})</span>
                                                <span className="text-muted-foreground ml-4">{voice.description}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tts-speed">Speed</Label>
                            <Input id="tts-speed" type="number" placeholder="1.0" min="0.25" max="4.0" step="0.25" defaultValue="1.0" disabled />
                             <p className="text-xs text-muted-foreground">Speed control is coming soon.</p>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex-col items-start gap-4">
                    <Button onClick={handleTestVoice} disabled={isGeneratingSpeech}>
                         {isGeneratingSpeech ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
                        Test Voice
                    </Button>
                     {audioUrl && (
                        <audio 
                            controls 
                            src={audioUrl} 
                            className="w-full"
                            onPlay={() => setIsSpeaking(true)}
                            onEnded={() => setIsSpeaking(false)}
                        >
                            Your browser does not support the audio element.
                        </audio>
                    )}
                </CardFooter>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Other Functions</CardTitle>
                    <CardDescription>Explore other capabilities of your AI bot.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                        <div className="flex items-center gap-4">
                            <Waves className="h-6 w-6" />
                            <span className="font-semibold">Voice Modulation</span>
                        </div>
                        <Button variant="ghost" size="icon"><ArrowRight className="h-4 w-4" /></Button>
                    </div>
                     <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                        <div className="flex items-center gap-4">
                            <Music className="h-6 w-6" />
                            <span className="font-semibold">Soundboard</span>
                        </div>
                        <Button variant="ghost" size="icon"><ArrowRight className="h-4 w-4" /></Button>
                    </div>
                     <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                        <div className="flex items-center gap-4">
                            <Languages className="h-6 w-6" />
                            <span className="font-semibold">Translations</span>
                        </div>
                        <Button variant="ghost" size="icon"><ArrowRight className="h-4 w-4" /></Button>
                    </div>
                </CardContent>
            </Card>
        </div>
        <div className="space-y-6">
            <Card className="text-center">
                <CardHeader>
                    <CardTitle>Bot Avatar Preview</CardTitle>
                    <CardDescription>This is a preview of your bot's appearance.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                    <div className="w-48 h-48 relative">
                       {animationType === 'lottie' && isValidLottie(idleAnimationData) && (
                         <Lottie animationData={idleAnimationData} loop={true} autoplay={true} />
                       )}
                       {animationType === 'mp4' && idleUrl && (
                         <video src={idleUrl} loop autoPlay muted className="w-full h-full object-contain" />
                       )}
                       {animationType === 'gif' && idleUrl && (
                         <img src={idleUrl} alt="Idle" className="w-full h-full object-contain" />
                       )}
                       {animationType === 'lottie' && isValidLottie(talkingAnimationData) && (
                         <div className={cn("absolute inset-0 transition-opacity", isSpeaking ? 'opacity-100' : 'opacity-0')}>
                            <Lottie animationData={talkingAnimationData} loop={true} autoplay={true} />
                         </div>
                       )}
                       {animationType === 'mp4' && talkingUrl && (
                         <div className={cn("absolute inset-0 transition-opacity", isSpeaking ? 'opacity-100' : 'opacity-0')}>
                            <video src={talkingUrl} loop autoPlay muted className="w-full h-full object-contain" />
                         </div>
                       )}
                       {animationType === 'gif' && talkingUrl && (
                         <div className={cn("absolute inset-0 transition-opacity", isSpeaking ? 'opacity-100' : 'opacity-0')}>
                            <img src={talkingUrl} alt="Talking" className="w-full h-full object-contain" />
                         </div>
                       )}
                    </div>
                    <div className="w-full grid grid-cols-2 gap-2">
                        <Button variant="outline" className="w-full" onClick={() => handleAvatarUploadClick('idle')}>
                            <Upload className="mr-2 h-4 w-4" /> Idle
                        </Button>
                        <Button variant="outline" className="w-full" onClick={() => handleAvatarUploadClick('talking')}>
                            <Upload className="mr-2 h-4 w-4" /> Talking
                        </Button>
                    </div>
                    <div className="w-full">
                        <Label htmlFor="avatar-mode">Display Mode</Label>
                        <Select 
                            value={displayMode} 
                            onValueChange={(value) => {
                                setDisplayMode(value);
                                localStorage.setItem('avatar_display_mode', value);
                                fetch('/api/avatars', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayMode: value }) }).catch(() => {});
                                if (typeof window !== 'undefined' && (window as any).ws) {
                                    (window as any).ws.send(JSON.stringify({
                                        type: 'update-avatar-settings',
                                        payload: { displayMode: value }
                                    }));
                                }
                            }}
                        >
                            <SelectTrigger id="avatar-mode">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="auto">Auto-hide (60s)</SelectItem>
                                <SelectItem value="always">Always On</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}

    
