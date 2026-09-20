import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Twitch !leaderboard routes to the points leaderboard overlay', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /'!leaderboard'.*'!pleader'/s);
  assert.match(dispatcher, /requestedCmd === '!leaderboard' \? '!pleader'/);
});

test('featured chat supports a visible human-message fallback', () => {
  const route = fs.readFileSync('src/app/api/shared-chat/featured/route.ts', 'utf8');
  const overlay = fs.readFileSync('src/app/overlay/shared-chat-featured/page.tsx', 'utf8');
  assert.match(route, /fallbackToLatest/);
  assert.match(route, /!entry\.sender\.roles\.includes\('bot'\)/);
  assert.match(route, /entry\.text\.trim\(\) \|\| entry\.media\.length/);
  assert.match(overlay, /Waiting for the next community message/);
});

test('featured chat visually matches the Lounge leaderboard and renders rich chat content', () => {
  const overlay = fs.readFileSync('src/app/overlay/shared-chat-featured/page.tsx', 'utf8');
  assert.match(overlay, /SPACE MOUNTAIN CHAT/);
  assert.match(overlay, /linear-gradient\(150deg/);
  assert.match(overlay, /border: 2px solid #25e9ff/);
  assert.match(overlay, /event\.sender\.avatarUrl/);
  assert.match(overlay, /displayBadges\.map/);
  assert.match(overlay, /messageParts\(event\)/);
  assert.match(overlay, /media-preview/);
});

test('command leaderboard fills the compact activity panel', () => {
  const overlay = fs.readFileSync('src/app/overlay/leaderboard/page.tsx', 'utf8');
  assert.match(overlay, /position: 'fixed', inset: 0/);
  assert.match(overlay, /15000/);
});

test('Lounge Stella is scaled down and lifted onto the lower panel edge', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(player, /loungePlacement \? 210 : 300/);
  assert.match(player, /loungePlacement \? 115 : 0/);
  assert.match(player, /loungePlacement \? -35 : 0/);
});

test('Lounge Stella captions stay inside the main panel and clamp to three lines', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(player, /left: loungePlacement \? '23%'/);
  assert.match(player, /right: loungePlacement \? '29%'/);
  assert.match(player, /bottom: loungePlacement \? '32%'/);
  assert.match(player, /WebkitLineClamp: 3/);
});

test('Lounge gamble results temporarily fill the Chat Tag panel', () => {
  const overlay = fs.readFileSync('src/app/gamble-overlay/page.tsx', 'utf8');
  assert.match(overlay, /get\('placement'\) === 'lounge-tag'/);
  assert.match(overlay, /width: loungeTag \? '100%'/);
  assert.match(overlay, /height: loungeTag \? '100%'/);
  assert.match(overlay, /fontSize: loungeTag \? 24 : 72/);
});

test('Lounge card reveals scale to fit the main stage', () => {
  const overlay = fs.readFileSync('src/app/card-pack-overlay/page.tsx', 'utf8');
  assert.match(overlay, /get\('placement'\) === 'lounge-main'/);
  assert.match(overlay, /loungeMain \? 'scale\(0\.69\)'/);
});

test('Twitch social commands publish an overlay event before replying', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  const twitchSocial = dispatcher.slice(dispatcher.indexOf("platform: 'twitch'"));
  assert.match(twitchSocial, /isSocialOverlayCommand\(cmdName\)/);
  assert.match(twitchSocial, /publishSocialOverlayEvent\(\{/);
  assert.ok(
    twitchSocial.indexOf('publishSocialOverlayEvent({') < twitchSocial.indexOf("await reply(response, 'bot')"),
    'the Twitch social animation must publish before the chat reply',
  );
});

test('Twitch HearMeOut commands acknowledge and bridge both global queues', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /\^!\(sr\|wr\|play\|pause\|stop\|skip\|next\|np\|nowplaying\|mute\|unmute\|volume\)/);
  assert.match(dispatcher, /!\$\{command\} received/);
  assert.match(dispatcher, /sessionId = command === 'sr' \? 'discord-music-room' : 'discord-watch-room'/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /action: 'hmo\.media\.control'/);
  assert.doesNotMatch(dispatcher, /HearMeOut's Twitch bot listens directly for !sr/);
});

test('Lounge has separate partner and community live shoutout rotations', () => {
  const overlay = fs.readFileSync('src/app/overlay/live-shoutouts/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/live-shoutouts/route.ts', 'utf8');
  assert.match(overlay, /PARTNER SPOTLIGHT/);
  assert.match(overlay, /COMMUNITY LIVE/);
  assert.match(overlay, /group === 'partner' \? 18_000 : 9_000/);
  assert.match(route, /isPriorityCreator/);
  assert.match(route, /viewerCount/);
});

test('top-right strip prioritizes active games then identifies the main spotlight', () => {
  const overlay = fs.readFileSync('src/app/overlay/lounge-status-strip/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/status-strip/route.ts', 'utf8');
  assert.match(overlay, /ACTIVE GAME/);
  assert.match(overlay, /NOW SHOWING/);
  assert.match(overlay, /spotlight\.avatarUrl/);
  assert.match(route, /api\/game-hub\/channel\?channel=spacemountainlive/);
  assert.match(route, /api\/community-spotlight/);
});
