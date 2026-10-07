import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'streamweaver-wake-'));
process.env.PERSIST_ROOT = runtime;
let wake: typeof import('../src/services/shared-bot-wake');
let settings: typeof import('../src/lib/bot-settings-store');
let defaults: typeof import('../src/lib/bot-personality-defaults');
test.before(async () => {
  wake = await import('../src/services/shared-bot-wake');
  settings = await import('../src/lib/bot-settings-store');
  defaults = await import('../src/lib/bot-personality-defaults');
});

test.after(() => fs.rmSync(runtime, { recursive: true, force: true }));

test('exact deterministic wake commands never absorb game/chat text', () => {
  for (const text of ['spmt wake', '!wake', 'SPMT WAKE ON', '!spmt wake on', '@spmt wake on']) {
    assert.equal(wake.parseBotWakeCommand(text), 'on');
  }
  assert.equal(wake.parseBotWakeCommand('!wake off'), 'off');
  assert.equal(wake.parseBotWakeCommand('spmt wake status'), 'status');
  assert.equal(wake.parseBotWakeCommand('spmt wake maybe'), 'usage');
  for (const text of ['spmt wordchain start', 'hey wake up', 'spmt wakeful', 'Stella wake up']) {
    assert.equal(wake.parseBotWakeCommand(text), null);
  }
});

test('wake setting defaults off, persists, and cannot change another tenant', async () => {
  assert.equal(wake.isSharedBotAwake('captain-a'), false);
  await wake.setSharedBotAwake('captain-a', true);
  assert.equal(wake.isSharedBotAwake('captain-a'), true);
  assert.equal(wake.isSharedBotAwake('captain-b'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'tenants/captain-a/data/shared-bot-wake.json'), 'utf8')).enabled, true);
  await wake.setSharedBotAwake('captain-a', false);
  assert.equal(wake.isSharedBotAwake('captain-a'), false);
  await assert.rejects(() => wake.setSharedBotAwake('../captain-b', true));
});

test('wake policy permits only the opted-in registered source channel', () => {
  const input = { channel: '#captain_a', communityBotLogin: 'streamweaverbot', tenantId: 'a',
    registeredChannel: 'captain_a', mappedTenantId: 'a', awake: true };
  assert.equal(wake.sharedBotChannelAllowed(input), true);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, awake: false }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, channel: 'captain_b' }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, mappedTenantId: 'b' }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, tenantId: undefined }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, registeredChannel: undefined }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, channel: 'unregistered_signal_carrier' }), false);
  assert.equal(wake.sharedBotChannelAllowed({ ...input, channel: '#streamweaverbot', awake: false }), true);
});

test('owner/mod commands persist before acknowledgments; status never toggles', async () => {
  const sent: boolean[] = [];
  const deps = { read: wake.isSharedBotAwake, write: wake.setSharedBotAwake,
    acknowledge: async (tid: string) => { sent.push(wake.isSharedBotAwake(tid)); } };
  const actor = { tenantId: 'a', channel: 'captain_a', username: 'captain_a',
    moderator: false, mirrored: false, botAuthored: false };
  await wake.handleBotWakeCommand({ ...actor, message: 'spmt wake on' }, deps);
  await wake.handleBotWakeCommand({ ...actor, message: 'spmt wake status' }, deps);
  await wake.handleBotWakeCommand({ ...actor, username: 'channel_mod', moderator: true, message: '!wake off' }, deps);
  assert.deepEqual(sent, [true, true, false]);
  assert.equal(wake.isSharedBotAwake('a'), false);
});

test('viewers, mirrored mod badges, synthetic bot commands, and carriers cannot wake', async () => {
  let writes = 0; let sends = 0;
  const deps = { read: () => false, write: async () => { writes++; }, acknowledge: async () => { sends++; } };
  const base = { message: 'spmt wake on', tenantId: 'a', channel: 'captain_a', username: 'viewer',
    moderator: false, mirrored: false, botAuthored: false };
  for (const actor of [base, { ...base, moderator: true, mirrored: true },
    { ...base, username: 'captain_a', botAuthored: true }, { ...base, tenantId: undefined, moderator: true }]) {
    assert.equal(await wake.handleBotWakeCommand(actor, deps), true);
  }
  assert.equal(writes, 0); assert.equal(sends, 0);
});

test('transport failure never rolls wake on/off back or pretends to acknowledge', async () => {
  const input = { message: 'spmt wake off', tenantId: 'c', channel: 'captain_c', username: 'captain_c',
    moderator: false, mirrored: false, botAuthored: false };
  await wake.setSharedBotAwake('c', true);
  await assert.rejects(wake.handleBotWakeCommand(input, { read: wake.isSharedBotAwake, write: wake.setSharedBotAwake,
    acknowledge: async () => { throw new Error('Twitch transport not connected'); } }), /not connected/);
  assert.equal(wake.isSharedBotAwake('c'), false);
});

test('shared account uses each captain saved persona, defaults only when unset; personal bot stays preferred', () => {
  const configDir = path.join(runtime, 'tenants/persona-a/tokens');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'user-config.json'), JSON.stringify({
    AI_BOT_PERSONALITY: 'Dry, curious captain A persona', AI_BOT_NAME: 'Nova', AI_BOT_ALIASES: 'novi',
  }));
  assert.equal(settings.getBotPersonality('persona-a'), 'Dry, curious captain A persona');
  assert.equal(settings.getBotPersonality('persona-b'), defaults.COMMUNITY_BOT_PERSONALITY);
  assert.equal(settings.getBotName('persona-a'), defaults.COMMUNITY_BOT_NAME);
  const configured = settings.getBotSettings('persona-a');
  assert.equal(settings.applyBotTransportIdentity(configured, true).name, 'Nova');
  assert.equal(settings.applyBotTransportIdentity(configured, true).personality, configured.personality);
});
