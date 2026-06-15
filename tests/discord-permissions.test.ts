import test from 'node:test';
import assert from 'node:assert/strict';

import { hasDiscordModAccess } from '../src/services/discord-permissions';

test('discord mod access accepts named permissions and owner flags', () => {
  assert.equal(hasDiscordModAccess({ isOwner: true }), true);
  assert.equal(hasDiscordModAccess({ memberPermissions: ['ManageMessages'] }), true);
  assert.equal(hasDiscordModAccess({ memberPermissions: 'Administrator' }), true);
});

test('discord mod access accepts numeric Discord permission bitfields', () => {
  assert.equal(hasDiscordModAccess({ memberPermissions: String(1n << 13n) }), true);
  assert.equal(hasDiscordModAccess({ memberPermissions: String(1n << 5n) }), true);
});

test('discord mod access rejects ordinary users', () => {
  assert.equal(hasDiscordModAccess({ memberPermissions: ['SendMessages', 'ViewChannel'] }), false);
  assert.equal(hasDiscordModAccess({}), false);
});
