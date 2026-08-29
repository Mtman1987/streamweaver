import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BOT_ACTION_CATALOG,
  detectBotAction,
  executeBotAction,
  type BotActionContext,
  type BotActionRuntimeDependencies,
} from '../src/services/bot-action-runtime';

test('publishes a persona-neutral DSH action catalog', () => {
  assert.equal(BOT_ACTION_CATALOG.length, 13);
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'dsh.calendar.deploy'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'dsh.applications.deploy'));
  assert.equal(JSON.stringify(BOT_ACTION_CATALOG).includes('Athena'), false);
  assert.equal(JSON.stringify(BOT_ACTION_CATALOG).includes('Moonbeam'), false);
});

test('detects button-equivalent broadcasts only from explicit language', async () => {
  assert.deepEqual(await detectBotAction('Moonbeam deploy the admin calendar to #storage'), {
    action: 'dsh.calendar.deploy',
    args: { channel: 'storage' },
    detection: 'explicit',
  });
  assert.deepEqual(await detectBotAction('Moonbeam, deploy the mod and partner applications to #applications'), {
    action: 'dsh.applications.deploy',
    args: { channel: 'applications' },
    detection: 'explicit',
  });
});

test('parses a real Admin Calendar event before conversational AI can answer it', async () => {
  const request = await detectBotAction(
    'Moonbeam add an event to Discord Stream Hubs Admin Calendar with title "record help video" for 3 AM UTC Tuesday September 1st 2026',
  );
  assert.equal(request?.action, 'dsh.calendar.event.create');
  assert.deepEqual(request?.args, {
    missionName: 'record help video',
    missionDescription: '',
    missionDate: '2026-09-01',
    missionTime: '03:00',
    missionTimeZone: 'UTC',
  });
});

test('asks for missing write arguments instead of inventing success', async () => {
  const request = await detectBotAction("Moonbeam put me on Captain's Log");
  assert.ok(request);
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'twitch',
    message: "Moonbeam put me on Captain's Log",
    actor: { username: 'mamafeisty', role: 'owner' },
  });
  assert.equal(outcome.status, 'needs_input');
  assert.match(outcome.response, /date/i);
});

test('executes Moonbeam actions with mamafeisty tenant configuration', async () => {
  const calls: any[] = [];
  const dependencies: BotActionRuntimeDependencies = {
    readDiscordConfig: async (tenantId?: string) => {
      assert.equal(tenantId, 'mamafeisty');
      return { guildId: 'guild-mama', discordUserId: 'discord-mama' } as any;
    },
    getDiscordStreamHubDefaultGuildId: async () => {
      throw new Error('tenant guild should win');
    },
    executeDiscordStreamHubBotAction: async (payload) => {
      calls.push(payload);
      return { success: true, channel: { id: 'channel-storage', name: 'storage' } };
    },
    executeHearMeOutBotAction: async () => {
      throw new Error('wrong adapter');
    },
  };
  const context: BotActionContext = {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'twitch',
    message: 'Moonbeam deploy the admin calendar to #storage',
    requestId: 'twitch:message-1',
    actor: { userId: 'twitch-mama', username: 'mamafeisty', displayName: 'mamafeisty', role: 'owner' },
  };

  const outcome = await executeBotAction({
    action: 'dsh.calendar.deploy',
    args: { channel: 'storage' },
    detection: 'explicit',
  }, context, dependencies);

  assert.equal(outcome.status, 'completed');
  assert.match(outcome.response, /#storage/);
  assert.deepEqual(calls, [{
    action: 'dsh.calendar.deploy',
    serverId: 'guild-mama',
    actorUserId: 'discord-mama',
    channel: 'storage',
    selectedDate: undefined,
    missionName: undefined,
    missionDescription: 'Added by mamafeisty through twitch.',
    missionDate: undefined,
    missionTime: undefined,
    missionTimeZone: undefined,
    status: undefined,
    type: undefined,
    idempotencyKey: 'twitch:message-1',
  }]);
});

test('does not grant owner broadcasts through another tenant persona', async () => {
  let executed = false;
  const outcome = await executeBotAction({
    action: 'dsh.applications.deploy',
    args: { channel: 'storage' },
    detection: 'explicit',
  }, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'twitch',
    message: 'Moonbeam deploy the applications to #storage',
    actor: { username: 'visitor', role: 'member' },
  }, {
    readDiscordConfig: async () => ({}) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'guild',
    executeDiscordStreamHubBotAction: async () => {
      executed = true;
      return { success: true };
    },
    executeHearMeOutBotAction: async () => {
      executed = true;
      return { success: true };
    },
  });
  assert.equal(outcome.status, 'forbidden');
  assert.equal(executed, false);
});

test('AI fallback is limited to read-only actions', async () => {
  const read = await detectBotAction(
    'Moonbeam, could you check the DSH data and tell me which shoutout people are active?',
    'mamafeisty',
    async () => 'dsh.shoutouts.active.read',
  );
  assert.equal(read?.action, 'dsh.shoutouts.active.read');

  const refusedWrite = await detectBotAction(
    'Moonbeam, could you check the DSH calendar and maybe publish it?',
    'mamafeisty',
    async () => 'dsh.calendar.deploy',
  );
  assert.equal(refusedWrite?.action, 'dsh.calendar.read');
  assert.notEqual(refusedWrite?.action, 'dsh.calendar.deploy');
});

test('routes song and story requests to the tenant-scoped HearMeOut adapter', async () => {
  const request = await detectBotAction('Moonbeam play the story "The Tell-Tale Heart" in HearMeOut');
  assert.deepEqual(request, {
    action: 'hmo.media.request',
    args: { query: 'The Tell-Tale Heart' },
    detection: 'explicit',
  });

  const calls: any[] = [];
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'hearmeout',
    roomId: 'mama-room',
    message: 'Moonbeam play the story "The Tell-Tale Heart" in HearMeOut',
    requestId: 'hmo:message-1',
    actor: { userId: 'mama-user', username: 'mamafeisty', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({}) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    executeHearMeOutBotAction: async (payload) => {
      calls.push(payload);
      return { success: true, message: 'Queued up: "The Tell-Tale Heart"' };
    },
  });

  assert.equal(outcome.status, 'completed');
  assert.match(outcome.response, /Tell-Tale Heart/);
  assert.deepEqual(calls, [{
    action: 'hmo.media.request',
    tenantId: 'mamafeisty',
    roomId: 'mama-room',
    actorUserId: 'mama-user',
    actorName: 'mamafeisty',
    query: 'The Tell-Tale Heart',
    control: undefined,
    value: undefined,
    idempotencyKey: 'hmo:message-1',
  }]);
});

test('does not pretend a generic play request succeeded without a title', async () => {
  const request = await detectBotAction('Moonbeam play a story in HearMeOut');
  assert.equal(request?.action, 'hmo.media.request');
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'kick',
    message: 'Moonbeam play a story in HearMeOut',
    actor: { username: 'mamafeisty', role: 'owner' },
  });
  assert.equal(outcome.status, 'needs_input');
  assert.match(outcome.response, /which song, story/i);
});

test('outside-room media requests never leak into the global HearMeOut queue', async () => {
  const request = await detectBotAction('Moonbeam play "Space Oddity" in HearMeOut');
  let executed = false;
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'discord',
    message: 'Moonbeam play "Space Oddity" in HearMeOut',
    actor: { username: 'mamafeisty', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({}) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    executeHearMeOutBotAction: async () => {
      executed = true;
      return { success: true };
    },
  });
  assert.equal(outcome.status, 'needs_input');
  assert.equal(executed, false);
  assert.match(outcome.response, /did not put this in a public HearMeOut queue/);
});

test('MountainView grants privileged actions only with enforced scoped-secret authentication', () => {
  const route = readFileSync(fileURLToPath(new URL('../src/app/api/mountainview/voice-commander/route.ts', import.meta.url)), 'utf8');
  const authIndex = route.indexOf('hasMountainViewBridgeAccess(request)');
  const actionIndex = route.indexOf('const botAction = await routeBotAction');
  assert.ok(authIndex >= 0 && actionIndex > authIndex);
  assert.match(route, /role: isMountainViewBridgeSecretEnforced\(\) \? 'owner' : 'member'/);
});
