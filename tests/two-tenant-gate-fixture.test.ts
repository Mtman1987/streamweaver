import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

test('Gate 1 two-tenant fixture isolates chat, replies, botshare, TTS, voice, overlays, workflows, and reconnect', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-gate1-two-tenant-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.BOT_SECRET_KEY;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.BOT_SECRET_KEY = 'gate-fixture-secret';

  try {
    const [
      privateChat,
      publicChat,
      botShare,
      botSettings,
      overlay,
      workflowBuilder,
      actionsStore,
      commandsStore,
      ttsCurrent,
      routing,
      websocketTenant,
    ] = await Promise.all([
      import('../src/lib/private-chat-store'),
      import('../src/lib/public-chat-store'),
      import('../src/lib/bot-interactions-store'),
      import('../src/lib/bot-settings-store'),
      import('../src/services/overlay-manager'),
      import('../src/services/automation/ai-workflow-builder'),
      import('../src/lib/actions-store'),
      import('../src/lib/commands-store'),
      import('../src/app/api/tts/current/route'),
      import('../src/services/tenant-chat-routing'),
      import('../src/server/websocket-tenant'),
    ]);

    await privateChat.appendPrivateChatMessages([{ type: 'user', username: 'a', message: 'private-a', timestamp: 'now' }], 20, 'tenant-a');
    await privateChat.appendPrivateChatMessages([{ type: 'user', username: 'b', message: 'private-b', timestamp: 'now' }], 20, 'tenant-b');
    await publicChat.appendPublicChatMessages([{ type: 'user', username: 'a', message: 'public-a', timestamp: 'now' }], 20, 'tenant-a');
    await publicChat.appendPublicChatMessages([{ type: 'user', username: 'b', message: 'public-b', timestamp: 'now' }], 20, 'tenant-b');
    assert.deepEqual((await privateChat.readPrivateChatMessages(undefined, 'tenant-a')).map((entry) => entry.message), ['private-a']);
    assert.deepEqual((await privateChat.readPrivateChatMessages(undefined, 'tenant-b')).map((entry) => entry.message), ['private-b']);
    assert.deepEqual((await publicChat.readPublicChatMessages(undefined, 'tenant-a')).map((entry) => entry.message), ['public-a']);
    assert.deepEqual((await publicChat.readPublicChatMessages(undefined, 'tenant-b')).map((entry) => entry.message), ['public-b']);

    assert.equal(routing.pickTwitchReplyChannel({ sourceChannel: '#tenant-a', sourceTenantId: 'tenant-a', responseTenantId: 'tenant-b' }), 'tenant-a');
    await botShare.setBotShareMode('on', 'tenant-a');
    assert.equal(await botShare.getBotShareMode('tenant-a'), 'on');
    assert.equal(await botShare.getBotShareMode('tenant-b'), 'off');

    botSettings.setBotSettings('tenant-a', { voice: 'edenai:google:FEMALE' });
    botSettings.setBotSettings('tenant-b', { voice: 'edenai:google:MALE' });
    assert.notEqual(botSettings.getBotVoice('tenant-a'), botSettings.getBotVoice('tenant-b'));

    await overlay.writeOverlayData('notification', { text: 'overlay-a' }, 'tenant-a');
    await overlay.writeOverlayData('notification', { text: 'overlay-b' }, 'tenant-b');
    assert.equal((await overlay.getOverlayData('notification', 'tenant-a')).text, 'overlay-a');
    assert.equal((await overlay.getOverlayData('notification', 'tenant-b')).text, 'overlay-b');

    const workflowA = await workflowBuilder.createWorkflowFromPrompt({ message: 'give viewers a random fortune', tenantId: 'tenant-a', userName: 'a' });
    const workflowB = await workflowBuilder.createWorkflowFromPrompt({ message: 'give viewers a random fortune', tenantId: 'tenant-b', userName: 'b' });
    assert.equal((await actionsStore.getAllActions('tenant-a')).some((entry) => entry.id === workflowA.action.id), true);
    assert.equal((await actionsStore.getAllActions('tenant-a')).some((entry) => entry.id === workflowB.action.id), false);
    assert.equal((await commandsStore.getAllCommands('tenant-b')).some((entry) => entry.id === workflowB.command?.id), true);
    assert.equal((await commandsStore.getAllCommands('tenant-b')).some((entry) => entry.id === workflowA.command?.id), false);

    const headers = { Authorization: 'Bearer gate-fixture-secret', 'Content-Type': 'application/json' };
    await ttsCurrent.POST(new NextRequest('http://localhost/api/tts/current?tenant=tenant-a', { method: 'POST', headers, body: JSON.stringify({ audioUrl: 'https://example.test/a.mp3' }) }));
    await ttsCurrent.POST(new NextRequest('http://localhost/api/tts/current?tenant=tenant-b', { method: 'POST', headers, body: JSON.stringify({ audioUrl: 'https://example.test/b.mp3' }) }));
    const ttsA = await (await ttsCurrent.GET(new NextRequest('http://localhost/api/tts/current?tenant=tenant-a&next=1'))).json();
    const ttsB = await (await ttsCurrent.GET(new NextRequest('http://localhost/api/tts/current?tenant=tenant-b&next=1'))).json();
    assert.equal(ttsA.audioUrl, 'https://example.test/a.mp3');
    assert.equal(ttsB.audioUrl, 'https://example.test/b.mp3');

    assert.deepEqual(websocketTenant.resolveTenantSocketAction('', 'reconnect-twitch'), { ok: false, error: 'Missing tenant context for reconnect-twitch' });
    assert.deepEqual(websocketTenant.resolveTenantSocketAction('tenant-a', 'reconnect-twitch'), { ok: true, tenantId: 'tenant-a' });
    assert.deepEqual(websocketTenant.resolveTenantSocketAction('tenant-b', 'reconnect-twitch'), { ok: true, tenantId: 'tenant-b' });
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.BOT_SECRET_KEY; else process.env.BOT_SECRET_KEY = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
