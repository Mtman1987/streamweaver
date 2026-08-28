import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const route = fs.readFileSync(path.resolve(process.cwd(), 'src/app/api/discord/chat/route.ts'), 'utf8');
const privacyPatch = fs.readFileSync(path.resolve(process.cwd(), 'scripts/patch-private-dm-privacy.mjs'), 'utf8');

test('permanent Discord owner does not depend on a browser SPMT session lookup', () => {
  assert.match(route, /PERMANENT_OWNER_DISCORD_IDS/);
  assert.match(route, /matchedBy: 'permanent-owner'/);
  assert.match(route, /permanentOwner\s*\? \{ isAdmin: true, isMod: true, isOwner: true/);
});

test('permanent Discord owner resolves before Discord author tenant lookup', () => {
  const ownerResolution = privacyPatch.indexOf('} else if (permanentOwner) {');
  const authorResolution = privacyPatch.indexOf("tenantResolution = normalized.tenantId ? 'payload' : (tenantId ? 'discord-author' : 'none')");
  assert.ok(ownerResolution >= 0);
  assert.ok(authorResolution > ownerResolution);
  assert.match(privacyPatch, /tenantResolution = 'discord-owner'/);
});
