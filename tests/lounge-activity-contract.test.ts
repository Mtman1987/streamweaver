import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Twitch !leaderboard routes to the points leaderboard overlay', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /'!leaderboard'.*'!pleader'/s);
  assert.match(dispatcher, /requestedCmd === '!leaderboard' \? '!pleader'/);
});

test('featured chat rejects commands and outside bots while keeping ecosystem voices', () => {
  const route = fs.readFileSync('src/app/api/shared-chat/featured/route.ts', 'utf8');
  const overlay = fs.readFileSync('src/app/overlay/shared-chat-featured/page.tsx', 'utf8');
  assert.match(route, /fallbackToLatest/);
  assert.match(route, /message\.startsWith\('!'\)/);
  assert.match(route, /message\.startsWith\('spmt'\)/);
  assert.match(route, /isKnownBot\(senderName, tenantId\)/);
  assert.match(route, /'stellabot87'/);
  assert.match(route, /'athenabot87'/);
  assert.match(route, /'spacemountainlive'/);
  assert.match(route, /LOUNGE_ECOSYSTEM_VOICES\.has\(name\)/);
  assert.match(route, /entry\.sender\.roles\.includes\('bot'\)/);
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

test('Space Mountain owner and Twitch moderators can control Lounge playback', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /const isHearMeOutOwner = Boolean\(/);
  assert.match(dispatcher, /isSpaceMountainBroadcasterCommand/);
  assert.match(dispatcher, /actualUsername\.toLowerCase\(\) === broadcasterUsername\.toLowerCase\(\)/);
  assert.match(dispatcher, /const canControlHearMeOut = Boolean\(tags\.mod \|\| isHearMeOutOwner\)/);
  assert.match(dispatcher, /actorRole: isHearMeOutOwner \? 'owner'/);
  assert.match(dispatcher, /if \(!canControlHearMeOut\)/);
});

test('Lounge has separate partner and community live shoutout rotations', () => {
  const overlay = fs.readFileSync('src/app/overlay/live-shoutouts/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/live-shoutouts/route.ts', 'utf8');
  assert.match(overlay, /PARTNER SPOTLIGHT/);
  assert.match(overlay, /COMMUNITY LIVE/);
  assert.match(overlay, /group === 'partner' \? 36_000 : 18_000/);
  assert.match(overlay, /setLeaving\(true\)/);
  assert.match(overlay, /slideOut 1\.1s/);
  assert.match(overlay, /right: 8px; top: 7px/);
  assert.match(route, /isPriorityCreator/);
  assert.match(route, /viewerCount/);
  assert.match(route, /discord-stream-hub-new\.fly\.dev\/api\/community-spotlight/);
  assert.match(route, /chat-tag-new\.fly\.dev/);
});

test('Lounge data APIs are public to unauthenticated browser-source overlays', () => {
  const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
  assert.match(middleware, /pathname === '\/api\/lounge\/live-shoutouts'/);
  assert.match(middleware, /pathname === '\/api\/lounge\/status-strip'/);
});

test('top-right strip prioritizes active games then identifies the main spotlight', () => {
  const overlay = fs.readFileSync('src/app/overlay/lounge-status-strip/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/status-strip/route.ts', 'utf8');
  assert.match(overlay, /ACTIVE GAME/);
  assert.match(overlay, /NOW SHOWING/);
  assert.match(overlay, /payload\.games\.length \+ \(payload\.spotlight \? 1 : 0\)/);
  assert.match(overlay, /activeIndex === payload\.games\.length/);
  assert.match(overlay, /rotationCount < 2/);
  assert.match(overlay, /spotlight\.avatarUrl/);
  assert.doesNotMatch(overlay, /Space Mountain Live/);
  assert.match(route, /api\/game-hub\/channel\?channel=spacemountainlive/);
  assert.match(route, /api\/community-spotlight/);
});

test('Lounge live cards use current Twitch live members and DSH group metadata', () => {
  const route = fs.readFileSync('src/app/api/lounge/live-shoutouts/route.ts', 'utf8');
  assert.match(route, /const currentLiveMembers = Array\.isArray\(chatTag\?\.liveMembers\)/);
  assert.match(route, /const dshByLogin = new Map/);
  assert.match(route, /chatTagResult\.status === 'fulfilled'/);
  assert.match(route, /dshByLogin\.get\(login\.toLowerCase\(\)\)/);
});
