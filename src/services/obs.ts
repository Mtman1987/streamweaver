import OBSWebSocket from 'obs-websocket-js';
import { OBSHandlers } from './automation/subactions/OBSHandlers';

let obsClient: OBSWebSocket | null = null;
let connectInFlight: Promise<void> | null = null;

type ObsSettings = {
    url: string;
    password: string;
};

function isLocalObsUrl(url: string): boolean {
    return /^wss?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(url);
}

async function resolveObsSettings(tenantId?: string): Promise<ObsSettings | null> {
    const envUrl = process.env.OBS_WS_URL?.trim();
    const envPassword = (process.env.OBS_WS_PASSWORD || '').trim();
    if (envUrl) {
        if (process.env.FLY_APP_NAME && isLocalObsUrl(envUrl) && process.env.OBS_ALLOW_LOCAL_ON_FLY !== 'true') {
            console.warn('[OBS] Local OBS URL configured on Fly; OBS control disabled for this runtime.');
            return null;
        }
        return { url: envUrl, password: envPassword };
    }

    try {
        const { readVault } = await import('../lib/vault-store');
        const vault = await readVault(tenantId);
        const obs = (vault as any)?.obs || {};
        const explicitUrl = typeof obs.url === 'string' ? obs.url.trim() : '';
        const ip = typeof obs.ip === 'string' ? obs.ip.trim() : '';
        const port = String(obs.port || '').trim();
        const password = typeof obs.password === 'string' ? obs.password : '';

        const url = explicitUrl || (ip && port ? `ws://${ip}:${port}` : '');
        if (!url) return null;
        if (process.env.FLY_APP_NAME && isLocalObsUrl(url)) {
            console.warn('[OBS] Local OBS vault setting ignored on Fly; OBS control disabled for this runtime.');
            return null;
        }
        return { url, password };
    } catch {
        return null;
    }
}

async function connectWithTimeout(client: OBSWebSocket, url: string, password: string, timeoutMs = 8000): Promise<void> {
    const connectPromise = password
        ? (client as any).connect(url, password)
        : (client as any).connect(url);
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`OBS connect timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([connectPromise, timeoutPromise]);
}

export async function setupObsWebSocket(): Promise<void> {
    if (obsClient) return;
    if (connectInFlight) return connectInFlight;

    connectInFlight = (async () => {
        const settings = await resolveObsSettings();
        if (!settings?.url) {
            console.log('[OBS] OBS_WS_URL not set (and no vault obs settings); OBS control disabled.');
            return;
        }

        const { url, password } = settings;
        try {
            obsClient = new OBSWebSocket();

            try {
                (obsClient as any).on?.('ConnectionOpened', () => console.log('[OBS] Connected'));
                (obsClient as any).on?.('ConnectionClosed', () => {
                    // OBS disconnected silently — expected when OBS is not running
                    obsClient = null;
                });
            } catch {
                // ignore
            }

            console.log(`[OBS] Connecting to ${url}...`);
            await connectWithTimeout(obsClient, url, password);

            OBSHandlers.setOBSConnection('default', obsClient);
            console.log('[OBS] Connected and registered with automation engine');
        } catch {
            console.warn('[OBS] Connection unavailable; OBS control disabled for now.');
            obsClient = null;
        } finally {
            connectInFlight = null;
        }
    })();

    try {
        await connectInFlight;
    } finally {
        if (connectInFlight && obsClient) {
            connectInFlight = null;
        }
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
