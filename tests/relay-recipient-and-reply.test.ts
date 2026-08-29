import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { detectBotRelayRequest } from '../src/services/bot-relay';
import {
  buildRelayReplyInstructions,
  extractRelayQuotedSegments,
  extractRelayReplyCommand,
  preserveRelayQuotedSegments,
} from '../src/services/relay-message-format';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('every quoted span is immutable while unquoted prose may be restyled', () => {
  const source = `please say "Exact CASE!" and 'second bit' tomorrow`;
  const segments = extractRelayQuotedSegments(source);

  assert.deepEqual(segments.map((segment) => segment.full), ['"Exact CASE!"', "'second bit'"]);
  const restyled = preserveRelayQuotedSegments(
    'Moonbeam says the timing works beautifully.',
    source,
  );
  assert.match(restyled, /"Exact CASE!"/);
  assert.match(restyled, /'second bit'/);
  assert.doesNotMatch(restyled, /please say/);
});

test('a fully quoted relay remains exact and contractions are not false quotes', () => {
  assert.deepEqual(
    extractRelayQuotedSegments(`"Do NOT change this, please!"`).map((segment) => segment.content),
    ['Do NOT change this, please!'],
  );
  assert.deepEqual(extractRelayQuotedSegments(`don't change what's outside`), []);
});

test('reply invitation accepts reply or yes plus a message and no closes it', () => {
  assert.deepEqual(
    extractRelayReplyCommand({
      message: 'Moonbeam reply "Keep this exact."',
      botNames: ['Moonbeam'],
    }),
    {
      matched: true,
      action: 'reply',
      message: '"Keep this exact."',
      missingMessage: false,
    },
  );
  assert.equal(extractRelayReplyCommand({ message: 'yes I can call after stream' }).message, 'I can call after stream');
  assert.equal(extractRelayReplyCommand({ message: 'no thanks' }).action, 'close');
  assert.equal(extractRelayReplyCommand({ message: 'reply' }).missingMessage, true);
});

test('delivery instructions explain reply, close, and expiry behavior', () => {
  const instructions = buildRelayReplyInstructions('Commander M.T.');
  assert.match(instructions, /"reply"/);
  assert.match(instructions, /"yes"/);
  assert.match(instructions, /"no"/);
  assert.match(instructions, /10 minutes/);
  assert.match(instructions, /original location/);
});

test('nested relay parsing preserves the original quote marks', () => {
  const request = detectBotRelayRequest({
    message: 'Athena send a message to Moonbeam that "Word for word."',
    speakerName: 'Athena',
    targets: [],
  });

  assert.equal(request.matched, true);
  assert.equal(request.targetName, 'Moonbeam');
  assert.equal(request.relayMessage, '"Word for word."');
});

test('community fallback and reply routing are wired independently of botshare', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const store = read('src/lib/relay-reply-thread-store.ts');

  assert.match(dispatcher, /resolveHumanRelaySpeaker/);
  assert.match(dispatcher, /stableId: 'community:streamweaverbot'/);
  assert.match(dispatcher, /targetPlatformOverride/);
  assert.match(dispatcher, /sourceChannelId: replyChannel/);
  assert.match(dispatcher, /recipientUserId \? `<@\$\{input\.recipientUserId\}>`/);
  assert.match(dispatcher, /replaceTargetDiscordMessageId/);
  assert.match(dispatcher, /editStructuredDiscordReply/);
  assert.match(store, /RELAY_REPLY_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(store, /messageId\?: string/);
  assert.match(store, /thread\.delivery\.channelId === input\.channelId/);
  assert.match(store, /isIntendedRecipient/);
});

test('Discord DM relays are matched before the ordinary private AI response', () => {
  const route = read('src/app/api/discord/chat/route.ts');
  const relayMarker = route.indexOf('DMs use the same relay protocol as guild channels');
  const privateLane = route.indexOf('if (isPrivateDiscordLane) {', relayMarker);

  assert.ok(relayMarker > 0);
  assert.ok(privateLane > relayMarker);
  assert.match(route, /sourceDiscordIsPrivate: true/);
  assert.match(route, /sourceDiscordRelayMessageId: acknowledgement\.messageId/);
});
