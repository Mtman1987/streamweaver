
'use client';

import { useState, useEffect, useRef } from 'react';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import { cn } from '@/lib/utils';
import botAnimation from "@/lib/bot-animation.json";
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

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
    const visibilityTimerRef = useRef<NodeJS.Timeout | null>(null);
    const displayModeRef = useRef<'auto' | 'always'>('auto');

    useEffect(() => {
        const tenantId = getOverlayTenantId();
        const tenantParam = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';

        // OBS browser sources have separate browser storage, so tenant-owned
        // server settings are the only avatar authority.
        const loadSettings = () => fetch(`/api/avatars?type=settings${tenantParam}`, { cache: 'no-store' })
            .then((res) => res.ok ? res.json() : null)
            .then((payload) => {
                const data = payload?.data;
                if (!data) return;
                const serverType = (data.animationType === 'json' ? 'lottie' : data.animationType) as 'lottie' | 'gif' | 'mp4';
                const serverDisplayMode = data.displayMode || 'auto';
                displayModeRef.current = serverDisplayMode === 'always' ? 'always' : 'auto';
                const shouldShow = serverDisplayMode === 'always';
                setAvatarState(prev => ({
                    ...prev,
                    animationType: serverType || prev.animationType,
                    idleUrl: data.idleUrl || (data.idleFile ? `/api/avatars?type=idle&format=${serverType}${tenantParam}` : prev.idleUrl),
                    talkingUrl: data.talkingUrl || (data.talkingFile ? `/api/avatars?type=talking&format=${serverType}${tenantParam}` : prev.talkingUrl),
                    isVisible: shouldShow || prev.isVisible,
                }));

                if (serverType === 'lottie') {
                    if (data.idleFile) {
                        fetch(`/api/avatars?type=idle&format=lottie${tenantParam}`).then(r => r.json()).then(payload => setIdleAnimationData(payload.data)).catch(() => {});
                    }
                    if (data.talkingFile) {
                        fetch(`/api/avatars?type=talking&format=lottie${tenantParam}`).then(r => r.json()).then(payload => setTalkingAnimationData(payload.data)).catch(() => {});
                    }
                }
            })
            .catch(() => {});
        loadSettings();
        const settingsInterval = window.setInterval(loadSettings, 15_000);
        const handleFocus = () => loadSettings();
        window.addEventListener('focus', handleFocus);

        // Connect to WebSocket for real-time updates
        const connectWebSocket = () => {
            const ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
            
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
                    const p = data.payload;
                    if (p.displayMode) displayModeRef.current = p.displayMode === 'always' ? 'always' : 'auto';
                    setAvatarState(prev => ({
                        ...prev,
                        ...p,
                        // Interpret displayMode if sent
                        ...(p.displayMode ? { isVisible: p.displayMode === 'always' } : {}),
                    }));
                }
                
                if (data.type === 'play-tts') {
                    console.log('[Avatar Overlay] TTS started - showing avatar');
                    setAvatarState(prev => ({ ...prev, isVisible: true, isTalking: true, currentAnimation: 'talking' }));
                    
                    // Clear any existing hide or visibility timers
                    if (hideTimerRef.current) {
                        clearTimeout(hideTimerRef.current);
                        hideTimerRef.current = null;
                    }
                    if (visibilityTimerRef.current) {
                        clearTimeout(visibilityTimerRef.current);
                        visibilityTimerRef.current = null;
                    }
                    
                    // Auto-hide after 5 seconds (adjust based on typical TTS length)
                    hideTimerRef.current = setTimeout(() => {
                        setAvatarState(prev => ({ ...prev, isTalking: false, currentAnimation: 'idle' }));
                        
                        const displayMode = displayModeRef.current;
                        if (displayMode === 'auto') {
                            visibilityTimerRef.current = setTimeout(() => {
                                setAvatarState(prev => ({ ...prev, isVisible: false, currentAnimation: 'idle' }));
                                visibilityTimerRef.current = null;
                            }, 60000);
                        }
                        hideTimerRef.current = null;
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
            window.clearInterval(settingsInterval);
            window.removeEventListener('focus', handleFocus);
            if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
            }
            if (visibilityTimerRef.current) {
                clearTimeout(visibilityTimerRef.current);
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
            return (
                <video 
                    key={currentUrl}
                    ref={videoRef}
                    src={currentUrl} 
                    autoPlay 
                    loop 
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                    onError={(e) => console.error('[Avatar Overlay] Video error:', e)}
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
