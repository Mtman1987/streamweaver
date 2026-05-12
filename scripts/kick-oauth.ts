/**
 * One-off script to get Kick OAuth token for streamweaverbot (with PKCE)
 * 
 * Usage: npx tsx scripts/kick-oauth.ts
 */

import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLIENT_ID = process.env.KICK_CLIENT_ID || '01KRDQZRZZGYAQZCAHP0097794';
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '604dcc384c4585d632ce3405b72fadad7274a044afda71cf275972f1d02f8317';
const REDIRECT_URI = 'http://localhost:3100/api/auth/kick/callback';
const SCOPES = 'user:read channel:read channel:write chat:write events:subscribe moderation:manage';

// Generate PKCE code verifier and challenge
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/auth/kick/callback')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const url = new URL(req.url, 'http://localhost:3100');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get('error_description') || ''}</p>`);
    console.error('OAuth error:', error, url.searchParams.get('error_description'));
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>No code received</h1><p>Params: ${url.search}</p>`);
    console.error('No code in callback. URL:', req.url);
    process.exit(1);
  }

  console.log('Got authorization code, exchanging for tokens...');

  try {
    // Kick uses Auth0 - token endpoint at id.kick.com
    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', tokenRes.status, errText);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h1>Token exchange failed (${tokenRes.status})</h1><pre>${errText}</pre>`);
      process.exit(1);
    }

    const tokenData = await tokenRes.json();
    console.log('Token received!');

    // Get user info
    let username = 'streamweaverbot';
    let channelId = '';
    let chatroomId = '';
    try {
      const userRes = await fetch('https://api.kick.com/public/v1/users/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        const d = userData.data || userData;
        username = d.username || d.slug || username;
        channelId = String(d.channel_id || d.id || '');
        chatroomId = String(d.chatroom_id || d.chatroom?.id || '');
        console.log('Authenticated as:', username);
        console.log('Channel ID:', channelId);
        console.log('Chatroom ID:', chatroomId);
      }
    } catch (e) {
      console.warn('Could not fetch user info:', e);
    }

    // Save to global kick-bot-tokens.json
    const persistRoot = process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime');
    const globalDir = path.join(persistRoot, 'global');
    fs.mkdirSync(globalDir, { recursive: true });

    const tokensFile = path.join(globalDir, 'kick-bot-tokens.json');
    const tokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: Date.now() + ((tokenData.expires_in || 3600) - 60) * 1000,
      username,
      channelId,
      chatroomId,
      scopes: tokenData.scope || SCOPES,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    console.log(`\n✅ Tokens saved to: ${tokensFile}`);
    console.log(`   Username: ${username}`);
    console.log(`   Expires: ${new Date(tokens.tokenExpiry).toISOString()}`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>✅ Success!</h1><p>Authenticated as <b>${username}</b>. Tokens saved locally. You can close this window.</p>`);

    setTimeout(() => process.exit(0), 1000);
  } catch (e) {
    console.error('Error:', e);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><pre>${e}</pre>`);
    process.exit(1);
  }
});

server.listen(3100, () => {
  const authUrl = new URL('https://id.kick.com/oauth/authorize');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', 'community-bot');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('\n🔑 Kick OAuth for StreamWeaverBot (PKCE)');
  console.log('=========================================');
  console.log('\nOpening browser... Log in as streamweaverbot and authorize.\n');
  console.log('If browser doesn\'t open, paste this URL:');
  console.log(authUrl.toString());
  console.log('');
  console.log('Code verifier (saved for token exchange):', codeVerifier);
  console.log('');

  // Open browser
  exec(`start "" "${authUrl.toString()}"`);
});
