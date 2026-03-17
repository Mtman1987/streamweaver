
'use client';

import { useState, useEffect, useRef } from 'react';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import { cn } from '@/lib/utils';
import botAnimation from "@/lib/bot-animation.json";
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

type AvatarState = {
    isVisible: boolean;
    isTalking: boolean;
    currentAnimation: 'idle' | 'talking' | 'gesture';
    idleUrl?: string;
    talkingUrl?: string;
    gestureUrl?: string;
    animationType: 'lottie' | 'gif' | 'mp4';
};

export default function AvatarOverlayPage() {
    const [avatarState, setAvatarState] = useState<AvatarState>({
        isVisible: false,
        isTalking: false,
        currentAnimation: 'idle',
        animationType: 'mp4',
        idleUrl: '/avatars/idle.mp4',
        talkingUrl: '/avatars/talking.mp4'
    });
    const [idleAnimationData, setIdleAnimationData] = useState<any>(botAnimation);
    const [talkingAnimationData, setTalkingAnimationData] = useState<any>(null);
    const [gestureAnimationData, setGestureAnimationData] = useState<any>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isGesturing, setIsGesturing] = useState(false);
    const idleLottieRef = useRef<LottieRefCurrentProps>(null);
    const talkingLottieRef = useRef<LottieRefCurrentProps>(null);
    const gestureLottieRef = useRef<LottieRefCurrentProps>(null);
    const gestureTimerRef = useRef<NodeJS.Timeout | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Load saved avatar files from localStorage
        const savedIdleFile = localStorage.getItem('avatar_idle_file');
        const savedTalkingFile = localStorage.getItem('avatar_talking_file');
        const savedType = localStorage.getItem('avatar_type');
        const savedDisplayMode = localStorage.getItem('avatar_display_mode') || 'auto';
        const savedIdleAnimation = localStorage.getItem('bot_idle_animation');
        const savedTalkingAnimation = localStorage.getItem('bot_talking_animation');
        
        console.log('[Avatar Overlay] Loading settings:', { savedIdleFile, savedTalkingFile, savedType, savedDisplayMode });
        
        // Override defaults if localStorage has values
        if (savedIdleFile || savedTalkingFile || savedType) {
            setAvatarState(prev => ({
                ...prev,
                idleUrl: savedIdleFile ? `/avatars/${savedIdleFile}` : prev.idleUrl,
                talkingUrl: savedTalkingFile ? `/avatars/${savedTalkingFile}` : prev.talkingUrl,
                animationType: (savedType as 'lottie' | 'mp4' | 'gif') || prev.animationType,
                isVisible: savedDisplayMode === 'always'
            }));
        } else if (savedDisplayMode === 'always') {
            setAvatarState(prev => ({ ...prev, isVisible: true }));
        }

        // OBS browser source has separate localStorage. Load server-persisted avatar settings too.
        fetch('/api/avatars?type=settings')
            .then((res) => res.ok ? res.json() : null)
            .then((payload) => {
                const data = payload?.data;
                if (!data) return;
                const serverType = (data.animationType === 'json' ? 'lottie' : data.animationType) as 'lottie' | 'gif' | 'mp4';
                setAvatarState(prev => ({
                    ...prev,
                    animationType: serverType || prev.animationType,
                    idleUrl: data.idleFile ? `/avatars/${data.idleFile}` : prev.idleUrl,
                    talkingUrl: data.talkingFile ? `/avatars/${data.talkingFile}` : prev.talkingUrl,
                    isVisible: savedDisplayMode === 'always' || prev.isVisible,
                }));

                if (serverType === 'lottie') {
                    if (data.idleFile) {
                        fetch(`/avatars/${data.idleFile}`).then(r => r.json()).then(setIdleAnimationData).catch(() => {});
                    }
                    if (data.talkingFile) {
                        fetch(`/avatars/${data.talkingFile}`).then(r => r.json()).then(setTalkingAnimationData).catch(() => {});
                    }
                }
            })
            .catch(() => {});

        // Load Lottie animation JSON if available
        if (savedIdleAnimation) {
            try {
                setIdleAnimationData(JSON.parse(savedIdleAnimation));
            } catch (error) {
                console.warn('[Avatar Overlay] Failed to parse idle animation JSON:', error);
            }
        }
        if (savedTalkingAnimation) {
            try {
                setTalkingAnimationData(JSON.parse(savedTalkingAnimation));
            } catch (error) {
                console.warn('[Avatar Overlay] Failed to parse talking animation JSON:', error);
            }
        }
        
        // Connect to WebSocket for real-time updates
        const connectWebSocket = () => {
            const ws = new WebSocket(getBrowserWebSocketUrl());
            
            ws.onopen = () => {
                console.log('[Avatar Overlay] WebSocket connected');
            };
            
            ws.onmessage = (event) => {
                let data: any;
                try {
                    data = JSON.parse(event.data as string);
                } catch (error) {
                    console.warn('[Avatar Overlay] Ignoring non-JSON websocket payload');
                    return;
                }
                console.log('[Avatar Overlay] Received:', data.type);
                
                if (data.type === 'update-avatar-settings') {
                    console.log('[Avatar Overlay] Updating settings:', data.payload);
                    setAvatarState(prev => ({ ...prev, ...data.payload }));
                }
                
                if (data.type === 'play-tts') {
                    console.log('[Avatar Overlay] TTS started - showing avatar');
                    setAvatarState(prev => ({ ...prev, isVisible: true, isTalking: true }));
                    
                    // Clear any existing hide timer
                    if (hideTimerRef.current) {
                        clearTimeout(hideTimerRef.current);
                    }
                    
                    // Auto-hide after 5 seconds (adjust based on typical TTS length)
                    hideTimerRef.current = setTimeout(() => {
                        setAvatarState(prev => ({ ...prev, isTalking: false }));
                        
                        const displayMode = localStorage.getItem('avatar_display_mode') || 'auto';
                        if (displayMode === 'auto') {
                            setTimeout(() => {
                                setAvatarState(prev => ({ ...prev, isVisible: false }));
                            }, 60000);
                        }
                    }, 5000);
                }
            };
            
            ws.onclose = () => {
                console.log('[Avatar Overlay] WebSocket closed, reconnecting...');
                setTimeout(connectWebSocket, 1000);
            };
            
            ws.onerror = (error) => {
                console.error('[Avatar Overlay] WebSocket error:', error);
            };
        };
        
        connectWebSocket();

        return () => {
            if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
            }
        };
    }, []);


    // Render based on animation type
    const renderAnimation = () => {
        const isIdle = !avatarState.isTalking;
        const currentUrl = isIdle ? avatarState.idleUrl : avatarState.talkingUrl;

        if (avatarState.animationType === 'gif' && currentUrl) {
            return (
                <img 
                    ref={imgRef}
                    src={currentUrl} 
                    alt="Avatar" 
                    className="w-full h-full object-contain"
                />
            );
        }

        if (avatarState.animationType === 'mp4' && currentUrl) {
            console.log('[Avatar Overlay] Rendering MP4:', currentUrl);
            return (
                <video 
                    ref={videoRef}
                    src={currentUrl} 
                    autoPlay 
                    loop 
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                    onError={(e) => console.error('[Avatar Overlay] Video error:', e)}
                    onLoadedData={() => console.log('[Avatar Overlay] Video loaded:', currentUrl)}
                />
            );
        }

        // Lottie animations
        return (
            <>
                {avatarState.idleUrl && (
                    <div className={cn("absolute inset-0 transition-opacity duration-200", isIdle ? 'opacity-100' : 'opacity-0')}>
                        <Lottie 
                            lottieRef={idleLottieRef}
                            animationData={idleAnimationData} 
                            loop={false}
                            autoplay={true}
                            onComplete={() => {
                                if (idleLottieRef.current) {
                                    idleLottieRef.current.setDirection(-1);
                                    idleLottieRef.current.play();
                                }
                            }}
                            onLoopComplete={() => {
                                if (idleLottieRef.current) {
                                    const direction = idleLottieRef.current.animationItem?.playDirection || 1;
                                    idleLottieRef.current.setDirection(direction === 1 ? -1 : 1);
                                    idleLottieRef.current.play();
                                }
                            }}
                        />
                    </div>
                )}
                {avatarState.talkingUrl && (
                    <div className={cn("absolute inset-0 transition-opacity duration-200", !isIdle ? 'opacity-100' : 'opacity-0')}>
                        <Lottie 
                            lottieRef={talkingLottieRef}
                            animationData={talkingAnimationData || idleAnimationData} 
                            loop={false}
                            autoplay={true}
                            onComplete={() => {
                                if (talkingLottieRef.current) {
                                    talkingLottieRef.current.setDirection(-1);
                                    talkingLottieRef.current.play();
                                }
                            }}
                            onLoopComplete={() => {
                                if (talkingLottieRef.current) {
                                    const direction = talkingLottieRef.current.animationItem?.playDirection || 1;
                                    talkingLottieRef.current.setDirection(direction === 1 ? -1 : 1);
                                    talkingLottieRef.current.play();
                                }
                            }}
                        />
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="relative w-screen h-screen bg-transparent">
            {/* The container can be sized and positioned via OBS/Streamlabs */}
            <div className={cn(
                "absolute bottom-0 left-0 w-[300px] h-[300px] transition-opacity duration-500",
                avatarState.isVisible ? "opacity-100" : "opacity-0"
            )}>
                <div className="relative w-full h-full">
                    {renderAnimation()}
                </div>
            </div>

            {/* Avatar only - audio plays in TTS player overlay */}
        </div>
    );
}
