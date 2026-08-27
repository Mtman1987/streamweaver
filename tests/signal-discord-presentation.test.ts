import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const patch = fs.readFileSync(path.join(root, 'scripts/patch-signal-discord-presentation.mjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('Discord Signal is presented as the invoking user with the Community Spotlight badge', () => {
  assert.match(patch, /SIGNAL_COMMUNITY_SPOTLIGHT_GIF_URL = 'https:\/\/cdn\.discordapp\.com\/emojis\/1284931162896334929\.gif'/);
  assert.match(patch, /webhookAvatarUrl = String\(input\.sourceUserAvatarUrl \|\| ''\)/);
  assert.match(patch, /input\.msg\.member\?\.displayName/);
  assert.match(patch, /input\.msg\.author\?\.globalName/);
  assert.match(patch, /thumbnail: \{ url: signalBadgeUrl \}/);
  assert.match(patch, /footer: \{ text: 'SIGNAL LOCKED • MESSAGE ACQUIRED' \}/);
  assert.doesNotMatch(patch, /signalBadgeUrl \|\| input\.sourceUserAvatarUrl/);
});

test('Discord ingress avatar is propagated into the command message before Signal handling', () => {
  assert.match(patch, /userAvatar,\n        avatarUrl: userAvatar,/);
  assert.match(patch, /avatarUrl: userAvatar,\n          bot: false/);
});

test('production Fly image applies the Signal presentation patch after the existing Signal runtime patch', () => {
  assert.match(
    dockerfile,
    /npm run prebuild:simple && node scripts\/patch-signal-discord-presentation\.mjs && node scripts\/patch-signal-carrier-join-hardening\.mjs/,
  );
});
