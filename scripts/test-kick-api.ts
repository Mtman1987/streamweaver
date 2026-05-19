/**
 * Quick test: Verify Kick API responses
 * Usage: npx tsx scripts/test-kick-api.ts
 */

const USERNAME = 'mtman1987';

async function main() {
  console.log('=== Testing Kick API endpoints ===\n');

  // Test 1: Public v2 channels (what the browser would call)
  console.log(`[1] GET https://kick.com/api/v2/channels/${USERNAME}`);
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${USERNAME}`);
    console.log(`    Status: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`    channel id: ${data.id}`);
      console.log(`    chatroom.id: ${data.chatroom?.id}`);
      console.log(`    slug: ${data.slug}`);
      console.log(`    Keys: ${Object.keys(data).join(', ')}`);
    } else {
      console.log(`    Body: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`    Error: ${e}`);
  }

  // Test 2: If we have a token, test /users/me
  const tokenFile = require('path').join(process.cwd(), 'data', 'runtime', 'global', 'kick-bot-tokens.json');
  let token = '';
  try {
    const data = JSON.parse(require('fs').readFileSync(tokenFile, 'utf-8'));
    token = data.accessToken;
    console.log(`\n[2] GET https://api.kick.com/public/v1/users/me (token from ${tokenFile})`);
  } catch {
    console.log('\n[2] Skipping /users/me — no local token file found');
  }

  if (token) {
    try {
      const res = await fetch('https://api.kick.com/public/v1/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`    Status: ${res.status}`);
      if (res.ok) {
        const raw = await res.json();
        const data = raw.data || raw;
        console.log(`    username: ${data.username}`);
        console.log(`    channel_id: ${data.channel_id}`);
        console.log(`    chatroom_id: ${data.chatroom_id}`);
        console.log(`    Keys: ${Object.keys(data).join(', ')}`);
      } else {
        console.log(`    Body: ${(await res.text()).slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`    Error: ${e}`);
    }
  }

  console.log('\n=== Done ===');
}

main();
