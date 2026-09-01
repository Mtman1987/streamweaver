import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectBotRelayRequest } from '../src/services/bot-relay';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [relative.replaceAll('\\', '/')] : [];
  });
}

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

  assert.match(dispatcher, /if \(isHumanSpeaker && \(addressedToResponseBot \|\| leadingLoreBot\)\)/);
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
    /!input\.humanDirected[\s\S]{0,180}isBotRelayAllowed\(input\.speakerTenantId, targetTenantId\)/,
  );
  assert.match(dispatcher, /getBotShareMode\(sourceTenantId\) !== 'on'/);
  assert.match(dispatcher, /getBotShareMode\(targetTenantId\) === 'on'/);
});

test('relay targets resolve through linked Discord usernames as well as Twitch and bot identities', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');

  assert.match(dispatcher, /const discordConfig = await readDiscordConfig\(tid\)\.catch\(\(\) => null\)/);
  assert.match(dispatcher, /discordUsername === rawTarget/);
});

test('GLOBAL INVARIANT: bot-share is only allowed to gate autonomous bot-to-bot behavior', () => {
  const allowedGetModeCallSites = new Set([
    'src/lib/bot-interactions-store.ts',
    'src/services/chat-dispatcher.ts',
    'src/app/api/discord/chat/route.ts',
  ]);
  const offenders = sourceFiles('src')
    .filter((file) => read(file).includes('getBotShareMode'))
    .filter((file) => !allowedGetModeCallSites.has(file));

  assert.deepEqual(offenders, [], `Human-facing code must never gate on Bot Share: ${offenders.join(', ')}`);

  const policy = read('src/lib/bot-share-policy.ts');
  assert.match(policy, /autonomous-bot-to-bot-only/);
  assert.match(policy, /human-chat/);
  assert.match(policy, /human-command/);
  assert.match(policy, /human-trigger/);
  assert.match(policy, /human-directed-relay/);
  assert.match(policy, /persona-conversation/);
  assert.match(policy, /Discord, Twitch, Kick, TikTok, HearMeOut, SPMT/);

  const personaCatalog = read('src/services/bot-persona-catalog.ts');
  const spmtCatalog = read('src/app/api/spmt/bots/route.ts');
  const humanCommandRoute = read('src/app/api/spmt/bot/commands/route.ts');
  assert.doesNotMatch(personaCatalog, /getBotShareMode|shareMode/);
  assert.doesNotMatch(spmtCatalog, /getBotShareMode|shareMode/);
  assert.doesNotMatch(humanCommandRoute, /getBotShareMode|BOT_NOT_SHARED/);
  assert.match(humanCommandRoute, /role:\s*isGuestBot \? 'member' : 'owner'/);
});

test('GLOBAL INVARIANT: public/platform chatbot conversation never routes through the SPMT account adapter', () => {
  const spmtAccountAdapter = 'src/app/api/spmt/bot/commands/route.ts';
  const callers = sourceFiles('src')
    .filter((file) => file !== spmtAccountAdapter)
    .filter((file) => read(file).includes('/api/spmt/bot/commands'));

  assert.deepEqual(
    callers,
    [],
    `Public/platform chat must use platform or trusted service context, never SPMT-login adapter: ${callers.join(', ')}`,
  );

  const authMarkers = sourceFiles('src')
    .filter((file) => read(file).includes('SPMT_AUTH_REQUIRED'));
  assert.deepEqual(
    authMarkers.sort(),
    ['src/app/api/spmt/bot/commands/route.ts', 'src/app/api/spmt/bots/route.ts'].sort(),
    'SPMT login requirements must stay confined to SPMT account adapters, not chatbot ingress',
  );

  const docs = read('docs/BOT_SHARE_POLICY.md');
  assert.match(docs, /A human must not be required to sign into SPMT merely to talk to a public chatbot/);
  assert.match(docs, /Discord, Twitch, Kick, TikTok, HearMeOut/);
  assert.match(docs, /must not call `\/api\/spmt\/bot\/commands`/);
});
