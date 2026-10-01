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
  assert.match(overlay, /display: 'flex', flexDirection: 'column'/);
  assert.match(overlay, /minHeight: 0, flex: 1/);
  assert.match(overlay, /15000/);
});

test('Lounge Stella is scaled down and lifted onto the lower panel edge', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(player, /loungePlacement \? 210 : 300/);
  assert.match(player, /loungePlacement \? 115 : 0/);
  assert.match(player, /loungePlacement \? -35 : 0/);
});

test('SpaceMountain Lounge shoutouts always use full chat plus TTS mode', () => {
  const shoutout = fs.readFileSync('src/services/walk-on-shoutout.ts', 'utf8');
  assert.match(shoutout, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID\) return 'full'/);
});

test('Lounge shoutout TTS carries caption text and switches Stella immediately', () => {
  const shoutout = fs.readFileSync('src/services/walk-on-shoutout.ts', 'utf8');
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(shoutout, /audioUrl: ttsResult\.audioDataUri, text: aiGreeting/);
  assert.match(player, /if \(phaseRef\.current === 'idle'\) \{\s*enterPhase\('talking'\);/);
  assert.doesNotMatch(player, /phaseRef\.current === 'idle' && !boundaryTimerRef\.current/);
});

test('Lounge Stella captions stay inside the main panel and turn full three-line pages', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(player, /left: loungePlacement \? '23%'/);
  assert.match(player, /right: loungePlacement \? '29%'/);
  assert.match(player, /bottom: loungePlacement \? '32%'/);
  assert.match(player, /height: loungePlacement \? '3\.6em'/);
  assert.match(player, /content\.getBoundingClientRect\(\)\.height <= windowElement\.clientHeight/);
  assert.match(player, /setCaptionPageStart\(captionPageStart \+ i\)/);
  assert.match(player, /captionText\.slice\(captionPageStart\)/);
  assert.doesNotMatch(player, /scrollTop =/);
  assert.doesNotMatch(player, /WebkitLineClamp/);
});

test('Lounge TTS layer carries the persistent attribution and alternating contextual marquee', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  const banner = fs.readFileSync('src/components/overlay/lounge-attribution-marquee.tsx', 'utf8');
  const content = fs.readFileSync('src/lib/lounge-marquee.ts', 'utf8');
  const statusRoute = fs.readFileSync('src/app/api/lounge/status-strip/route.ts', 'utf8');
  assert.match(player, /<LoungeAttributionMarquee \/>/);
  assert.match(banner, /POWERED BY SPACEMOUNTAIN\.LIVE/);
  assert.match(banner, /Built by Mtman1987/);
  assert.match(banner, /space-logo-main\.png/);
  assert.match(banner, /width: min\(230px/);
  assert.match(banner, /right: 10px/);
  assert.match(banner, /\.lounge-credit::before[\s\S]*opacity: 0/);
  assert.match(banner, /\.expanded::before \{ opacity: 1; \}/);
  assert.match(banner, /\.expanded \.brand[\s\S]*background: linear-gradient/);
  assert.match(banner, /\.expanded \{ width: calc\(100vw - 20px\); height: 34px/);
  assert.doesNotMatch(banner, /transition:.*height/);
  assert.match(banner, /logo-fallback/);
  assert.match(content, /10 \* 60 \* 1000/);
  assert.match(content, /cycle % 2 === 0 \? 'commands' : 'thanks'/);
  assert.match(content, /'general', 'social', 'collecting', 'community'/);
  assert.match(content, /LOUNGE_MEDIA_COMMANDS/);
  assert.match(statusRoute, /playerCommands/);
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
  assert.match(dispatcher, /\^!\(sr\|wr\|music\|songs\|movie\|movies\|play\|pause\|stop\|skip\|next\|clear\|np\|nowplaying\|mute\|unmute\|volume\|radio\|autoradio\)/);
  assert.match(dispatcher, /!\$\{command\} received/);
  assert.match(dispatcher, /roomId = SPACEMOUNTAIN_LOUNGE_ROOM_ID/);
  assert.match(fs.readFileSync('src/lib/spacemountain-lounge.ts', 'utf8'), /SPACEMOUNTAIN_LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge'/);
  assert.match(dispatcher, /lane = command === 'wr' \? 'movie' : 'music'/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /action: 'hmo\.media\.control'/);
  assert.match(dispatcher, /const requestedLane =/);
  assert.match(dispatcher, /const isLaneSwitch =/);
  assert.match(dispatcher, /other\.state\?\.playback\?\.status === 'playing'/);
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
  assert.match(overlay, /group === 'partner' \? 36_000 : 18_000/);
  assert.match(overlay, /setLeaving\(true\)/);
  assert.match(overlay, /slideOut 1\.1s/);
  assert.match(overlay, /right: 8px; top: 7px/);
  assert.match(overlay, /padding-top: 22px/);
  assert.doesNotMatch(overlay, /PARTNER SPOTLIGHT|COMMUNITY LIVE/);
  assert.match(overlay, /creator\.gameName \|\| 'Live on Twitch'/);
  assert.doesNotMatch(overlay, /creator\.gameName \|\| 'Just Chatting'/);
  assert.match(overlay, /creator\.viewerCount === null/);
  assert.doesNotMatch(overlay, /creator\.gameName \|\| creator\.title/);
  assert.match(route, /isPriorityCreator/);
  assert.match(route, /viewerCount/);
  assert.match(route, /discord-stream-hub-new\.fly\.dev\/api\/community-spotlight/);
  assert.doesNotMatch(route, /chat-tag-new\.fly\.dev|CHAT_TAG_URL|api\/discord\/live-members/);
});

test('Lounge data APIs are public to unauthenticated browser-source overlays', () => {
  const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
  assert.match(middleware, /pathname === '\/api\/lounge\/live-shoutouts'/);
  assert.match(middleware, /pathname === '\/api\/lounge\/status-strip'/);
});

test('top-right strip rotates games, events, spotlight, lounge worker media, and local/UTC time', () => {
  const overlay = fs.readFileSync('src/app/overlay/lounge-status-strip/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/status-strip/route.ts', 'utf8');
  assert.match(overlay, /NOW PLAYING/);
  assert.match(overlay, /NOW STREAMING/);
  assert.match(overlay, /NOW LISTENING/);
  assert.match(overlay, /NOW WATCHING/);
  assert.match(overlay, /payload\.games\.length \+ payload\.events\.length \+ \(payload\.spotlight \? 1 : 0\) \+ \(payload\.media \? 1 : 0\) \+ 1/);
  assert.match(overlay, /activeIndex - payload\.games\.length/);
  assert.match(overlay, /spotlightIndex = payload\.games\.length \+ payload\.events\.length/);
  assert.match(overlay, /rotationCount < 2/);
  assert.match(overlay, /spotlight\.avatarUrl/);
  assert.match(overlay, /STATION TIME/);
  assert.match(overlay, /LOCAL ·/);
  assert.match(overlay, /UTC ·/);
  assert.doesNotMatch(overlay, /Space Mountain Live/);
  assert.match(route, /api\/game-hub\/channel\?channel=spacemountainlive/);
  assert.match(route, /api\/community-spotlight/);
  assert.match(route, /LOUNGE_WORKER_URL.*HMO_LOUNGE_WORKER_URL/);
  assert.match(route, /\$\{LOUNGE_WORKER_URL\}\/lounge\/media\/program/);
  assert.match(route, /active\?\.current\?\.item/);
  assert.doesNotMatch(route, /discord-music-room|discord-watch-room/);
});

test('changing Lounge names and titles auto-fit instead of truncating', () => {
  const autoFit = fs.readFileSync('src/components/overlay/auto-fit-text.tsx', 'utf8');
  const status = fs.readFileSync('src/app/overlay/lounge-status-strip/page.tsx', 'utf8');
  const shoutouts = fs.readFileSync('src/app/overlay/live-shoutouts/page.tsx', 'utf8');
  const featuredChat = fs.readFileSync('src/app/overlay/shared-chat-featured/page.tsx', 'utf8');
  const leaderboard = fs.readFileSync('src/app/overlay/leaderboard/page.tsx', 'utf8');
  assert.match(autoFit, /new ResizeObserver\(fit\)/);
  assert.match(autoFit, /text\.scrollWidth <= available/);
  assert.match(status, /<AutoFitText className="value"/);
  assert.match(shoutouts, /<AutoFitText className="name"/);
  assert.match(shoutouts, /<AutoFitText className="game"/);
  assert.match(featuredChat, /<AutoFitText className="name"/);
  assert.match(leaderboard, /<AutoFitText minFontSize=\{8\} maxFontSize=\{15\}/);
});

test('Lounge media bump supports viewer votes and broadcaster or moderator overrides', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  const state = fs.readFileSync('src/services/lounge-media-layout.ts', 'utf8');
  const route = fs.readFileSync('src/app/api/lounge/media-layout/route.ts', 'utf8');
  const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
  assert.match(dispatcher, /\^!votebump\$/);
  assert.match(dispatcher, /\^!bump\$/);
  assert.match(dispatcher, /getLoungeMediaLayout/);
  assert.match(dispatcher, /!\(media\|hmo\|stream\|live\).*big/);
  assert.match(dispatcher, /!layout\\s\+auto/);
  assert.match(dispatcher, /if \(!canControlHearMeOut\)/);
  assert.match(dispatcher, /voteLoungeMediaLayout/);
  assert.match(dispatcher, /overrideLoungeMediaLayout\('auto'/);
  assert.match(state, /LOUNGE_MEDIA_BUMP_VOTES/);
  assert.match(state, /VOTE_WINDOW_MS = 5 \* 60 \* 1000/);
  assert.match(route, /access-control-allow-origin/);
  assert.match(middleware, /api\/lounge\/media-layout/);
});

test('Lounge live cards use DSH as the live-community source of truth', () => {
  const route = fs.readFileSync('src/app/api/lounge/live-shoutouts/route.ts', 'utf8');
  assert.match(route, /const rows: any\[\] = Array\.isArray\(dsh\?\.users\) \? dsh\.users : \[\]/);
  assert.match(route, /source: 'discord-stream-hub'/);
  assert.match(route, /featured\.gameTitle, row\.gameName, row\.game_name/);
  assert.match(route, /Number\.isFinite\(Number\(featured\.viewerCount \?\? row\.viewerCount\)\)/);
  assert.doesNotMatch(route, /row\.viewerCount \?\? 0/);
  assert.doesNotMatch(route, /CHAT_TAG_URL|chatTagResult|api\/discord\/live-members/);
});


test('walk-on greetings use the shared AI provider instead of an Eden-only greeting path', () => {
  const shoutout = fs.readFileSync('src/services/walk-on-shoutout.ts', 'utf8');
  assert.match(shoutout, /generateAIResponse\(/);
  assert.match(shoutout, /Shared AI greeting provider failed/);
  assert.doesNotMatch(shoutout, /api\.edenai\.run\/v2\/text\/chat/);
});


test('Lounge commercials use a dedicated GIF player and manual BRB has no automatic Spotlight-health trigger', () => {
  const commercial = fs.readFileSync('src/app/commercial-break-player/page.tsx', 'utf8');
  const brb = fs.readFileSync('src/app/brb-player/page.tsx', 'utf8');
  assert.match(commercial, /const GIF_COUNT = 15/);
  assert.match(commercial, /const GIF_DURATION_MS = 12_000/);
  assert.match(commercial, /discord-stream-hub-new\.fly\.dev\/api\/lounge\/brb-gifs/);
  assert.match(commercial, /mediaActive/);
  assert.match(commercial, /audio\.pause\(\)/);
  assert.doesNotMatch(commercial, /clips\.twitch\.tv|playClip\(/);
  assert.doesNotMatch(brb, /startAutomatic|onSpotlightHealth|SPONSOR_GIF_BUFFER_SIZE/);
});


test('public !unmute recovery pulses both Lounge viewers without exposing public mute', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  const mix = fs.readFileSync('src/services/lounge-audio-mix.ts', 'utf8');
  const directory = fs.readFileSync('src/lib/lounge-command-directory.ts', 'utf8');
  assert.match(dispatcher, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID && command === 'unmute'/);
  assert.match(dispatcher, /sessionId: 'discord-music-room'[\s\S]*control: 'unmute'/);
  assert.match(dispatcher, /sessionId: 'discord-watch-room'[\s\S]*control: 'unmute'/);
  assert.match(dispatcher, /pulseLoungePlaybackUnmute\(\)/);
  assert.match(dispatcher, /command === 'mute' && !canControlHearMeOut/);
  assert.match(mix, /unmutePulseAt: number/);
  assert.match(mix, /now - state\.unmutePulseAt < 3_000/);
  assert.match(directory, /!unmute[\s\S]*Retry audio for both Lounge video players/);
});


test('Lounge audio unlock pulse reaches Stella and public chat TTS', () => {
  const hook = fs.readFileSync('src/lib/lounge-broadcast-volume.ts', 'utf8');
  const stella = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  const say = fs.readFileSync('src/app/say-player/page.tsx', 'utf8');
  assert.match(hook, /spmt-lounge-unmute-pulse/);
  assert.match(hook, /streamweaver:lounge-audio-unlock/);
  assert.match(stella, /streamweaver:lounge-audio-unlock/);
  assert.match(say, /streamweaver:lounge-audio-unlock/);
});


test('commercial-break-player is an overlay-document route so idle frames are truly transparent', () => {
  const mode = fs.readFileSync('src/components/overlay-document-mode.tsx', 'utf8');
  assert.match(mode, /'\/commercial-break-player'/);
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  assert.match(css, /html\.overlay-document,[\s\S]*background: transparent !important/);
});


test('commercial state never extends an active break from duplicate EventSub notifications', () => {
  const state = fs.readFileSync('src/services/commercial-break.ts', 'utf8');
  assert.match(state, /reason: 'active-duplicate'/);
  assert.doesNotMatch(state, /extended-active-window/);
  assert.doesNotMatch(state, /Math\.max\(current\.activeUntil, candidateUntil\)/);
  assert.match(state, /hardActiveCap/);
  assert.match(state, /state\.breakStartedAt \+ Math\.max\(COMMERCIAL_MIN_ACTIVE_MS/);
});
