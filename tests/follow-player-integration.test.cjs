const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('follow visuals and original audio use the existing tenant-scoped Shoutout Player', () => {
 const player=fs.readFileSync('src/app/shoutout-player/page.tsx','utf8');
 const follow=fs.readFileSync('src/components/FollowAlertPlayer.tsx','utf8');
 const urls=fs.readFileSync('src/app/(app)/overlay-urls/page.tsx','utf8');
 assert.match(player,/<FollowAlertPlayer \/>/);
 assert.match(follow,/getOverlayTenantId\(\)/);
 assert.match(follow,/video.current.play\(\)/);
 assert.match(follow,/onEnded=/);
 assert.match(follow,/api\/overlay\/follow\/media/);
 assert.doesNotMatch(follow,/playsInline muted|muted=\{true\}/);
 assert.match(urls,/name: 'Shoutout Player'/);
 assert.match(urls,/!followtest plays the same follow alert/);
});
