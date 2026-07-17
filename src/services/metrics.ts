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

const DEFAULT_METRICS: Metrics = {
    totalCommands: 0,
    shoutoutsGiven: 0,
    athenaCommands: 0,
    lurkCommands: 0,
};
const metricsByTenant = new Map<string, Metrics>();

function metricsKey(tenantId?: string): string {
    if (tenantId) return tenantId;
    if (process.env.NODE_ENV === 'production') throw new Error('Metrics require tenant context');
    return '__development_global__';
}

function currentMetrics(tenantId?: string): Metrics {
    const key = metricsKey(tenantId);
    if (!metricsByTenant.has(key)) metricsByTenant.set(key, { ...DEFAULT_METRICS });
    return metricsByTenant.get(key)!;
}

export async function loadMetrics(tenantId?: string): Promise<void> {
    try {
        const data = await fs.readFile(metricsFilePath(tenantId), 'utf-8');
        metricsByTenant.set(metricsKey(tenantId), { ...DEFAULT_METRICS, ...JSON.parse(data) });
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
        await fs.writeFile(filePath, JSON.stringify(currentMetrics(tenantId), null, 2));
    } catch (error) {
        console.error('[Metrics] Error saving:', error);
    }
}

export async function incrementMetric(key: keyof Metrics, amount = 1, tenantId?: string) {
    const metrics = currentMetrics(tenantId);
    metrics[key] = (metrics[key] || 0) + amount;
    await saveMetrics(tenantId);
}

export function getMetrics(tenantId?: string): Metrics {
    return { ...currentMetrics(tenantId) };
}

/**
 * Updates metrics by fetching current data and broadcasting to clients
 */
export async function updateMetrics(tenantId?: string): Promise<void> {
    try {
        // Reload metrics from file in case they were updated externally
        await loadMetrics(tenantId);
        
        // Broadcast updated metrics to connected clients
        if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
                type: 'metrics-update',
                payload: getMetrics(tenantId)
            }, tenantId);
        }
    } catch (error) {
        console.error('[Metrics] Update error:', error);
    }
}
