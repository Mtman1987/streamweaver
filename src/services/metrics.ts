import * as fs from 'fs/promises';
import { resolve } from 'path';

const METRICS_FILE_PATH = resolve(process.cwd(), 'src', 'data', 'stream-metrics.json');

type Metrics = {
    totalCommands: number;
    shoutoutsGiven: number;
    athenaCommands: number;
    lurkCommands: number;
};

let metrics: Metrics = {
    totalCommands: 0,
    shoutoutsGiven: 0,
    athenaCommands: 0,
    lurkCommands: 0,
};

export async function loadMetrics(): Promise<void> {
    try {
        const data = await fs.readFile(METRICS_FILE_PATH, 'utf-8');
        metrics = JSON.parse(data);
        console.log('[Metrics] Loaded successfully');
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log('[Metrics] No file found, starting fresh');
            await saveMetrics();
        } else {
            console.error('[Metrics] Error loading:', error);
        }
    }
}

export async function saveMetrics(): Promise<void> {
    try {
        await fs.writeFile(METRICS_FILE_PATH, JSON.stringify(metrics, null, 2));
    } catch (error) {
        console.error('[Metrics] Error saving:', error);
    }
}

export async function incrementMetric(key: keyof Metrics, amount = 1) {
    metrics[key] = (metrics[key] || 0) + amount;
    await saveMetrics();
}

export function getMetrics(): Metrics {
    return { ...metrics };
}

/**
 * Updates metrics by fetching current data and broadcasting to clients
 */
export async function updateMetrics(): Promise<void> {
    try {
        // Reload metrics from file in case they were updated externally
        await loadMetrics();
        
        // Broadcast updated metrics to connected clients
        if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
                type: 'metrics-update',
                payload: getMetrics()
            });
        }
    } catch (error) {
        console.error('[Metrics] Update error:', error);
    }
}