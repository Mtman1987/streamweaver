import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const file = path.join(root, relativePath);
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const source = transform(original);
  if (source !== original) fs.writeFileSync(file, source, 'utf8');
  console.log(`[CommunityBotRecovery] patched ${relativePath}`);
}

patchFile('src/services/twitch-client.ts', (input) => {
  let source = input;
  const oldLoader = `async function getCommunityBotTokens(): Promise<StoredTokens | null> {\n  try {\n    const raw = await fsp.readFile(communityBotTokensPath(), 'utf-8');\n    const parsed = JSON.parse(raw);\n    // Accept either dedicated community keys or legacy bot keys.\n    const normalized: StoredTokens = {\n      communityBotToken: parsed.communityBotToken || parsed.botToken || parsed.access_token,\n      communityBotRefreshToken: parsed.communityBotRefreshToken || parsed.botRefreshToken || parsed.refresh_token,\n      communityBotUsername: parsed.communityBotUsername || parsed.botUsername || parsed.username,\n      communityBotTokenExpiry: parsed.communityBotTokenExpiry || parsed.botTokenExpiry,\n    };\n    if (!normalized.communityBotToken || !normalized.communityBotRefreshToken || !normalized.communityBotUsername) {\n      return null;\n    }\n    return normalized;\n  } catch {\n    return null;\n  }\n}`;
  const newLoader = `async function getCommunityBotTokens(): Promise<StoredTokens | null> {\n  const tokenPath = communityBotTokensPath();\n  try {\n    const raw = await fsp.readFile(tokenPath, 'utf-8');\n    const parsed = JSON.parse(raw);\n    const normalized: StoredTokens = {\n      communityBotToken: parsed.communityBotToken || parsed.botToken || parsed.access_token,\n      communityBotRefreshToken: parsed.communityBotRefreshToken || parsed.botRefreshToken || parsed.refresh_token,\n      communityBotUsername: parsed.communityBotUsername || parsed.botUsername || parsed.username,\n      communityBotTokenExpiry: parsed.communityBotTokenExpiry || parsed.botTokenExpiry,\n    };\n    const missing = [\n      !normalized.communityBotToken ? 'access token' : '',\n      !normalized.communityBotRefreshToken ? 'refresh token' : '',\n      !normalized.communityBotUsername ? 'username' : '',\n    ].filter(Boolean);\n    if (missing.length > 0) {\n      console.warn(\`[Twitch:community-bot] Credentials incomplete at \${tokenPath}: missing \${missing.join(', ')}\`);\n      return null;\n    }\n    return normalized;\n  } catch (error: any) {\n    const code = String(error?.code || '');\n    if (code === 'ENOENT') {\n      console.warn(\`[Twitch:community-bot] Credential file not found at \${tokenPath}; authorize the Community Bot in Integrations\`);\n    } else {\n      console.warn(\`[Twitch:community-bot] Could not read credentials at \${tokenPath}: \${error?.message || String(error)}\`);\n    }\n    return null;\n  }\n}`;
  if (!source.includes('[Twitch:community-bot] Credentials incomplete at')) {
    if (!source.includes(oldLoader)) throw new Error('Community bot token loader marker missing');
    source = source.replace(oldLoader, newLoader);
  }

  const oldNullCache = `  const client = await communityBotConnectPromise;\n  if (!client) return null;`;
  const newNullCache = `  const client = await communityBotConnectPromise;\n  if (!client) {\n    // Do not cache a failed setup forever: OAuth can write fresh credentials while this process is live.\n    communityBotConnectPromise = null;\n    return null;\n  }`;
  if (!source.includes('Do not cache a failed setup forever')) {
    if (!source.includes(oldNullCache)) throw new Error('Community bot null-promise marker missing');
    source = source.replace(oldNullCache, newNullCache);
  }
  return source;
});

patchFile('src/server/routes.ts', (input) => {
  let source = input;
  if (source.includes("pathname === '/api/twitch/community-bot/reconnect'")) return source;
  const marker = `            if (pathname === '/api/twitch/community-bot/disconnect' && req.method === 'POST') {`;
  const block = `            if (pathname === '/api/twitch/community-bot/reconnect' && req.method === 'POST') {\n                try {\n                    console.log('[HTTP] Reconnecting shared community bot...');\n                    const { disconnectCommunityBot, getCommunityBotRuntimeState } = twitchClientModule;\n                    await disconnectCommunityBot();\n                    const { syncSignalCarrierRosterOnce } = require('../services/signal-carrier-sync');\n                    await syncSignalCarrierRosterOnce();\n                    const state = getCommunityBotRuntimeState();\n                    console.log('[HTTP] Shared community bot reconnect result:', state);\n                    res.writeHead(200, { 'Content-Type': 'application/json' });\n                    res.end(JSON.stringify({ success: true, state }));\n                } catch (e: any) {\n                    console.error('[HTTP] Shared community bot reconnect failed:', e);\n                    res.writeHead(500, { 'Content-Type': 'application/json' });\n                    res.end(JSON.stringify({ error: e.message }));\n                }\n                return;\n            }\n\n`;
  if (!source.includes(marker)) throw new Error('Community bot disconnect route marker missing');
  return source.replace(marker, `${block}${marker}`);
});

patchFile('src/app/auth/twitch/callback/route.ts', (input) => {
  let source = input;
  const oldCommunityBlock = `      const username = userInfo?.login || '';\n      const storage = {\n        ...existing,\n        communityBotToken: tokenData.access_token,\n        communityBotRefreshToken: tokenData.refresh_token,\n        communityBotTokenExpiry: tokenExpiry,\n        communityBotUsername: username,\n        lastUpdated: new Date().toISOString(),\n      };\n      await fs.writeFile(cbPath, JSON.stringify(storage, null, 2));\n      return NextResponse.redirect(\`\${appOrigin}/integrations?success=true\`);`;
  const newCommunityBlock = `      let username = userInfo?.login || '';\n      if (!username) {\n        const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {\n          headers: { Authorization: \`Bearer \${tokenData.access_token}\` },\n        });\n        if (validateResponse.ok) {\n          const identity = await validateResponse.json().catch(() => null);\n          username = String(identity?.login || '').trim().toLowerCase();\n        }\n      }\n      if (!username) {\n        console.error('[Twitch OAuth] Community bot identity could not be resolved; credentials not stored');\n        return NextResponse.redirect(\`\${appOrigin}/integrations?error=community_bot_identity\`);\n      }\n      const storage = {\n        ...existing,\n        communityBotToken: tokenData.access_token,\n        communityBotRefreshToken: tokenData.refresh_token,\n        communityBotTokenExpiry: tokenExpiry,\n        communityBotUsername: username,\n        lastUpdated: new Date().toISOString(),\n      };\n      await fs.writeFile(cbPath, JSON.stringify(storage, null, 2));\n      console.info('[Twitch OAuth] Community bot credentials stored', { username, hasRefreshToken: Boolean(tokenData.refresh_token) });\n      try {\n        const wsPort = process.env.WS_PORT || '8090';\n        const reconnectResponse = await fetch(\`http://127.0.0.1:\${wsPort}/api/twitch/community-bot/reconnect\`, { method: 'POST' });\n        const reconnectText = await reconnectResponse.text().catch(() => '');\n        console.info('[Twitch OAuth] Community bot IRC reconnect response', { status: reconnectResponse.status, body: reconnectText.slice(0, 500) });\n      } catch (reconnectError) {\n        console.warn('[Twitch OAuth] Community bot credentials saved but IRC reconnect failed:', reconnectError);\n      }\n      return NextResponse.redirect(\`\${appOrigin}/integrations?success=true\`);`;
  if (!source.includes('[Twitch OAuth] Community bot credentials stored')) {
    if (!source.includes(oldCommunityBlock)) throw new Error('Community bot OAuth storage marker missing');
    source = source.replace(oldCommunityBlock, newCommunityBlock);
  }
  return source;
});

console.log('Community bot OAuth/runtime recovery patch applied.');
