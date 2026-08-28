import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('The Count OAuth is owner-only, state-bound, and exact-account pinned', () => {
  const start = read('src/app/api/auth/twitch/route.ts');
  const callback = read('src/app/auth/twitch/callback/route.ts');
  const transaction = read('src/lib/twitch-privileged-oauth.server.ts');

  assert.match(start, /isPrivilegedRole\(requestedRole\)/);
  assert.match(start, /!isAdmin\(session\.tenantId\)/);
  assert.match(start, /createPrivilegedTwitchOAuthTransaction/);
  assert.match(start, /requestedRole === 'the-count' \? countScopes : standardScopes/);
  assert.match(transaction, /randomBytes\(32\)/);
  assert.match(transaction, /timingSafeEqual/);
  assert.match(transaction, /transaction\.ownerId !== ownerId/);
  assert.match(transaction, /transaction\.nonce !== returnedState/);
  assert.match(callback, /login !== THE_COUNT_TWITCH_LOGIN/);
  assert.match(callback, /userId/);
  assert.match(callback, /storeTheCountTwitchCredential/);
  assert.match(callback, /invalid_oauth_state/);
});

test('The Count credential is encrypted, permission-restricted, and identity immutable', () => {
  const vault = read('src/lib/the-count-twitch-vault.server.ts');

  assert.match(vault, /aes-256-gcm/);
  assert.match(vault, /STREAMWEAVER_SESSION_SECRET/);
  assert.match(vault, /mode: 0o600/);
  assert.match(vault, /existing\.userId !== normalized\.userId/);
  assert.match(vault, /refreshedIdentity\?\.userId !== credential\.userId/);
  assert.match(vault, /the-count-twitch\.vault/);
  assert.doesNotMatch(vault, /the-count-twitch.*\.json/);
});

test('The Count uses a dedicated send-only client across tenant channels', () => {
  const twitchClient = read('src/services/twitch-client.ts');
  const sharedChat = read('src/services/shared-chat.ts');
  const server = read('src/server/routes.ts');

  const countClientStart = twitchClient.indexOf('async function getOrConnectTheCountTwitchClient');
  const countClientEnd = twitchClient.indexOf('async function ensureTheCountForChannel', countClientStart);
  assert.ok(countClientStart >= 0 && countClientEnd > countClientStart);
  const countClientBody = twitchClient.slice(countClientStart, countClientEnd);
  assert.doesNotMatch(countClientBody, /client\.on\('message'/);
  assert.match(countClientBody, /send-only/);
  assert.match(twitchClient, /ensureTheCountForChannel\(broadcasterUsername/);
  assert.match(twitchClient, /setupTheCountTwitchClient/);
  assert.match(sharedChat, /kind: 'count'/);
  assert.match(sharedChat, /ensureValidTheCountTwitchToken/);
  assert.match(server, /Unauthorized Count identity send/);
  assert.match(server, /getTheCountTwitchClient/);
});

test('Twitch Count invocation preserves the canonical egg and personality route', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');

  assert.match(dispatcher, /messageInvokesTheCount\(actualMessage\)/);
  assert.match(dispatcher, /provider: 'twitch'/);
  assert.match(dispatcher, /entitlement\.eggs\.blackHole/);
  assert.match(dispatcher, /personality: THE_COUNT_PERSONALITY/);
  assert.match(dispatcher, /responseName: THE_COUNT_NAME/);
  assert.match(dispatcher, /context: 'twitch-cross-bot'/);
  assert.match(dispatcher, /sendChatMessage\(aiReply, 'count'/);
  assert.match(dispatcher, /isTheCountTwitchLogin\(actualUsername\)/);
});

test('Only the owner can see or remove global Twitch identities', () => {
  const status = read('src/app/api/integrations/twitch/status/route.ts');
  const disconnect = read('src/app/api/integrations/twitch/disconnect/route.ts');
  const integrations = read('src/app/(app)/integrations/page.tsx');

  assert.match(status, /const owner = isAdmin\(session\.tenantId\)/);
  assert.match(status, /\.\.\.\(owner \? \{/);
  assert.match(status, /theCountUsername/);
  assert.match(disconnect, /!isAdmin\(tenantId\)/);
  assert.match(disconnect, /OWNER_REQUIRED/);
  assert.match(integrations, /twitchStatus\.owner &&/);
  assert.match(integrations, /Re-authorize Same Account/);
  assert.doesNotMatch(integrations, /disconnectTwitch\("the-count"\)/);
});
