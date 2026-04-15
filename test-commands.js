#!/usr/bin/env node
/**
 * StreamWeaver Command Tester
 * 
 * Connects to Twitch IRC as the bot, fires commands, and logs responses.
 * Usage: node test-commands.js
 */

require('dotenv').config();
const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');

// Load tokens from tenant or root
function loadTokens() {
  const paths = [
    path.join(__dirname, 'data', 'runtime', 'tenants', '94371378', 'tokens', 'twitch-tokens.json'),
    path.join(__dirname, 'tokens', 'twitch-tokens.json'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`[Tokens] Loaded from: ${p}`);
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }
  throw new Error('No twitch-tokens.json found');
}

const tokens = loadTokens();
const CHANNEL = tokens.broadcasterUsername || 'mtman1987';
const BOT_USER = tokens.botUsername || 'athenabot87';
const BOT_TOKEN = tokens.botToken;
const BROADCASTER_TOKEN = tokens.broadcasterToken;

if (!BOT_TOKEN) {
  console.error('❌ No botToken in twitch-tokens.json');
  process.exit(1);
}

// Commands to test — [command, description, expectBotReply]
const TEST_COMMANDS = [
  ['!points', 'Check points balance', true],
  ['!time', 'Show time zones', true],
  ['!coinflip', 'Flip a coin', true],
  ['!commands', 'List all commands', true],
  ['!watchtime', 'Check watchtime', true],
  ['!uptime', 'Stream uptime', true],
  ['!stats', 'Channel stats', true],
  ['!followers', 'Follower count', true],
  ['!collection', 'Pokemon collection', true],
  ['!leader', 'Leaderboard', true],
  ['!hug @testuser', 'Social command - hug', true],
  ['!lurk', 'Lurk command', true],
];

const results = [];
const responses = new Map(); // command -> response messages

async function main() {
  console.log('='.repeat(60));
  console.log('StreamWeaver Command Tester');
  console.log('='.repeat(60));
  console.log(`Channel: #${CHANNEL}`);
  console.log(`Bot: ${BOT_USER}`);
  console.log(`Commands to test: ${TEST_COMMANDS.length}`);
  console.log('');

  // Step 1: Validate tokens
  console.log('[Step 1] Validating bot token...');
  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    });
    if (validateRes.ok) {
      const data = await validateRes.json();
      console.log(`  ✅ Bot token valid — login: ${data.login}, expires in: ${Math.round(data.expires_in / 3600)}h`);
    } else {
      console.log(`  ❌ Bot token INVALID (${validateRes.status})`);
      console.log('  → Token needs refresh. Run StreamWeaver to auto-refresh.');
      process.exit(1);
    }
  } catch (e) {
    console.log(`  ❌ Token validation failed: ${e.message}`);
    process.exit(1);
  }

  console.log('[Step 1b] Validating broadcaster token...');
  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${BROADCASTER_TOKEN}` },
    });
    if (validateRes.ok) {
      const data = await validateRes.json();
      console.log(`  ✅ Broadcaster token valid — login: ${data.login}, expires in: ${Math.round(data.expires_in / 3600)}h`);
    } else {
      console.log(`  ❌ Broadcaster token INVALID (${validateRes.status})`);
    }
  } catch (e) {
    console.log(`  ❌ Broadcaster token validation failed: ${e.message}`);
  }

  // Step 2: Connect as bot (to listen for responses)
  console.log('\n[Step 2] Connecting to Twitch IRC as listener...');
  
  const listener = new tmi.Client({
    options: { debug: false },
    identity: {
      username: BOT_USER,
      password: `oauth:${BOT_TOKEN.replace('oauth:', '')}`,
    },
    channels: [CHANNEL],
  });

  let connected = false;

  listener.on('connected', () => {
    connected = true;
    console.log(`  ✅ Connected to #${CHANNEL} as ${BOT_USER}`);
  });

  // Collect ALL messages (from anyone)
  const allMessages = [];
  listener.on('message', (channel, tags, message, self) => {
    const from = tags.username || 'unknown';
    const ts = new Date().toISOString().slice(11, 19);
    allMessages.push({ ts, from, message, self });
    
    // Only log bot/broadcaster responses (not our own test messages)
    if (from.toLowerCase() === BOT_USER.toLowerCase() || 
        from.toLowerCase() === CHANNEL.toLowerCase()) {
      if (!self) {
        console.log(`  📨 [${ts}] ${from}: ${message}`);
      }
    }
  });

  try {
    await listener.connect();
  } catch (e) {
    console.log(`  ❌ Connection failed: ${e.message}`);
    console.log('  → Check if bot token is valid and bot has chat access');
    process.exit(1);
  }

  if (!connected) {
    console.log('  ❌ Not connected after connect() returned');
    process.exit(1);
  }

  // Step 3: Fire commands one by one
  console.log(`\n[Step 3] Firing ${TEST_COMMANDS.length} commands (3s gap between each)...\n`);

  for (let i = 0; i < TEST_COMMANDS.length; i++) {
    const [cmd, desc, expectReply] = TEST_COMMANDS[i];
    const msgCountBefore = allMessages.length;
    
    console.log(`  [${i + 1}/${TEST_COMMANDS.length}] Sending: ${cmd} (${desc})`);
    
    try {
      await listener.say(CHANNEL, cmd);
    } catch (e) {
      console.log(`    ❌ Failed to send: ${e.message}`);
      results.push({ cmd, desc, status: 'SEND_FAILED', error: e.message });
      continue;
    }

    // Wait for response
    await sleep(3000);

    const newMessages = allMessages.slice(msgCountBefore);
    const botReplies = newMessages.filter(m => 
      !m.self && 
      (m.from.toLowerCase() === BOT_USER.toLowerCase() || 
       m.from.toLowerCase() === CHANNEL.toLowerCase())
    );

    if (botReplies.length > 0) {
      const reply = botReplies.map(r => r.message).join(' | ');
      results.push({ cmd, desc, status: 'OK', reply: reply.slice(0, 120) });
      console.log(`    ✅ Got reply: ${reply.slice(0, 100)}`);
    } else if (expectReply) {
      results.push({ cmd, desc, status: 'NO_REPLY', reply: null });
      console.log(`    ⚠️  No reply received (expected one)`);
    } else {
      results.push({ cmd, desc, status: 'OK_NO_REPLY', reply: null });
      console.log(`    ℹ️  No reply (none expected)`);
    }
  }

  // Step 4: Summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  const ok = results.filter(r => r.status === 'OK' || r.status === 'OK_NO_REPLY');
  const noReply = results.filter(r => r.status === 'NO_REPLY');
  const failed = results.filter(r => r.status === 'SEND_FAILED');

  console.log(`  ✅ Working: ${ok.length}`);
  console.log(`  ⚠️  No reply: ${noReply.length}`);
  console.log(`  ❌ Send failed: ${failed.length}`);
  console.log('');

  if (noReply.length > 0) {
    console.log('Commands with NO REPLY (these are broken):');
    for (const r of noReply) {
      console.log(`  - ${r.cmd} (${r.desc})`);
    }
    console.log('');
    console.log('DIAGNOSIS:');
    console.log('  If ALL commands got no reply → StreamWeaver is not running or not connected to Twitch');
    console.log('  If SOME commands got no reply → Those specific handlers are broken');
    console.log('  Check: fly logs -a streamweaver-new');
  }

  if (ok.length > 0) {
    console.log('\nWorking commands:');
    for (const r of ok) {
      console.log(`  ✅ ${r.cmd} → ${r.reply || '(no reply expected)'}`);
    }
  }

  // Save results
  const reportPath = path.join(__dirname, 'test-commands-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ 
    timestamp: new Date().toISOString(),
    channel: CHANNEL,
    bot: BOT_USER,
    results,
    allMessages: allMessages.slice(-50),
  }, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);

  // Disconnect
  await listener.disconnect();
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
