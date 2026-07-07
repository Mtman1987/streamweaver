import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCORD_UNSUPPORTED_COMMAND_MESSAGES,
  buildDiscordAdminCommandsSummary,
  buildDiscordCommandsSummary,
} from '../src/services/discord-command-catalog';

test('discord command summary includes highfive and commands', () => {
  const summary = buildDiscordCommandsSummary();
  assert.match(summary, /!highfive/);
  assert.match(summary, /!commands/);
  assert.match(summary, /Discord commands/);
});

test('discord admin summary respects mod visibility', () => {
  assert.equal(buildDiscordAdminCommandsSummary({ isMod: false }), 'Only mods can view admin Discord commands.');
  assert.match(buildDiscordAdminCommandsSummary({ isMod: true }), /!timeout <user> \[duration\] \[reason\]/);
  assert.equal(DISCORD_UNSUPPORTED_COMMAND_MESSAGES.setgame, 'Setting stream game from Discord is disabled here.');
});
