import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectBotRelayRequest } from '../src/services/bot-relay';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('a named human relay command is parsed before normal AI chat', () => {
  const request = detectBotRelayRequest({
    message: 'Athena tell mamafeisty I sent her a message in Discord for after stream or when she has time',
    speakerName: 'Athena',
    targets: [],
  });

  assert.equal(request.matched, true);
  assert.equal(request.targetName, 'mamafeisty');
  assert.equal(request.relayMessage, 'I sent her a message in Discord for after stream or when she has time');
  assert.equal(request.source, 'parser');
});

test('human-directed Twitch and Discord relays do not depend on botshare', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const discordRoute = read('src/app/api/discord/chat/route.ts');

  assert.match(dispatcher, /if \\(isHumanSpeaker && \\(addressedToResponseBot \\|\\| leadingLoreBot\\)\\)/);
  assert.doesNotMatch(dispatcher, /addressedToResponseBot && relayMode === 'on'/);
  assert.match(dispatcher, /humanDirected: true/);
  assert.match(discordRoute, /humanDirected: humanDirectedRelay/);
  assert.doesNotMatch(
    discordRoute,
    /if \(await getBotShareMode\(botTenantId \|\| tenantId \|\| undefined\) === 'on'\)/,
  );
});

test('autonomous relay delivery still requires both tenants to enable botshare', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');

  assert.match(
    dispatcher,
    /if \(!input\.humanDirected && !\(await isBotRelayAllowed\(input\.speakerTenantId, targetTenantId\)\)\)/,
  );
  assert.match(dispatcher, /getBotShareMode\(sourceTenantId\) !== 'on'/);
  assert.match(dispatcher, /getBotShareMode\(targetTenantId\) === 'on'/);
});

test('relay targets resolve through linked Discord usernames as well as Twitch and bot identities', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');

  assert.match(dispatcher, /const discordConfig = await readDiscordConfig\(tid\)\.catch\(\(\) => null\)/);
  assert.match(dispatcher, /discordUsername === rawTarget/);
});
