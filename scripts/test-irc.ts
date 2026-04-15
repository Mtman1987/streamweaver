// Quick test: connect to Twitch IRC and send a message using tenant tokens
// Run: npx tsx scripts/test-irc.ts

import { config } from 'dotenv';
config();

import * as tmi from 'tmi.js';
import { getStoredTokens, ensureValidToken } from '../src/lib/token-utils.server';

const TENANT_ID = '94371378'; // your twitch ID

async function main() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in .env');
    process.exit(1);
  }

  console.log('Loading tokens for tenant', TENANT_ID, '...');
  const tokens = await getStoredTokens(TENANT_ID);
  if (!tokens) {
    console.error('No tokens found for tenant', TENANT_ID);
    process.exit(1);
  }

  console.log('Broadcaster:', tokens.broadcasterUsername);
  console.log('Bot:', tokens.botUsername);
  console.log('Has broadcaster token:', !!tokens.broadcasterToken);
  console.log('Has bot token:', !!tokens.botToken);

  if (!tokens.broadcasterToken) {
    console.error('No broadcaster token — link broadcaster account first');
    process.exit(1);
  }

  console.log('Validating broadcaster token...');
  const validToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, TENANT_ID);
  console.log('Token valid, connecting IRC...');

  const client = new tmi.Client({
    options: { debug: true },
    identity: {
      username: tokens.broadcasterUsername,
      password: `oauth:${validToken.replace('oauth:', '')}`,
    },
    channels: [tokens.broadcasterUsername!],
  });

  client.on('connected', async () => {
    console.log('✅ Connected! Sending test message...');
    await client.say(tokens.broadcasterUsername!, '🧪 StreamWeaver IRC test — if you see this, multi-tenant chat is working!');
    console.log('✅ Message sent! Disconnecting...');
    await client.disconnect();
    process.exit(0);
  });

  client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
  });

  await client.connect();
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
