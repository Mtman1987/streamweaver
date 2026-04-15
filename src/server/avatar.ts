import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '../lib/tenant';

type AvatarState = {
    isVisible: boolean;
    isTalking: boolean;
    currentAnimation: 'idle' | 'talking' | 'gesture';
    idleUrl?: string;
    talkingUrl?: string;
    gestureUrl?: string;
    animationType: 'lottie' | 'gif' | 'mp4';
};

// Per-tenant avatar state
const tenantAvatarState = new Map<string, AvatarState>();
const tenantHideTimers = new Map<string, NodeJS.Timeout>();

const DEFAULT_STATE: AvatarState = {
    isVisible: false,
    isTalking: false,
    currentAnimation: 'idle',
    animationType: 'lottie'
};

function settingsPath(tenantId?: string): string {
    if (tenantId) return tenantPath(tenantId, 'tokens/avatar-settings.json');
    return resolve(process.cwd(), 'tokens', 'avatar-settings.json');
}

function getState(tenantId?: string): AvatarState {
    const key = tenantId || '__global';
    if (!tenantAvatarState.has(key)) {
        tenantAvatarState.set(key, { ...DEFAULT_STATE });
    }
    return tenantAvatarState.get(key)!;
}

function setState(state: AvatarState, tenantId?: string): void {
    const key = tenantId || '__global';
    tenantAvatarState.set(key, state);
}

export async function loadAvatarSettings(tenantId?: string) {
    try {
        const data = await fs.readFile(settingsPath(tenantId), 'utf-8');
        const settings = JSON.parse(data);
        setState({ ...getState(tenantId), ...settings }, tenantId);
        console.log(`[Avatar] Settings loaded for ${tenantId || 'global'}`);
    } catch {
        console.log(`[Avatar] No settings file found for ${tenantId || 'global'}, using defaults`);
    }
}

export async function saveAvatarSettings(tenantId?: string) {
    try {
        const dir = resolve(settingsPath(tenantId), '..');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(settingsPath(tenantId), JSON.stringify(getState(tenantId), null, 2));
    } catch (error) {
        console.error('[Avatar] Failed to save settings:', error);
    }
}

export function updateAvatarState(updates: Partial<AvatarState>, broadcast: (message: object, tenantId?: string) => void, tenantId?: string) {
    const state = { ...getState(tenantId), ...updates };
    setState(state, tenantId);
    broadcast({
        type: 'avatar-state-update',
        payload: state
    }, tenantId);
    saveAvatarSettings(tenantId);
}

export function showTalkingAvatar(broadcast: (message: object, tenantId?: string) => void, tenantId?: string) {
    const key = tenantId || '__global';
    const timer = tenantHideTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        tenantHideTimers.delete(key);
    }
    
    updateAvatarState({
        isVisible: true,
        isTalking: true,
        currentAnimation: 'talking'
    }, broadcast, tenantId);
}

export function hideAvatarAfterDelay(delayMs: number = 45000, broadcast: (message: object, tenantId?: string) => void, tenantId?: string) {
    const key = tenantId || '__global';
    
    updateAvatarState({
        isTalking: false,
        currentAnimation: 'idle'
    }, broadcast, tenantId);
    
    const existing = tenantHideTimers.get(key);
    if (existing) clearTimeout(existing);
    
    const timer = setTimeout(() => {
        updateAvatarState({
            isVisible: false,
            currentAnimation: 'idle'
        }, broadcast, tenantId);
        tenantHideTimers.delete(key);
    }, delayMs);
    
    tenantHideTimers.set(key, timer);
}
