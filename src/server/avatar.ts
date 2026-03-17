import { promises as fs } from 'fs';
import { resolve } from 'path';

type AvatarState = {
    isVisible: boolean;
    isTalking: boolean;
    currentAnimation: 'idle' | 'talking' | 'gesture';
    idleUrl?: string;
    talkingUrl?: string;
    gestureUrl?: string;
    animationType: 'lottie' | 'gif' | 'mp4';
};

let avatarState: AvatarState = {
    isVisible: false,
    isTalking: false,
    currentAnimation: 'idle',
    animationType: 'lottie'
};

let avatarHideTimer: NodeJS.Timeout | null = null;

export async function loadAvatarSettings() {
    try {
        const settingsFile = resolve(process.cwd(), 'tokens', 'avatar-settings.json');
        const data = await fs.readFile(settingsFile, 'utf-8');
        const settings = JSON.parse(data);
        avatarState = { ...avatarState, ...settings };
        console.log('[Avatar] Settings loaded:', avatarState);
    } catch (error) {
        console.log('[Avatar] No settings file found, using defaults');
    }
}

export async function saveAvatarSettings() {
    try {
        const settingsFile = resolve(process.cwd(), 'tokens', 'avatar-settings.json');
        await fs.writeFile(settingsFile, JSON.stringify(avatarState, null, 2));
    } catch (error) {
        console.error('[Avatar] Failed to save settings:', error);
    }
}

export function updateAvatarState(updates: Partial<AvatarState>, broadcast: (message: object) => void) {
    avatarState = { ...avatarState, ...updates };
    broadcast({
        type: 'avatar-state-update',
        payload: avatarState
    });
    saveAvatarSettings();
}

export function showTalkingAvatar(broadcast: (message: object) => void) {
    if (avatarHideTimer) {
        clearTimeout(avatarHideTimer);
        avatarHideTimer = null;
    }
    
    updateAvatarState({
        isVisible: true,
        isTalking: true,
        currentAnimation: 'talking'
    }, broadcast);
    
    console.log('[Avatar] Switched to talking animation');
}

export function hideAvatarAfterDelay(delayMs: number = 45000, broadcast: (message: object) => void) {
    updateAvatarState({
        isTalking: false,
        currentAnimation: 'idle'
    }, broadcast);
    
    if (avatarHideTimer) {
        clearTimeout(avatarHideTimer);
    }
    
    avatarHideTimer = setTimeout(() => {
        updateAvatarState({
            isVisible: false,
            currentAnimation: 'idle'
        }, broadcast);
        console.log('[Avatar] Hidden after delay');
        avatarHideTimer = null;
    }, delayMs);
    
    console.log(`[Avatar] Switched to idle, will hide in ${delayMs}ms`);
}