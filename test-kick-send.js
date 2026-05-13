// test-kick-send.js — run on Fly machine: node test-kick-send.js
const fs = require('fs');
const path = require('path');

const PERSIST_ROOT = process.env.PERSIST_ROOT || '/data/runtime';
const TENANT_ID = '94371378';
const tokensFile = path.join(PERSIST_ROOT, 'tenants', TENANT_ID, 'tokens', 'kick-tokens.json');

async function main() {
  const raw = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
  console.log('Token file keys:', Object.keys(raw));
  console.log('broadcasterUsername:', raw.broadcasterUsername);
  console.log('broadcasterChannelId:', raw.broadcasterChannelId);
  console.log('broadcasterChatroomId:', raw.broadcasterChatroomId);
  console.log('botUsername:', raw.botUsername || '(none)');
  console.log('hasBroadcasterToken:', !!raw.broadcasterToken);
  console.log('hasBotToken:', !!raw.botToken);

  // Get a fresh token
  const token = raw.broadcasterToken || raw.botToken;
  if (!token) { console.log('No token!'); return; }

  // Validate token
  const introRes = await fetch('https://api.kick.com/public/v1/token/introspect', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const introData = await introRes.json();
  console.log('\nToken introspect:', JSON.stringify(introData, null, 2));

  // Try different payloads
  const chatroomId = parseInt(raw.broadcasterChatroomId || raw.botChatroomId || '0');
  const channelId = parseInt(raw.broadcasterChannelId || raw.botChannelId || '0');

  const tests = [
    { name: 'bot-only', payload: { content: 'test from streamweaver', type: 'bot' } },
    { name: 'user+channelId', payload: { content: 'test from streamweaver', type: 'user', broadcaster_user_id: channelId } },
  ];

  // If we know the user_id from introspect, try that too
  if (introData?.data?.user_id) {
    tests.push({ name: 'user+introspectUserId', payload: { content: 'test from streamweaver', type: 'user', broadcaster_user_id: introData.data.user_id } });
  }

  for (const test of tests) {
    console.log(`\n--- Test: ${test.name} ---`);
    console.log('Payload:', JSON.stringify(test.payload));
    const res = await fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(test.payload),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
    if (res.ok) { console.log('✅ SUCCESS!'); break; }
  }
}

main().catch(e => console.error(e));
