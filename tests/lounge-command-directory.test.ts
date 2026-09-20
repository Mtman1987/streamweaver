import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoungeCategoryReplies,
  buildLoungeCommandMenu,
  LOUNGE_COMMAND_CATEGORIES,
} from '../src/lib/lounge-command-directory';
import {
  beginLoungeCommandMenu,
  consumeLoungeCommandMenuChoice,
  directLoungeCommandCategory,
  resetLoungeCommandMenusForTests,
} from '../src/services/lounge-command-menu';

test('the Lounge directory covers every live command-owning service', () => {
  assert.deepEqual(LOUNGE_COMMAND_CATEGORIES.map((category) => category.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  const services = new Set(LOUNGE_COMMAND_CATEGORIES.flatMap((category) => category.commands.map((command) => command.service)));
  for (const service of ['Lounge', 'StreamWeaver', 'HearMeOut', 'Nebula Arcade', 'DiscordStreamHub', 'Twitch']) {
    assert.ok(services.has(service as any), `${service} is missing from the command directory`);
  }
  const commands = LOUNGE_COMMAND_CATEGORIES.flatMap((category) => category.commands.map((command) => command.command)).join(' ');
  for (const command of ['!sr', '!wr', '!mosaic', 'spmt join', '!img', '!mtfixit', '/w']) assert.match(commands, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the top menu stays within one Twitch message and category pages stay bounded', () => {
  assert.ok(buildLoungeCommandMenu().length <= 500);
  for (const category of LOUNGE_COMMAND_CATEGORIES) {
    const replies = buildLoungeCategoryReplies(category.number, true);
    assert.ok(replies.length >= 1);
    for (const reply of replies) assert.ok(reply.length <= 500, `${category.name} produced an oversized reply`);
  }
});

test('a bare number only works for the same viewer after opening !commands', () => {
  resetLoungeCommandMenusForTests();
  const viewer = { platform: 'twitch' as const, tenantId: 'spacemountainlive', channelId: '#spacemountainlive', username: 'viewer', isMod: false };
  const other = { ...viewer, username: 'other' };
  beginLoungeCommandMenu(viewer, 1_000);
  assert.equal(consumeLoungeCommandMenuChoice('3', other, 2_000), null);
  assert.match(consumeLoungeCommandMenuChoice('3', viewer, 2_000)?.[0] || '', /Media & Lounge/);
  assert.equal(consumeLoungeCommandMenuChoice('3', viewer, 3_000), null);
});

test('!commands number works without pending state and hides restricted commands', () => {
  const publicReplies = directLoungeCommandCategory('!commands 3', false) || [];
  assert.match(publicReplies.join(' '), /!sr/);
  assert.doesNotMatch(publicReplies.join(' '), /!pause/);
  assert.match((directLoungeCommandCategory('!commands 8', false) || []).join(' '), /only shown to channel moderators/);
  assert.match((directLoungeCommandCategory('!commands 8', true) || []).join(' '), /!admin/);
});
