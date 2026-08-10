import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the Discord route is the sole default owner of private AI messages', () => {
  const ownership = source('../src/services/discord-processing-owner.ts');
  const monitor = source('../src/services/chat-monitor.ts');
  const route = source('../src/app/api/discord/chat/route.ts');

  assert.match(ownership, /'dm-private-ai': 'route'/);
  assert.match(monitor, /if \(!pollOwns\('dm-private-ai'\)\) return;/);

  const dedupeIndex = route.indexOf('const isFirstSeen = registerHandledDiscordMessage');
  const privateLaneIndex = route.indexOf('const isPrivateDiscordLane = isDirectMessage');
  assert.ok(dedupeIndex >= 0, 'Discord ingress must register every message');
  assert.ok(privateLaneIndex > dedupeIndex, 'DM dedupe must run before private-lane dispatch');
  assert.match(route, /reason: isDirectMessage \? 'duplicate-private-message' : 'duplicate-public-message'/);
});

test('every StreamWeaver private structured reply resolves saved presentation settings', () => {
  const replies = source('../src/services/discord-structured-replies.ts');

  assert.match(replies, /export async function resolveStructuredDiscordReplyInput/);
  assert.match(replies, /readPrivateChatSettings\(input\.tenantId\)/);
  assert.match(replies, /gifEnabled: settings\.gifEnabled/);
  assert.match(replies, /ttsEnabled: settings\.ttsEnabled/);
  assert.match(replies, /adultMode: settings\.adultMode/);
  assert.match(replies, /const effectiveInput = await resolveStructuredDiscordReplyInput\(input\)/);
});
