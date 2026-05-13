import * as fs from 'fs/promises';
import { resolve } from 'path';
import { tenantPath } from '../lib/tenant';

function metricsFilePath(tenantId?: string): string {
    if (tenantId) return tenantPath(tenantId, 'data/stream-metrics.json');
    return resolve(process.env.PERSIST_ROOT || resolve(process.cwd(), 'data', 'runtime'), 'global', 'stream-metrics.json');
}

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

export async function loadMetrics(tenantId?: string): Promise<void> {
    try {
        const data = await fs.readFile(metricsFilePath(tenantId), 'utf-8');
        metrics = JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log('[Metrics] No file found, starting fresh');
            await saveMetrics(tenantId);
        } else {
            console.error('[Metrics] Error loading:', error);
        }
    }
}

export async function saveMetrics(tenantId?: string): Promise<void> {
    try {
        const filePath = metricsFilePath(tenantId);
        const { mkdir } = await import('fs/promises');
        const { dirname } = await import('path');
        await mkdir(dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(metrics, null, 2));
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