
'use client';

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Languages, Bot, Upload, Waves, Music, ArrowRight, LoaderCircle, Image as ImageIcon, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { DISCORD_MEDIA_MAX_FILE_BYTES, DISCORD_MEDIA_MAX_FILE_MB } from "@/lib/discord-media-limits";
import Lottie from "lottie-react";
import botAnimation from "@/lib/bot-animation.json";
import { cn } from "@/lib/utils";
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS, normalizeTtsProvider, normalizeTtsVoice } from "@/lib/tts-voices";
import { getClientTenantId } from "@/lib/client-tenant";
import { generationModels } from "@/lib/generation-catalog";


function isValidLottie(data: unknown): data is Record<string, unknown> {
    return !!data && typeof data === 'object' && Array.isArray((data as any).layers);
}

const availableVoices = TTS_VOICE_OPTIONS;

interface GenerationSettings {
    mode: 'eden' | 'seaart' | 'perchance' | 'pollinations';
    publicImageAccess: 'everyone' | 'mods' | 'off';
    publicContentModeration: boolean;
    privateContentModeration: boolean;
    model: string;
    seaartCharacterId: string;
    lora: string;
    loraStrength: number;
    imageCount: number;
    resolution: string;
    steps: number;
    cfg: number;
    seed: number;
    optimizeImagePrompts: boolean;
    showOptimizedPrompt: boolean;
    imagePromptTemplate: string;
}

interface ResearchSettings {
    enabled: boolean;
    liveSearchEnabled: boolean;
    knowledgePacks: string[];
    sourceAllowlist: string[];
    maxResults: number;
    cacheMinutes: number;
}

const defaultResearchSettings: ResearchSettings = {
    enabled: true,
    liveSearchEnabled: false,
    knowledgePacks: [],
    sourceAllowlist: [],
    maxResults: 5,
    cacheMinutes: 15,
};

const defaultImagePromptTemplate = [
    'Rewrite the user idea into one concise image-generation prompt.',
    'Preserve the user intent and do not add unrelated subjects.',
    'Add useful visual detail: subject, medium/style, composition, lighting, background, mood, color, and quality cues.',
    'If the user asks for an avatar, include clean character framing and background details suitable for avatar art.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
].join('\n');

const defaultGenSettings: GenerationSettings = {
    mode: 'eden',
    publicImageAccess: 'everyone',
    publicContentModeration: true,
    privateContentModeration: false,
    model: '',
    seaartCharacterId: '',
    lora: '',
    loraStrength: 0.7,
    imageCount: 1,
    resolution: '1024x1024',
    steps: 30,
    cfg: 7,
    seed: 0,
    optimizeImagePrompts: true,
    showOptimizedPrompt: false,
    imagePromptTemplate: defaultImagePromptTemplate,
};

const avatarPromptPresets = [
    'avatar character, transparent background, facing forward, clean silhouette, centered composition',
    'avatar character, chroma key green screen background, full body, facing forward, even studio lighting',
    'avatar character, 3/4 view, bust portrait, expressive face, clean background, streamer mascot style',
    'animated talking avatar design, front-facing head and shoulders, simple shapes, readable at small size',
];


export default function BotFunctionsPage() {
    const { toast } = useToast();
    const [ttsVoice, setTtsVoice] = useState(DEFAULT_TTS_VOICE);

    const [botName, setBotName] = useState("StreamWeaver87");
    const [botAliases, setBotAliases] = useState("");
    const [botInterests, setBotInterests] = useState("");
    const [skipShoutoutOverlay, setSkipShoutoutOverlay] = useState(false);
    const [botPersonality, setBotPersonality] = useState(`You are **StreamWeaver87**, the onboard AI steward of the Space Mountain cruise liner. (MANDATORY)
You speak with theatrical flair like a theme park ride narrator mixed with a helpful concierge. (MANDATORY)
All responses must be 1-2 sentences only. (MANDATORY)
Never break character. (MANDATORY)
---
STYLE:
- Address the streamer as "Captain."
- Address chat as "passengers" or "travelers."
- Use phrases like "attention passengers," "cruising through the cosmos," "your in-flight entertainment."
- Sound enthusiastic, slightly over-the-top, and warmly helpful.

BEHAVIOR:
- Act like an overly dedicated cruise ship AI who takes their job very seriously.
- Occasionally reference turbulence, destinations, or passenger safety briefings.
- Stay family-friendly and welcoming to new viewers.
- Be helpful with commands and information when asked.

FORBIDDEN:
- No breaking character.
- No real violence, harm, or adult content.
- No paragraphs; keep it short.
- No generic AI assistant responses.

EXAMPLES:
User: "Hey StreamWeaver, what's up?"
StreamWeaver87: "Attention passengers, we are cruising at maximum velocity through the Captain's stream - turbulence expected in the chat zone!"

User: "How do I get points?"
StreamWeaver87: "Ah, a traveler seeking treasure - simply chat and your loyalty miles accumulate automatically, passenger!"`);

    const [idleAnimationData, setIdleAnimationData] = useState<any>(botAnimation);
    const [talkingAnimationData, setTalkingAnimationData] = useState<any>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [animationType, setAnimationType] = useState<'lottie' | 'mp4' | 'gif' | null>(null);
    const [idleUrl, setIdleUrl] = useState<string>('');
    const [talkingUrl, setTalkingUrl] = useState<string>('');
    const [privateDmGifUrl, setPrivateDmGifUrl] = useState("");
    const [publicDiscordGifUrl, setPublicDiscordGifUrl] = useState("");
    const [isSavingMediaSlots, setIsSavingMediaSlots] = useState(false);
    const [genSettings, setGenSettings] = useState<GenerationSettings>(defaultGenSettings);
    const [isSavingGenSettings, setIsSavingGenSettings] = useState(false);
    const [researchSettings, setResearchSettings] = useState<ResearchSettings>(defaultResearchSettings);
    const [isSavingResearch, setIsSavingResearch] = useState(false);
    const popularImageModels = generationModels.filter((item) => item.provider === genSettings.mode && item.model);
    
    const idleFileInputRef = useRef<HTMLInputElement>(null);
    const talkingFileInputRef = useRef<HTMLInputElement>(null);
    const privateDmGifInputRef = useRef<HTMLInputElement>(null);
    const publicDiscordGifInputRef = useRef<HTMLInputElement>(null);
    const [displayMode, setDisplayMode] = useState('auto');
    const [isOptimizing, setIsOptimizing] = useState(false);

    useEffect(() => {
        // Tenant-owned server state is authoritative. Browser storage is not
        // allowed to overwrite another signed-in account's bot or avatar.
        const loadSettings = async () => {
            // Try to load bot settings from server (source of truth)
            try {
                const configRes = await fetch('/api/user-config');
                if (configRes.ok) {
                    const configData = await configRes.json();
                    const cfg = configData.config || configData.data || configData;
                    if (cfg.AI_BOT_NAME) setBotName(cfg.AI_BOT_NAME);
                    if (cfg.AI_BOT_PERSONALITY) setBotPersonality(cfg.AI_BOT_PERSONALITY);
                    const ttsProvider = normalizeTtsProvider(cfg.TTS_PROVIDER);
                    if (cfg.TTS_VOICE) setTtsVoice(normalizeTtsVoice(cfg.TTS_VOICE, ttsProvider));
                    if (cfg.AI_BOT_INTERESTS) setBotInterests(cfg.AI_BOT_INTERESTS);
                    if (cfg.AI_BOT_ALIASES) setBotAliases(cfg.AI_BOT_ALIASES);
                    if (cfg.SKIP_SHOUTOUT_OVERLAY) setSkipShoutoutOverlay(cfg.SKIP_SHOUTOUT_OVERLAY === 'true');
                    if (cfg.PRIVATE_DM_GIF_URL) setPrivateDmGifUrl(cfg.PRIVATE_DM_GIF_URL);
                    if (cfg.PUBLIC_DISCORD_GIF_URL) setPublicDiscordGifUrl(cfg.PUBLIC_DISCORD_GIF_URL);
                }
            } catch (error) {
                console.warn('Failed to load bot config from server:', error);
            }

            try {
                const modeRes = await fetch('/api/bot-settings');
                if (modeRes.ok) {
                    const modeData = await modeRes.json();
                    setSkipShoutoutOverlay(modeData.skipShoutoutOverlay === true);
                }
            } catch (error) {
                console.warn('Failed to load shoutout mode from server:', error);
            }

            try {
                const genRes = await fetch('/api/gen-settings');
                if (genRes.ok) {
                    const data = await genRes.json();
                    setGenSettings({ ...defaultGenSettings, ...data });
                }
            } catch (error) {
                console.warn('Failed to load image generation settings:', error);
            }

            try {
                const researchRes = await fetch('/api/research-settings');
                if (researchRes.ok) {
                    const payload = await researchRes.json();
                    const settings = payload.settings || payload.data?.settings;
                    if (settings) setResearchSettings({ ...defaultResearchSettings, ...settings });
                }
            } catch (error) {
                console.warn('Failed to load research settings:', error);
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
                        if (d.idleUrl || d.idleFile) setIdleUrl(d.idleUrl || `/api/avatars?type=idle&format=${serverType}`);
                        if (d.talkingUrl || d.talkingFile) setTalkingUrl(d.talkingUrl || `/api/avatars?type=talking&format=${serverType}`);
                        if (d.displayMode) {
                            setDisplayMode(d.displayMode);
                        }
                        // Only sync Lottie animation data
                        if (serverType === 'lottie') {
                            if (d.idleFile) {
                                fetch('/api/avatars?type=idle&format=lottie').then(r => r.json()).then(payload => setIdleAnimationData(payload.data)).catch(() => {});
                            }
                            if (d.talkingFile) {
                                fetch('/api/avatars?type=talking&format=lottie').then(r => r.json()).then(payload => setTalkingAnimationData(payload.data)).catch(() => {});
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to sync with server:', error);
            }
            
        };
        
        loadSettings();
    }, []);

    const handleSaveBotIdentity = async () => {
        try {
            const response = await fetch('/api/bot-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personality: botPersonality, name: botName, interests: botInterests, aliases: botAliases, skipShoutoutOverlay })
            });
            if (!response.ok) throw new Error('Server rejected the bot settings');
            toast({ title: "Bot identity saved!" });
        } catch (error) {
            console.error('Failed to update server settings:', error);
            toast({ variant: 'destructive', title: 'Bot identity was not saved' });
        }
    }

    const handleVoiceChange = async (newVoice: string) => {
        setTtsVoice(newVoice);
        try {
            const response = await fetch('/api/bot-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice: newVoice })
            });
            if (!response.ok) throw new Error('Server rejected the voice setting');
        } catch (error) {
            console.error('Failed to update server settings:', error);
        }
    }

    const handleSaveResearch = async () => {
        setIsSavingResearch(true);
        try {
            const response = await fetch('/api/research-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(researchSettings),
            });
            if (!response.ok) throw new Error('Server rejected the research settings');
            const payload = await response.json();
            const settings = payload.settings || payload.data?.settings;
            if (settings) setResearchSettings({ ...defaultResearchSettings, ...settings });
            toast({ title: 'Research mode saved' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Research mode was not saved', description: String(error) });
        } finally {
            setIsSavingResearch(false);
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
                const uploaded = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(uploaded?.error || `Upload failed: ${res.status}`);

                const stableUrl = uploaded.url || `/api/avatars?type=${type}&format=${fileExt}`;
                const savedType = (uploaded.animationType || fileExt) as 'mp4' | 'gif';
                if (type === 'idle') setIdleUrl(stableUrl); else setTalkingUrl(stableUrl);
                setAnimationType(savedType);
                
                if (typeof window !== 'undefined' && (window as any).ws) {
                    (window as any).ws.send(JSON.stringify({
                        type: 'update-avatar-settings',
                        payload: {
                            [type === 'idle' ? 'idleUrl' : 'talkingUrl']: stableUrl,
                            animationType: savedType
                        }
                    }));
                }
                toast({
                    title: `${type.charAt(0).toUpperCase() + type.slice(1)} avatar updated!`,
                    description: uploaded.converted ? 'MP4 converted to GIF by Discord Stream Hub.' : `${fileExt.toUpperCase()} file loaded successfully.`,
                });
            } catch (error) {
                console.error('Failed to save avatar:', error);
                toast({ variant: 'destructive', title: 'Upload failed', description: String(error) });
            }
        } else if (fileExt === 'json') {
            // Handle Lottie JSON files
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target?.result;
                    if (typeof content === 'string') {
                        const parsedJson = JSON.parse(content);
                        if (type === 'idle') {
                            setIdleAnimationData(parsedJson);
                        } else {
                            setTalkingAnimationData(parsedJson);
                        }
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

    const handleSaveMediaSlots = async () => {
        setIsSavingMediaSlots(true);
        try {
            const response = await fetch('/api/user-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PRIVATE_DM_GIF_URL: privateDmGifUrl,
                    PUBLIC_DISCORD_GIF_URL: publicDiscordGifUrl,
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body?.error || 'Failed to save Discord media slots.');
            }
            toast({ title: "Discord media slots saved" });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Save failed", description: error.message || "Could not save Discord media slots." });
        } finally {
            setIsSavingMediaSlots(false);
        }
    };

    const handleDiscordMediaUpload = async (
        event: React.ChangeEvent<HTMLInputElement>,
        slot: 'private-dm' | 'public-discord',
    ) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const fileExt = file.name.split('.').pop()?.toLowerCase();
        if (fileExt !== 'gif' && fileExt !== 'mp4') {
            toast({
                variant: 'destructive',
                title: 'Invalid file',
                description: 'Pick a GIF or MP4 file for this Discord media slot.',
            });
            return;
        }
        if (file.size > DISCORD_MEDIA_MAX_FILE_BYTES) {
            toast({
                variant: 'destructive',
                title: 'Media file is too large',
                description: `Pick a GIF or MP4 no larger than ${DISCORD_MEDIA_MAX_FILE_MB} MB.`,
            });
            return;
        }

        setIsSavingMediaSlots(true);
        try {
            // Upload to public/avatars/ so Discord gets a direct static .gif URL
            const formData = new FormData();
            formData.append('file', file);
            formData.append('slot', slot);

            const uploadResponse = await fetch('/api/discord-media', {
                method: 'POST',
                body: formData,
            });
            if (!uploadResponse.ok) {
                const failure = await uploadResponse.json().catch(() => ({}));
                throw new Error(failure?.error || `Upload failed: ${uploadResponse.status}`);
            }

            const { url: mediaUrl } = await uploadResponse.json();
            const nextPrivateUrl = slot === 'private-dm' ? mediaUrl : privateDmGifUrl;
            const nextPublicUrl = slot === 'public-discord' ? mediaUrl : publicDiscordGifUrl;

            if (slot === 'private-dm') setPrivateDmGifUrl(mediaUrl);
            else setPublicDiscordGifUrl(mediaUrl);

            const saveResponse = await fetch('/api/user-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PRIVATE_DM_GIF_URL: nextPrivateUrl,
                    PUBLIC_DISCORD_GIF_URL: nextPublicUrl,
                }),
            });
            if (!saveResponse.ok) {
                const body = await saveResponse.json().catch(() => ({}));
                throw new Error(body?.error || 'Failed to save Discord media slot.');
            }

            toast({ title: slot === 'private-dm' ? 'Private DM GIF saved' : 'Public Discord GIF saved' });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Upload failed',
                description: error.message || 'Could not save Discord media slot.',
            });
        } finally {
            setIsSavingMediaSlots(false);
        }
    };

    const handleSaveImageGeneration = async () => {
        setIsSavingGenSettings(true);
        try {
            const response = await fetch('/api/gen-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(genSettings),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body?.error || 'Failed to save image generation settings.');
            }
            const saved = await response.json();
            setGenSettings({ ...defaultGenSettings, ...saved });
            toast({ title: "Image generation saved" });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Save failed", description: error.message || "Could not save image generation settings." });
        } finally {
            setIsSavingGenSettings(false);
        }
    };

    const imageLibraryHref = (() => {
        const tenantId = getClientTenantId();
        return tenantId ? `/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}` : '/api/ai/image/library';
    })();

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
      <input
        type="file"
        ref={privateDmGifInputRef}
        className="hidden"
        accept=".gif,.mp4"
        onChange={(e) => handleDiscordMediaUpload(e, 'private-dm')}
        aria-label="Upload private DM GIF"
      />
      <input
        type="file"
        ref={publicDiscordGifInputRef}
        className="hidden"
        accept=".gif,.mp4"
        onChange={(e) => handleDiscordMediaUpload(e, 'public-discord')}
        aria-label="Upload public Discord GIF"
      />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bot Functions</h1>
        <p className="text-muted-foreground">
          Customize your bot's voice, appearance, and other capabilities.
        </p>
      </div>

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
                        <Label htmlFor="bot-aliases">Aliases / Nicknames (comma-separated)</Label>
                        <Input 
                            id="bot-aliases" 
                            value={botAliases} 
                            onChange={(e) => setBotAliases(e.target.value)} 
                            placeholder="e.g., annie, hey athena, athenabot87" 
                        />
                        <p className="text-xs text-muted-foreground">Chat messages containing any of these will trigger the bot (case-insensitive)</p>
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
                    <CardTitle>Research and Knowledge</CardTitle>
                    <CardDescription>
                        Let viewers say “Hey {botName}, I have a question,” then ask a researched follow-up. Knowledge packs need no API key; optional live search uses the server&apos;s configured provider key.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-0.5">
                            <div className="text-sm font-medium">Research mode</div>
                            <div className="text-xs text-muted-foreground">Only explicit question or search phrases start research.</div>
                        </div>
                        <Switch
                            checked={researchSettings.enabled}
                            onCheckedChange={(enabled) => setResearchSettings((current) => ({ ...current, enabled }))}
                        />
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-0.5">
                            <div className="text-sm font-medium">Live web search</div>
                            <div className="text-xs text-muted-foreground">Optional and off by default. Curated packs continue working without a provider key.</div>
                        </div>
                        <Switch
                            checked={researchSettings.liveSearchEnabled}
                            onCheckedChange={(liveSearchEnabled) => setResearchSettings((current) => ({ ...current, liveSearchEnabled }))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="knowledge-packs">Knowledge packs</Label>
                        <Input
                            id="knowledge-packs"
                            value={researchSettings.knowledgePacks.join(', ')}
                            onChange={(event) => setResearchSettings((current) => ({
                                ...current,
                                knowledgePacks: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                            }))}
                            placeholder="e.g., vocaloid"
                        />
                        <p className="text-xs text-muted-foreground">
                            Professor Eevee automatically receives the Vocaloid pack. Packs are tenant-selectable and can cover any subject.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="research-allowlist">Optional live-source allowlist</Label>
                        <Input
                            id="research-allowlist"
                            value={researchSettings.sourceAllowlist.join(', ')}
                            onChange={(event) => setResearchSettings((current) => ({
                                ...current,
                                sourceAllowlist: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                            }))}
                            placeholder="vocaloid.com, piapro.net, vocadb.net"
                        />
                        <p className="text-xs text-muted-foreground">Leave empty to use all HTTPS results returned by the configured search provider.</p>
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleSaveResearch} disabled={isSavingResearch}>
                        {isSavingResearch ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Save Research Settings
                    </Button>
                </CardFooter>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Image Generation</CardTitle>
                    <CardDescription>Configure the DM image workflow used by !img.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="public-image-access">Public !img access</Label>
                            <Select
                                value={genSettings.publicImageAccess}
                                onValueChange={(value) => setGenSettings((prev) => ({ ...prev, publicImageAccess: value as GenerationSettings['publicImageAccess'] }))}
                            >
                                <SelectTrigger id="public-image-access">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="everyone">On — everyone</SelectItem>
                                    <SelectItem value="mods">Mods only</SelectItem>
                                    <SelectItem value="off">Off</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-white/50">Controls public Twitch and Discord image commands for this broadcaster.</p>
                        </div>
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="space-y-0.5 pr-3">
                                <div className="text-sm font-medium">Moderate public prompts</div>
                                <div className="text-xs text-muted-foreground">Recommended for anything that can appear on stream.</div>
                            </div>
                            <Switch
                                checked={genSettings.publicContentModeration}
                                onCheckedChange={(checked) => setGenSettings((prev) => ({ ...prev, publicContentModeration: checked }))}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="space-y-0.5 pr-3">
                                <div className="text-sm font-medium">Moderate private prompts</div>
                                <div className="text-xs text-muted-foreground">Independent from public safety; off by default for private generation.</div>
                            </div>
                            <Switch
                                checked={genSettings.privateContentModeration}
                                onCheckedChange={(checked) => setGenSettings((prev) => ({ ...prev, privateContentModeration: checked }))}
                            />
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="image-provider">Provider</Label>
                            <Select value={genSettings.mode} onValueChange={(value) => setGenSettings((prev) => ({ ...prev, mode: value as GenerationSettings['mode'] }))}>
                                <SelectTrigger id="image-provider">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="seaart">SeaArt</SelectItem>
                                    <SelectItem value="pollinations">Pollinations/free</SelectItem>
                                    <SelectItem value="eden">EdenAI</SelectItem>
                                    <SelectItem value="perchance">Perchance fallback</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-count">Default count</Label>
                            <Select value={String(genSettings.imageCount)} onValueChange={(value) => setGenSettings((prev) => ({ ...prev, imageCount: Number(value) || 1 }))}>
                                <SelectTrigger id="image-count">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1</SelectItem>
                                    <SelectItem value="2">2</SelectItem>
                                    <SelectItem value="3">3</SelectItem>
                                    <SelectItem value="4">4</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-resolution">Resolution</Label>
                            <Input id="image-resolution" value={genSettings.resolution} onChange={(event) => setGenSettings((prev) => ({ ...prev, resolution: event.target.value }))} />
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="image-model">Image model</Label>
                            <Select
                                value={popularImageModels.some((item) => item.model === genSettings.model) ? genSettings.model : '__default'}
                                onValueChange={(value) => setGenSettings((prev) => ({ ...prev, model: value === '__default' ? '' : value }))}
                            >
                                <SelectTrigger id="image-model">
                                    <SelectValue placeholder="Choose a popular model" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__default">Recommended automatic default</SelectItem>
                                    {popularImageModels.map((item) => (
                                        <SelectItem key={item.id} value={item.model!}>{item.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Input
                                aria-label="Custom image model override"
                                value={popularImageModels.some((item) => item.model === genSettings.model) ? '' : genSettings.model}
                                onChange={(event) => setGenSettings((prev) => ({ ...prev, model: event.target.value }))}
                                placeholder={genSettings.mode === 'seaart' ? 'Optional custom modelNo:modelVerNo' : 'Optional advanced model override'}
                            />
                            <p className="text-xs text-white/50">Choose a tested popular model above, or enter an advanced provider model override.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="seaart-character-id">SeaArt character ID</Label>
                            <Input id="seaart-character-id" value={genSettings.seaartCharacterId} onChange={(event) => setGenSettings((prev) => ({ ...prev, seaartCharacterId: event.target.value }))} placeholder="Paste the SeaArt character ID" />
                            <p className="text-xs text-white/50">Paste a character ID or full SeaArt character URL. When set, private app chat and Discord DMs use this character instead of EdenAI. StreamWeaver uses the connected SeaArt account when configured; otherwise it falls back to SeaArt&apos;s limited tourist chat mode.</p>
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="image-seed">Seed</Label>
                            <Input id="image-seed" type="number" value={genSettings.seed} onChange={(event) => setGenSettings((prev) => ({ ...prev, seed: Number(event.target.value) || 0 }))} />
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="space-y-0.5">
                                <div className="text-sm font-medium">Optimize prompts</div>
                                <div className="text-xs text-muted-foreground">Rewrite short ideas before sending them to the image provider.</div>
                            </div>
                            <Switch checked={genSettings.optimizeImagePrompts} onCheckedChange={(checked) => setGenSettings((prev) => ({ ...prev, optimizeImagePrompts: checked }))} />
                        </div>
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="space-y-0.5">
                                <div className="text-sm font-medium">Show optimized prompt</div>
                                <div className="text-xs text-muted-foreground">Send the polished prompt before image results.</div>
                            </div>
                            <Switch checked={genSettings.showOptimizedPrompt} onCheckedChange={(checked) => setGenSettings((prev) => ({ ...prev, showOptimizedPrompt: checked }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="image-prompt-template">Prompt optimizer instruction</Label>
                        <Textarea
                            id="image-prompt-template"
                            rows={7}
                            value={genSettings.imagePromptTemplate}
                            onChange={(event) => setGenSettings((prev) => ({ ...prev, imagePromptTemplate: event.target.value }))}
                        />
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                        {avatarPromptPresets.map((preset) => (
                            <Button
                                key={preset}
                                variant="outline"
                                className="h-auto justify-start whitespace-normal text-left"
                                onClick={() => setGenSettings((prev) => ({
                                    ...prev,
                                    imagePromptTemplate: `${prev.imagePromptTemplate.trim()}\n\nAvatar preset guidance: ${preset}`,
                                }))}
                            >
                                <Sparkles className="mr-2 h-4 w-4 shrink-0" />
                                {preset}
                            </Button>
                        ))}
                    </div>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                    <Button onClick={handleSaveImageGeneration} disabled={isSavingGenSettings}>
                        {isSavingGenSettings ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                        Save image generation
                    </Button>
                    <Button asChild variant="outline">
                        <a href={imageLibraryHref} target="_blank" rel="noreferrer">Open image library</a>
                    </Button>
                </CardFooter>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Voice Profile</CardTitle>
                    <CardDescription>The live TTS controls moved to Overlay URLs. Keep the saved bot voice here so every page uses the same setting.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[1fr_180px]">
                    <div className="space-y-2">
                        <Label htmlFor="tts-voice">Bot voice</Label>
                        <Select value={ttsVoice} onValueChange={handleVoiceChange}>
                            <SelectTrigger id="tts-voice">
                                <SelectValue placeholder="Select a voice" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableVoices.map((voice, i) => (
                                    <SelectItem key={`${voice.id}-${i}`} value={voice.id}>
                                        {voice.label} ({voice.gender}) ({voice.providerLabel})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Overlay controls</Label>
                        <Button asChild variant="outline" className="w-full">
                            <a href="/overlay-urls">Open Overlay URLs</a>
                        </Button>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Discord media slots</CardTitle>
                    <CardDescription>Keep separate media for private DMs/private chat and public Discord embeds.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="private-dm-gif">Private DM / app private chat GIF URL</Label>
                        <div className="flex gap-2">
                            <Input
                                id="private-dm-gif"
                                value={privateDmGifUrl}
                                onChange={(event) => setPrivateDmGifUrl(event.target.value)}
                                placeholder="https://..."
                            />
                            <Button type="button" variant="outline" onClick={() => privateDmGifInputRef.current?.click()} disabled={isSavingMediaSlots}>
                                <Upload className="mr-2 h-4 w-4" />
                                Pick
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="public-discord-gif">Public Discord / embed GIF URL</Label>
                        <div className="flex gap-2">
                            <Input
                                id="public-discord-gif"
                                value={publicDiscordGifUrl}
                                onChange={(event) => setPublicDiscordGifUrl(event.target.value)}
                                placeholder="https://..."
                            />
                            <Button type="button" variant="outline" onClick={() => publicDiscordGifInputRef.current?.click()} disabled={isSavingMediaSlots}>
                                <Upload className="mr-2 h-4 w-4" />
                                Pick
                            </Button>
                        </div>
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleSaveMediaSlots} disabled={isSavingMediaSlots}>
                        {isSavingMediaSlots ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save media slots
                    </Button>
                </CardFooter>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Quick links</CardTitle>
                    <CardDescription>Shortcuts for the pieces that still matter after moving live TTS controls out of this page.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="mb-2 flex items-center gap-3">
                            <Waves className="h-5 w-5" />
                            <span className="font-semibold">Private TTS listener</span>
                        </div>
                        <p className="mb-3 text-sm text-muted-foreground">Open the always-on private voice listener page for DM/private chat playback routing.</p>
                        <Button asChild variant="outline" size="sm">
                            <Link href="/tts-listener">Open listener</Link>
                        </Button>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="mb-2 flex items-center gap-3">
                            <Music className="h-5 w-5" />
                            <span className="font-semibold">Voice reply</span>
                        </div>
                        <p className="mb-3 text-sm text-muted-foreground">Use the browser-assisted reply station for private voice workflows and mic capture.</p>
                        <Button asChild variant="outline" size="sm">
                            <Link href="/voice-reply">Open voice reply</Link>
                        </Button>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="mb-2 flex items-center gap-3">
                            <Languages className="h-5 w-5" />
                            <span className="font-semibold">Overlay URLs</span>
                        </div>
                        <p className="mb-3 text-sm text-muted-foreground">Copy the live overlay/browser-source URLs, including the TTS and avatar surfaces.</p>
                        <Button asChild variant="outline" size="sm">
                            <Link href="/overlay-urls">Open overlays</Link>
                        </Button>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="mb-2 flex items-center gap-3">
                            <ArrowRight className="h-5 w-5" />
                            <span className="font-semibold">Quackverse status</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Still pending. The rest of this page is now aligned around working avatar, TTS, DM, and public media controls.</p>
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
                    <div className="w-full grid grid-cols-2 gap-2">
                        <Button variant="outline" onClick={() => setIsSpeaking(true)}>Preview talking</Button>
                        <Button variant="outline" onClick={() => setIsSpeaking(false)}>Preview idle</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}

    
