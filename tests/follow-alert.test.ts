import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('follow alerts isolate tenants, dedupe delivery, preserve order and skip stale playback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'follow-alert-'));
    process.env.STREAMWEAVER_DATA_DIR = root;
    process.env.PERSIST_ROOT = root;
    const { tenantPath } = await import('../src/lib/tenant');
    const { publishFollowAlert, readFollowAlerts, recordFollowOverlayPresence } = await import('../src/services/follow-alert');
    try {
        const config = tenantPath('1518834930', 'data/follow-alert-config.json');
        await fs.mkdir(path.dirname(config), { recursive: true });
        await fs.writeFile(config, JSON.stringify({ enabled: true }));
        assert.equal(await publishFollowAlert({ tenantId: 'other', follower: 'Bob', messageId: 'one' }), false);
        assert.equal(await publishFollowAlert({ tenantId: '../bad', follower: 'Bob', messageId: 'one' }), false);
        const results = await Promise.all([
            publishFollowAlert({ tenantId: '1518834930', follower: 'Alice', messageId: 'one' }),
            publishFollowAlert({ tenantId: '1518834930', follower: 'Alice', messageId: 'one' }),
            publishFollowAlert({ tenantId: '1518834930', follower: 'Bob', messageId: 'two', test: true }),
        ]);
        assert.deepEqual(results, [true, false, true]);
        const first = await readFollowAlerts('1518834930');
        assert.equal(first.cursor, 2); assert.deepEqual(first.events, []);
        const playback = await readFollowAlerts('1518834930', 0);
        assert.deepEqual(playback.events.map(e => e.follower), ['Alice', 'Bob']);
        assert.equal(playback.events[1].test, true);
        assert.equal((await readFollowAlerts('1518834930', 1)).events.length, 1);
        assert.equal((await readFollowAlerts('other', 0)).events.length, 0);
        await recordFollowOverlayPresence('1518834930', 'blocked');
        const player = JSON.parse(await fs.readFile(tenantPath('1518834930', 'data/follow-alert-player.json'), 'utf8'));
        assert.equal(player.status, 'blocked');
        const file = tenantPath('1518834930', 'data/follow-alert-events.json');
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        saved.events.forEach((e: any) => e.createdAt = '2000-01-01T00:00:00Z');
        await fs.writeFile(file, JSON.stringify(saved));
        assert.equal((await readFollowAlerts('1518834930', 0)).events.length, 0);
        assert.equal(await publishFollowAlert({ tenantId: '1518834930', follower: 'Alice', messageId: 'one' }), false);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
