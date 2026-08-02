import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCORD_UNSUPPORTED_COMMAND_MESSAGES,
  buildDiscordAdminCommandsSummary,
  buildDiscordCommandDirectoryFields,
  buildDiscordCommandsSummary,
} from '../src/services/discord-command-catalog';

test('discord command summary includes highfive and commands', () => {
  const summary = buildDiscordCommandsSummary();
  assert.match(summary, /Choose a category/);
  const fields = buildDiscordCommandDirectoryFields();
  const rendered = fields.map((field) => `${field.name}: ${field.value}`).join('\n');
  assert.match(rendered, /!highfive @user/);
  assert.match(rendered, /!leaderboard/);
  assert.doesNotMatch(rendered, /!hydrate|!stretch|!yes|!yup|!no/);
});

test('discord admin summary respects mod visibility', () => {
  assert.equal(buildDiscordAdminCommandsSummary({ isMod: false }), 'Only mods can view admin Discord commands.');
  assert.match(buildDiscordAdminCommandsSummary({ isMod: true }), /!timeout <user> \[duration\] \[reason\]/);
  assert.equal(DISCORD_UNSUPPORTED_COMMAND_MESSAGES.setgame, 'Setting stream game from Discord is disabled here.');
});
