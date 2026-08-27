import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Twitch login stores the fresh grant before reconnecting the tenant runtime', async () => {
  const source = await readFile('src/app/auth/twitch/callback/route.ts', 'utf8');
  const loginStart = source.indexOf("if (state === 'login' && userInfo)");
  const loginEnd = source.indexOf('// ─── BROADCASTER / BOT / COMMUNITY-BOT FLOW', loginStart);
  const loginFlow = source.slice(loginStart, loginEnd);

  const durableWrite = loginFlow.indexOf('await fs.writeFile(tokensFile');
  const reconnect = loginFlow.indexOf('await reconnectTwitchTenant(twitchId)');
  const sessionRedirect = loginFlow.indexOf('NextResponse.redirect');

  assert.ok(loginStart >= 0, 'login OAuth flow exists');
  assert.ok(durableWrite >= 0, 'fresh Twitch grant is persisted');
  assert.ok(reconnect > durableWrite, 'tenant runtime reconnects after the grant is durable');
  assert.ok(sessionRedirect > reconnect, 'the callback reconnects before returning to dashboard');
});

test('every successful broadcaster authorization uses the shared reconnect path', async () => {
  const source = await readFile('src/app/auth/twitch/callback/route.ts', 'utf8');
  assert.match(source, /await reconnectTwitchTenant\(tenantId\)/);
  assert.doesNotMatch(source, /fetch\(`http:\/\/127\.0\.0\.1:\$\{wsPort\}\/api\/twitch\/reconnect`[\s\S]*fetch\(`http:\/\/127\.0\.0\.1:\$\{wsPort\}\/api\/twitch\/reconnect`/);
});
