#!/usr/bin/env node
/**
 * Refresh expired Twitch tokens using refresh_token grant.
 * Updates both root tokens/ and tenant tokens.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '9u0mtc83xeabmguw53c89dehth0gwg';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'wclfm53vrx76i435p2jhmyv3v1ovrn';

const TOKEN_PATHS = [
  path.join(__dirname, 'tokens', 'twitch-tokens.json'),
  path.join(__dirname, 'data', 'runtime', 'tenants', '94371378', 'tokens', 'twitch-tokens.json'),
];

async function refreshToken(refreshToken) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Refresh failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function main() {
  for (const tokenPath of TOKEN_PATHS) {
    if (!fs.existsSync(tokenPath)) {
      console.log(`Skip: ${tokenPath} (not found)`);
      continue;
    }

    console.log(`\nRefreshing: ${tokenPath}`);
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    // Refresh broadcaster
    if (tokens.broadcasterRefreshToken) {
      try {
        console.log(`  Refreshing broadcaster (${tokens.broadcasterUsername})...`);
        const data = await refreshToken(tokens.broadcasterRefreshToken);
        tokens.broadcasterToken = data.access_token;
        tokens.broadcasterRefreshToken = data.refresh_token;
        tokens.broadcasterTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        console.log(`  ✅ Broadcaster token refreshed (expires in ${Math.round(data.expires_in / 3600)}h)`);
      } catch (e) {
        console.log(`  ❌ Broadcaster refresh failed: ${e.message}`);
      }
    }

    // Refresh bot
    if (tokens.botRefreshToken) {
      try {
        console.log(`  Refreshing bot (${tokens.botUsername})...`);
        const data = await refreshToken(tokens.botRefreshToken);
        tokens.botToken = data.access_token;
        tokens.botRefreshToken = data.refresh_token;
        tokens.botTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        console.log(`  ✅ Bot token refreshed (expires in ${Math.round(data.expires_in / 3600)}h)`);
      } catch (e) {
        console.log(`  ❌ Bot refresh failed: ${e.message}`);
      }
    }

    // Refresh login
    if (tokens.loginRefreshToken) {
      try {
        console.log(`  Refreshing login (${tokens.loginUsername})...`);
        const data = await refreshToken(tokens.loginRefreshToken);
        tokens.loginToken = data.access_token;
        tokens.loginRefreshToken = data.refresh_token;
        tokens.loginTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        console.log(`  ✅ Login token refreshed (expires in ${Math.round(data.expires_in / 3600)}h)`);
      } catch (e) {
        console.log(`  ❌ Login refresh failed: ${e.message}`);
      }
    }

    tokens.lastUpdated = new Date().toISOString();
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log(`  💾 Saved to ${tokenPath}`);
  }

  console.log('\nDone! Now run: node test-commands.js');
}

main().catch(e => { console.error(e); process.exit(1); });
