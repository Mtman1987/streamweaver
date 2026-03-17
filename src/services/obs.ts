import OBSWebSocket from 'obs-websocket-js';
import { OBSHandlers } from './automation/subactions/OBSHandlers';

let obsClient: OBSWebSocket | null = null;

export async function setupObsWebSocket(): Promise<void> {
    const url = process.env.OBS_WS_URL;
    const password = process.env.OBS_WS_PASSWORD || '';

    if (!url) {
        console.log('[OBS] OBS_WS_URL not set; OBS control disabled.');
        return;
    }

    try {
        obsClient = new OBSWebSocket();

        try {
            (obsClient as any).on?.('ConnectionOpened', () => console.log('[OBS] Connected'));
            (obsClient as any).on?.('ConnectionClosed', () => console.log('[OBS] Disconnected'));
        } catch {
            // ignore
        }

        console.log(`[OBS] Connecting to ${url}...`);

        if (password) {
            await (obsClient as any).connect(url, password);
        } else {
            await (obsClient as any).connect(url);
        }
        
        OBSHandlers.setOBSConnection('default', obsClient);
        console.log('[OBS] Connected and registered with automation engine');
    } catch (error) {
        console.error('[OBS] Failed to connect:', error);
        obsClient = null;
    }
}

export function getObsClient(): OBSWebSocket | null {
    return obsClient;
}

export async function setScene(sceneName: string): Promise<void> {
    if (!obsClient) throw new Error('OBS not connected');
    await (obsClient as any).call('SetCurrentProgramScene', { sceneName });
}

export async function getCurrentScene(): Promise<string> {
    if (!obsClient) return '';
    const response = await (obsClient as any).call('GetCurrentProgramScene');
    return response?.currentProgramSceneName || '';
}

export async function setBrowserSource(sceneName: string, sourceName: string, url: string): Promise<void> {
    if (!obsClient) {
        console.warn('[OBS] Not connected, skipping browser source update');
        return;
    }
    await (obsClient as any).call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { url }
    });
}

export async function updateBrowserSource(sceneName: string, sourceName: string, url: string): Promise<void> {
    return setBrowserSource(sceneName, sourceName, url);
}