'use server';

import { SpeechClient } from '@google-cloud/speech';
import { getBrokerAuthHeaders, getBrokerBaseUrl, joinBrokerUrl } from '@/lib/broker';
import { readUserConfigSync } from '@/lib/user-config';

let speechClient: SpeechClient | null = null;
let warnedMissingGoogleCreds = false;

const EDEN_STT_ENDPOINT = 'https://api.edenai.run/v2/audio/speech_to_text_async';
const EDEN_STT_PROVIDER = 'openai';
const EDEN_STT_POLL_MS = 500;
const EDEN_STT_MAX_POLLS = 40;

type ServiceAccountJson = {
    project_id?: string;
    client_email?: string;
    private_key?: string;
};

type TranscriptionResult = {
    transcription: string;
    error?: string;
    provider?: string;
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

function resolveEdenApiKey(): string {
    const config = readUserConfigSync();
    return String(config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '').trim();
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

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function edenProviderResult(payload: any): any {
    return payload?.results?.[EDEN_STT_PROVIDER]
        || payload?.result?.[EDEN_STT_PROVIDER]
        || payload?.[EDEN_STT_PROVIDER]
        || null;
}

function extractEdenTranscription(payload: any): string {
    const provider = edenProviderResult(payload);
    const candidates = [
        provider?.transcription,
        provider?.text,
        provider?.result?.transcription,
        provider?.result?.text,
        payload?.output?.text,
        payload?.output?.transcription,
        payload?.data?.transcription,
        payload?.transcription,
        payload?.text,
    ];
    for (const candidate of candidates) {
        const value = cleanText(candidate);
        if (value) return value;
    }
    return '';
}

function edenError(payload: any): string {
    const provider = edenProviderResult(payload);
    const candidate = provider?.error
        || provider?.error_message
        || payload?.error?.message
        || payload?.error
        || payload?.message;
    if (typeof candidate === 'string') return candidate.trim();
    if (candidate && typeof candidate === 'object') {
        try { return JSON.stringify(candidate); } catch {}
    }
    return '';
}

async function transcribeWithEden(base64Audio: string, apiKey: string): Promise<string> {
    const bytes = Buffer.from(base64Audio, 'base64');
    if (!bytes.length) throw new Error('Eden AI STT received empty audio');

    const form = new FormData();
    form.append('providers', EDEN_STT_PROVIDER);
    form.append('language', 'en-US');
    form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }),
        'hearmeout-utterance.webm',
    );

    const submitted = await fetch(EDEN_STT_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15_000) : undefined,
    });
    const submitPayload = await submitted.json().catch(() => ({})) as any;
    if (!submitted.ok) {
        throw new Error(edenError(submitPayload) || `Eden AI STT submit failed (HTTP ${submitted.status})`);
    }

    const immediate = extractEdenTranscription(submitPayload);
    if (immediate) return immediate;

    const publicId = cleanText(submitPayload?.public_id || submitPayload?.data?.public_id);
    if (!publicId) {
        throw new Error(edenError(submitPayload) || 'Eden AI STT did not return a job id');
    }

    for (let attempt = 0; attempt < EDEN_STT_MAX_POLLS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, EDEN_STT_POLL_MS));
        const response = await fetch(
            `${EDEN_STT_ENDPOINT}/${encodeURIComponent(publicId)}?response_as_dict=true&show_original_response=false`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
                cache: 'no-store',
                signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined,
            },
        );
        const payload = await response.json().catch(() => ({})) as any;
        if (!response.ok) {
            throw new Error(edenError(payload) || `Eden AI STT poll failed (HTTP ${response.status})`);
        }

        const transcription = extractEdenTranscription(payload);
        if (transcription) return transcription;

        const status = cleanText(payload?.status || payload?.state).toLowerCase();
        if (['fail', 'failed', 'error'].includes(status)) {
            throw new Error(edenError(payload) || `Eden AI STT job ${status}`);
        }
        if (['finished', 'completed', 'success', 'succeeded'].includes(status)) {
            throw new Error(edenError(payload) || 'Eden AI STT completed without a transcription');
        }
    }

    throw new Error('Eden AI STT timed out waiting for transcription');
}

/**
 * Transcribes a base64 encoded WebM/Opus audio string.
 * HearMeOut uses Eden AI first because its production credential is already
 * shared with the working Say TTS path. Broker and Google remain fallbacks.
 */
export async function transcribeAudio(base64Audio: string): Promise<TranscriptionResult> {
    const failures: string[] = [];
    const edenApiKey = resolveEdenApiKey();

    if (edenApiKey) {
        try {
            const transcription = await transcribeWithEden(base64Audio, edenApiKey);
            if (transcription) {
                console.log('[STT] Eden AI/OpenAI transcription successful');
                return { transcription, provider: 'edenai-openai' };
            }
        } catch (error: any) {
            const message = error?.message || String(error);
            failures.push(`Eden AI: ${message}`);
            console.warn('[STT] Eden AI/OpenAI transcription failed:', message);
        }
    }

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
                signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12_000) : undefined,
            });

            const data = await upstream.json().catch(() => null) as any;
            if (upstream.ok) {
                const transcription = cleanText(data?.transcription || data?.data?.transcription);
                if (transcription) return { transcription, provider: 'broker' };
                failures.push(`Broker: ${cleanText(data?.error) || 'empty transcription'}`);
            } else {
                failures.push(`Broker: ${cleanText(data?.error) || `HTTP ${upstream.status}`}`);
            }
        } catch (error: any) {
            failures.push(`Broker: ${error?.message || String(error)}`);
        }
    }

    const serviceAccount = getServiceAccountFromEnv();
    const projectId = serviceAccount?.project_id;
    const hasAdcPath = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!projectId && !hasAdcPath) {
        if (!warnedMissingGoogleCreds) {
            warnedMissingGoogleCreds = true;
            console.warn(
                'Google credentials not configured; HearMeOut will use Eden AI when EDENAI_API_KEY is available.'
            );
        }
        const detail = failures.length
            ? failures.join(' | ')
            : 'No Eden AI, broker, or Google speech-to-text provider is configured.';
        return { transcription: '', error: detail };
    }

    const client = getSpeechClient();
    const request = {
        audio: { content: base64Audio },
        config: {
            encoding: 'WEBM_OPUS' as const,
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            model: 'default',
        },
    };

    try {
        console.log('Sending transcription request to Google Speech-to-Text API (v1)...');
        const [response] = await client.recognize(request);
        const transcription = response.results
            ?.map(result => result.alternatives?.[0].transcript)
            .join('\n')
            .trim();

        if (!transcription) {
            failures.push('Google: audio was not understood');
            return { transcription: '', error: failures.join(' | ') };
        }

        console.log('Google transcription successful:', transcription);
        return { transcription, provider: 'google' };
    } catch (error: any) {
        failures.push(`Google: ${error.message || 'unknown error'}`);
        console.error('ERROR in Google speech service (recognize v1):', error);
        return { transcription: '', error: failures.join(' | ') };
    }
}

/**
 * Browser speech recognition is intentionally not used for HearMeOut persona
 * hearing; personas consume the published LiveKit room audio on the worker.
 */
export async function transcribeWithBrowser(options: { continuous?: boolean; interimResults?: boolean; language?: string; maxAlternatives?: number } = {}): Promise<{ transcription: string; error?: string; confidence?: number }> {
    void options;
    return {
        transcription: '',
        error: 'Browser speech recognition can only be used in the browser, not on the server',
    };
}
