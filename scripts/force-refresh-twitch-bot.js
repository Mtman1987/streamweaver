const { forceRefreshStoredToken } = require('../src/lib/token-utils.server');
const twitchClient = require('../src/services/twitch-client');

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required');
  }

  await forceRefreshStoredToken(clientId, clientSecret, 'bot', tenantId);
  console.log(`FORCED_BOT_REFRESH_OK ${tenantId}`);

  await twitchClient.setupTwitchClient(tenantId);
  console.log(`RECONNECTED_OK ${tenantId}`);
}

main().catch((error) => {
  console.error('FORCED_BOT_REFRESH_ERR', error?.stack || error);
  process.exit(1);
});
