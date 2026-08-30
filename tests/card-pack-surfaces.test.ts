import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCardPackEvent, buildCardPackRenderUrl } from '../src/lib/card-pack-event';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pokemon and Quackverse normalize to one card-pack-opened contract', () => {
  const pokemon = normalizeCardPackEvent({
    eventId: 'pk-1', game: 'pokemon', username: 'ash', setName: 'Base',
    cards: [
      { name: 'Common', rarity: 'Common', imageUrl: 'https://example.test/a.png' },
      { name: 'Rare', rarity: 'Rare Holo', imageUrl: 'https://example.test/b.png' },
    ],
  });
  const quackverse = normalizeCardPackEvent({
    eventId: 'qv-1', source: 'quackverse', username: 'duck', setName: 'Quackverse',
    pack: [{ id: '3', name: 'Duck', rarity: 'Epic', cardImageUrl: 'https://example.test/q.png' }],
  });
  assert.equal(pokemon.type, 'card-pack-opened');
  assert.equal(pokemon.game, 'pokemon');
  assert.equal(pokemon.featureCard?.name, 'Rare');
  assert.equal(quackverse.type, 'card-pack-opened');
  assert.equal(quackverse.game, 'quackverse');
  assert.equal(quackverse.cards[0].imageUrl, 'https://example.test/q.png');
  assert.match(buildCardPackRenderUrl(quackverse), /\/overlay\/card-pack\?/);
});

test('one overlay accepts canonical and legacy pack events during migration', async () => {
  const overlay = await read('src/app/card-pack-overlay/page.tsx');
  assert.match(overlay, /card-pack-opened/);
  assert.match(overlay, /pokemon-pack-opened/);
  assert.match(overlay, /quackverse-pack-opened/);
  assert.match(overlay, /phase === 'feature'/);
});

test('Discord pack reveal queues a GIF and preserves its old edit path as fallback', async () => {
  const source = await read('src/services/discord-pack-reveal.ts');
  assert.match(source, /queueCardPackGif/);
  assert.match(source, /waitForCardPackGif/);
  assert.match(source, /legacyFallback/);
  assert.match(source, /imageUrl: gifUrl/);
});
