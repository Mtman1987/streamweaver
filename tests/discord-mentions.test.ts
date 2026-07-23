import test from 'node:test';
import assert from 'node:assert/strict';

import {
  replaceDiscordUserMentions,
  resolveDiscordUserMention,
} from '../src/services/discord-mentions';

test('Discord user mention IDs are replaced with names for commands and speech', () => {
  const mentions = {
    users: {
      '76543628114': { username: 'mtman1987', global_name: 'Mtman' },
    },
  };

  assert.equal(
    replaceDiscordUserMentions('spmt tag <@76543628114>', mentions),
    'spmt tag @Mtman',
  );
  assert.deepEqual(resolveDiscordUserMention('<@76543628114>', mentions), {
    userId: '76543628114',
    displayName: 'Mtman',
  });
});

test('unresolved Discord mention IDs stay intact instead of becoming bare numbers', () => {
  assert.equal(
    replaceDiscordUserMentions('hello <@76543628114>', {}),
    'hello <@76543628114>',
  );
});
