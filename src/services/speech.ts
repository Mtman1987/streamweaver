
'use server';

import { SpeechClient } from '@google-cloud/speech';
import { getBrokerAuthHeaders, getBrokerBaseUrl, joinBrokerUrl } from '@/lib/broker';

let speechClient: SpeechClient | null = null;
let warnedMissingGoogleCreds = false;

type ServiceAccountJson = {
    project_id?: string;
    client_email?: string;
    private_key?: string;
};

function getServiceAccountFromEnv(): ServiceAccountJson | null {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
        return JSON.parse(raw) as ServiceAccountJson;
    } catch (error) {
        console.error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON:', error);
        return null;
    }
}

function getSpeechClient(): SpeechClient {
    if (!speechClient) {
        const serviceAccount = getServiceAccountFromEnv();
        if (serviceAccount?.client_email && serviceAccount?.private_key) {
            speechClient = new SpeechClient({
                credentials: {
                    client_email: serviceAccount.client_email,
                    private_key: serviceAccount.private_key,
                },
                projectId: serviceAccount.project_id,
            });
        } else {
            // Relies on Application Default Credentials (e.g., GOOGLE_APPLICATION_CREDENTIALS)
            speechClient = new SpeechClient();
        }
    }
    return speechClient;
}

/**
 * Transcribes a base64 encoded audio string using Google Cloud Speech-to-Text v1 API.
 * @param base64Audio The base64 encoded audio data (without the data:audio/webm;base64, prefix).
 * @returns The transcription text.
 */
export async function transcribeAudio(base64Audio: string): Promise<{ transcription: string, error?: string}> {
    const brokerBaseUrl = getBrokerBaseUrl();
    if (brokerBaseUrl) {
        try {
            const upstream = await fetch(joinBrokerUrl(brokerBaseUrl, '/v1/speech-to-text'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await getBrokerAuthHeaders()),
                },
                body: JSON.stringify({ base64Audio }),
            });

            const data = await upstream.json().catch(() => null);
            if (!upstream.ok) {
                return {
                    transcription: '',
                    error: (data as any)?.error || `Broker STT failed (HTTP ${upstream.status})`,
                };
            }

            const transcription = (data as any)?.transcription;
            return { transcription: typeof transcription === 'string' ? transcription : '' };
        } catch (error: any) {
            return { transcription: '', error: `Broker STT request failed: ${error?.message || String(error)}` };
        }
    }

    const projectId = getServiceAccountFromEnv()?.project_id;
    const hasAdcPath = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!projectId && !hasAdcPath) {
        if (!warnedMissingGoogleCreds) {
            warnedMissingGoogleCreds = true;
            console.warn(
                'Google credentials not configured (set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON), and BROKER_BASE_URL is not set.'
            );
        }
        return { transcription: '', error: 'Server configuration error: Google credentials not configured.' };
    }

    const client = getSpeechClient();
    
    const audio = {
        content: base64Audio,
    };
    
    const config = {
        encoding: 'WEBM_OPUS' as const,
        sampleRateHertz: 48000, // Common for webm from browsers
        languageCode: 'en-US',
        model: 'default', // Using a standard model for broad compatibility
    };
    
    const request = {
        audio: audio,
        config: config,
    };
    
    try {
        console.log("Sending transcription request to Speech-to-Text API (v1)...");
        const [response] = await client.recognize(request);
        
        const transcription = response.results
            ?.map(result => result.alternatives?.[0].transcript)
            .join('\n');
            
        if (!transcription) {
            console.log("Transcription result was empty or audio was not understood.");
            return { transcription: "Could not understand audio. Please try again." };
        }
        
        console.log("Transcription successful:", transcription);
        return { transcription };

    } catch (error: any) {
        console.error('ERROR in speech service (recognize v1):', error);
        return { transcription: "", error: `Speech API Error: ${error.message || "An unknown error occurred."}`};
    }
}

/**
 * Transcribes audio using browser-based speech recognition (Web Speech API)
 * This works in browsers like Chrome, Edge, Safari that support the Web Speech API
 * @param options Options for browser speech recognition
 * @returns The transcription result
 */
export async function transcribeWithBrowser(options: { continuous?: boolean; interimResults?: boolean; language?: string; maxAlternatives?: number } = {}): Promise<{ transcription: string, error?: string, confidence?: number }> {
    try {
        // Browser speech recognition is not available on server-side
        return {
            transcription: '',
            error: 'Browser speech recognition can only be used in the browser, not on the server'
        };
    } catch (error: any) {
        console.error('ERROR in browser speech recognition:', error);
        return {
            transcription: "",
            error: `Browser speech recognition failed: ${error.message || "An unknown error occurred."}`
        };
    }
}
