import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantPath } from '@/lib/tenant';

export type FollowAlertEvent = { id: string; sequence: number; createdAt: string; follower: string; test: boolean };
type State = { sequence: number; events: FollowAlertEvent[]; seen: string[] };
const locks = new Map<string, Promise<unknown>>();
const lastTest = new Map<string, number>();
const validTenant = (id?: string): id is string => Boolean(id && /^[a-zA-Z0-9_-]+$/.test(id));
async function load<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error: any) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
async function save(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify(value)); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
}
export async function getFollowAlertConfig(tenantId: string): Promise<{ enabled: boolean }> {
    if (!validTenant(tenantId)) return { enabled: false };
    return load(tenantPath(tenantId, 'data/follow-alert-config.json'), { enabled: false });
}
export async function publishFollowAlert(input: { tenantId: string; follower: string; messageId: string; test?: boolean }): Promise<boolean> {
    if (!validTenant(input.tenantId) || !input.messageId || !(await getFollowAlertConfig(input.tenantId)).enabled) return false;
    const previous = locks.get(input.tenantId) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
        const file = tenantPath(input.tenantId, 'data/follow-alert-events.json');
        const state = await load<State>(file, { sequence: 0, events: [], seen: [] });
        if (state.seen.includes(input.messageId)) return false;
        const event: FollowAlertEvent = {
            id: input.messageId, sequence: ++state.sequence, createdAt: new Date().toISOString(),
            follower: String(input.follower || 'New friend').slice(0, 100), test: Boolean(input.test),
        };
        state.events.push(event); state.events = state.events.slice(-100);
        state.seen.push(input.messageId); state.seen = state.seen.slice(-500);
        await save(file, state);
        return true;
    });
    locks.set(input.tenantId, task);
    try { return await task; } finally { if (locks.get(input.tenantId) === task) locks.delete(input.tenantId); }
}
export async function readFollowAlerts(tenantId: string, after?: number) {
    if (!validTenant(tenantId)) throw new Error('Invalid tenant');
    const config = await getFollowAlertConfig(tenantId);
    const state = await load<State>(tenantPath(tenantId, 'data/follow-alert-events.json'), { sequence: 0, events: [], seen: [] });
    const recent = Date.now() - 60_000;
    return { enabled: config.enabled, cursor: state.sequence,
        events: after === undefined ? [] : state.events.filter(e => e.sequence > after && Date.parse(e.createdAt) >= recent) };
}
export async function recordFollowOverlayPresence(tenantId: string, status: 'ready' | 'playing' | 'blocked' | 'media-error') {
    if (!validTenant(tenantId)) return;
    await save(tenantPath(tenantId, 'data/follow-alert-player.json'), { status, updatedAt: Date.now() });
}
export async function testFollowAlert(tenantId: string | undefined, follower: string): Promise<string> {
    if (!validTenant(tenantId)) return 'Follow alerts need a connected streamer account.';
    if (!(await getFollowAlertConfig(tenantId)).enabled) return 'Follow alert is not configured for this channel.';
    if (Date.now() - (lastTest.get(tenantId) || 0) < 5000) return 'Wait 5 seconds before testing again.';
    lastTest.set(tenantId, Date.now());
    const emitted = await publishFollowAlert({ tenantId, follower, messageId: 'test-' + randomUUID(), test: true });
    if (!emitted) return 'Follow alert is disabled.';
    const player = await load<any>(tenantPath(tenantId, 'data/follow-alert-player.json'), {});
    const active = Date.now() - Number(player.updatedAt || 0) < 10_000;
    const url = 'https://streamweaver-new.fly.dev/shoutout-player?tenant=' + encodeURIComponent(tenantId);
    let output = active && ['ready', 'playing'].includes(player.status)
        ? '✅ Follow test queued: Step Brothers video + audio.'
        : player.status === 'media-error' && active
        ? 'Follow alert video could not load. Check the Follow Alert media upload.'
        : player.status === 'blocked' && active
        ? 'Follow test queued. Audio is blocked: click Enable audio in the overlay, or enable OBS browser-source audio.'
        : 'Follow test queued. Open the existing Shoutout Player browser source in OBS: ' + url;
    const { getStoredTokens } = await import('@/lib/token-utils.server');
    const tokens = await getStoredTokens(tenantId);
    if (tokens?.broadcasterToken) {
        try {
            const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'Bearer ' + tokens.broadcasterToken } });
            const identity = await response.json();
            if (!response.ok || !identity.scopes?.includes('moderator:read:followers'))
                output += ' Automatic follows need Twitch broadcaster reconnect in Integrations.';
        } catch { output += ' Could not verify automatic-follow permission.'; }
    } else output += ' Automatic follows need Twitch broadcaster reconnect in Integrations.';
    return output;
}
