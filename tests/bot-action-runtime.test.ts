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

test('publishes a persona-neutral suite action catalog', () => {
  assert.equal(BOT_ACTION_CATALOG.length, 20);
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'dsh.calendar.deploy'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'dsh.applications.deploy'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'dsh.applications.decide'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'hmo.bot.control'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'hmo.voice.bridge.control'));
  assert.ok(BOT_ACTION_CATALOG.some((entry) => entry.id === 'sw.image.generate'));
  assert.equal(BOT_ACTION_CATALOG.find((entry) => entry.id === 'hmo.bot.control')?.minimumRole, 'member');
  assert.equal(BOT_ACTION_CATALOG.find((entry) => entry.id === 'hmo.voice.bridge.control')?.minimumRole, 'member');
  assert.equal(JSON.stringify(BOT_ACTION_CATALOG).includes('Athena'), false);
  assert.equal(JSON.stringify(BOT_ACTION_CATALOG).includes('Moonbeam'), false);
});

test('detects remaining button-equivalent actions before conversational AI', async () => {
  assert.deepEqual(await detectBotAction("approve Jordan's moderator application"), {
    action: 'dsh.applications.decide',
    args: { decision: 'approved', type: 'mod', application: 'Jordan' },
    detection: 'explicit',
  });
  assert.deepEqual(await detectBotAction('post a DSH shoutout for @creator in #shoutouts'), {
    action: 'dsh.shoutouts.post',
    args: { target: 'creator', channel: 'shoutouts' },
    detection: 'explicit',
  });
  assert.deepEqual(await detectBotAction('tell Moonbeam to join my Hear Me Out chat'), {
    action: 'hmo.bot.control',
    args: { control: 'join', bot: 'Moonbeam', room: '' },
    detection: 'explicit',
  });
  assert.deepEqual(await detectBotAction('bridge HearMeOut to Discord VC General'), {
    action: 'hmo.voice.bridge.control',
    args: { control: 'start', audioProfile: '', voiceChannel: 'General', room: '' },
    detection: 'explicit',
  });
  assert.deepEqual(await detectBotAction('generate an image of a rocket flying past Saturn'), {
    action: 'sw.image.generate',
    args: { prompt: 'a rocket flying past Saturn' },
    detection: 'explicit',
  });
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

test('invites the resolved tenant persona through the HearMeOut action adapter', async () => {
  const calls: any[] = [];
  const request = await detectBotAction('tell Moonbeam to join my HearMeOut chat');
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'discord',
    visibility: 'private',
    message: 'tell Moonbeam to join my HearMeOut chat',
    actor: { userId: 'discord-mama', username: 'mamafeisty', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({ guildId: 'guild-mama' }) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    resolveBotPersonaForAction: async (selector, tenantId) => ({
      id: tenantId,
      name: selector,
      ownerName: 'mamafeisty',
      ownerTenantId: tenantId,
      aliases: [], wakeNames: [selector], interests: [], voice: '', livekitTtsDescriptor: '',
      avatar: '', idleAvatar: '', talkingAvatar: '', canInvite: true,
    }),
    executeHearMeOutBotAction: async (payload) => {
      calls.push(payload);
      return { success: true, control: 'join', room: { id: 'mama-room', name: 'Mama Room' }, bot: payload.bot };
    },
  });
  assert.equal(outcome.status, 'completed');
  assert.match(outcome.response, /Moonbeam joined Mama Room/);
  assert.equal(calls[0].tenantId, 'mamafeisty');
  assert.equal(calls[0].actorRole, 'owner');
  assert.equal(calls[0].bot.ownerTenantId, 'mamafeisty');
});

test('my bot resolves to the active tenant persona while an unspecified bot asks for a name', async () => {
  const ownBot = await detectBotAction('tell my bot to join my HearMeOut chat');
  let resolvedSelector = '';
  const outcome = await executeBotAction(ownBot!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'discord',
    message: 'tell my bot to join my HearMeOut chat',
    actor: { userId: 'discord-mama', username: 'mamafeisty', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({ guildId: 'guild-mama' }) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    resolveBotPersonaForAction: async (selector, tenantId) => {
      resolvedSelector = selector;
      return {
        id: tenantId, name: selector, ownerName: 'mamafeisty', ownerTenantId: tenantId,
        aliases: [], wakeNames: [selector], interests: [], voice: '', livekitTtsDescriptor: '',
        avatar: '', idleAvatar: '', talkingAvatar: '', canInvite: true,
      };
    },
    executeHearMeOutBotAction: async (payload) => ({
      success: true, control: 'join', room: { id: 'studio', name: 'Studio' }, bot: payload.bot,
    }),
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(resolvedSelector, 'Moonbeam');

  const ambiguous = await detectBotAction('tell a bot to join my HearMeOut chat');
  const needsName = await executeBotAction(ambiguous!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'discord',
    message: 'tell a bot to join my HearMeOut chat',
    actor: { userId: 'discord-mama', username: 'mamafeisty', role: 'owner' },
  });
  assert.equal(needsName.status, 'needs_input');
  assert.match(needsName.response, /Name the tenant bot/i);
});

test('routes voice bridge controls with the tenant Discord guild', async () => {
  const calls: any[] = [];
  const request = await detectBotAction('bridge HearMeOut to Discord VC General');
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'mountainview',
    visibility: 'private',
    message: 'bridge HearMeOut to Discord VC General',
    actor: { userId: 'discord-mama', username: 'mamafeisty', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({ guildId: 'guild-mama' }) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    executeHearMeOutBotAction: async (payload) => {
      calls.push(payload);
      return { success: true, control: 'start', room: { name: 'Mama Room' }, channel: { name: 'General' } };
    },
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(calls[0].guildId, 'guild-mama');
  assert.equal(calls[0].voiceChannel, 'General');
});

test('generates images through StreamWeaver while honoring public tenant access', async () => {
  let generated = false;
  const request = await detectBotAction('generate an image of a blue moon over a mountain');
  const outcome = await executeBotAction(request!, {
    tenantId: 'mamafeisty',
    botName: 'Moonbeam',
    source: 'kick',
    visibility: 'public',
    message: 'generate an image of a blue moon over a mountain',
    actor: { username: 'viewer', role: 'member' },
  }, {
    readDiscordConfig: async () => ({}) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    executeHearMeOutBotAction: async () => { throw new Error('wrong adapter'); },
    readGenerationSettings: async () => ({ publicImageAccess: 'everyone' }) as any,
    runImageCommand: async () => ({
      prompt: 'a blue moon over a mountain', originalPrompt: 'a blue moon over a mountain', optimizedPrompt: null,
      provider: 'test', images: ['https://example.com/moon.png'],
    }),
  });
  generated = outcome.status === 'completed';
  assert.equal(generated, true);
  assert.match(outcome.response, /moon\.png/);
});

test('application decisions remain owner-only and call the DSH adapter', async () => {
  const request = await detectBotAction("approve Jordan's moderator application");
  let payload: any;
  const outcome = await executeBotAction(request!, {
    tenantId: 'mt', botName: 'Athena', source: 'discord', message: 'approve application',
    actor: { userId: 'owner-id', username: 'mtman1987', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({ guildId: 'guild', discordUserId: 'owner-id' }) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async (value) => {
      payload = value;
      return { success: true, application: { username: 'Jordan', type: 'mod', status: 'approved' }, notification: { success: true } };
    },
    executeHearMeOutBotAction: async () => { throw new Error('wrong adapter'); },
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(payload.application, 'Jordan');
  assert.equal(payload.decision, 'approved');
});

test('MountainView grants privileged actions only with enforced scoped-secret authentication', () => {
  const route = readFileSync(fileURLToPath(new URL('../src/app/api/mountainview/voice-commander/route.ts', import.meta.url)), 'utf8');
  const authIndex = route.indexOf('hasMountainViewBridgeAccess(request)');
  const actionIndex = route.indexOf('const botAction = await routeBotAction');
  assert.ok(authIndex >= 0 && actionIndex > authIndex);
  assert.match(route, /role: isMountainViewBridgeSecretEnforced\(\) \? 'owner' : 'member'/);
});


test('plays the requested Prof song in the authenticated companion session without a room', async () => {
  const request = await detectBotAction('play squad goals by prof');
  assert.equal(request?.action, 'hmo.media.request');
  assert.equal(request?.args.query, 'squad goals by prof');
  const calls: any[] = [];
  const outcome = await executeBotAction(request!, {
    tenantId: 'owner', botName: 'Athena', source: 'mountainview',
    visibility: 'private', playbackSessionId: 'watch-companion-owned-session',
    message: 'play squad goals by prof', actor: { userId: 'owner', username: 'owner', role: 'owner' },
  }, {
    readDiscordConfig: async () => ({}) as any,
    getDiscordStreamHubDefaultGuildId: async () => 'unused',
    executeDiscordStreamHubBotAction: async () => { throw new Error('wrong adapter'); },
    executeHearMeOutBotAction: async payload => { calls.push(payload); return { success: true, message: 'Queued Squad Goals' }; },
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 'watch-companion-owned-session');
  assert.equal(calls[0].roomId, undefined);
});
