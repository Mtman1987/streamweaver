import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCardPackEvent, buildCardPackRenderUrl, resolveCardPackGame } from '../src/lib/card-pack-event';
import { cardPackOverlayAliases, getPendingCardPack, rememberPendingCardPack } from '../src/services/card-pack-overlay-state';

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

test('Quackverse canonical broadcast retains its own card backs', () => {
  const canonical = normalizeCardPackEvent({ source: 'quackverse', cards: [{ name: 'Duck', imageUrl: 'https://example.test/q.png' }] });
  assert.equal(resolveCardPackGame({ type: 'card-pack-opened', payload: canonical }), 'quackverse');
  assert.equal(resolveCardPackGame({ type: 'quackverse-pack-opened', payload: canonical }), 'quackverse');
  assert.equal(resolveCardPackGame({ type: 'card-pack-opened', payload: { game: 'pokemon' } }), 'pokemon');
});

test('one overlay accepts canonical and legacy pack events during migration', async () => {
  const overlay = await read('src/app/card-pack-overlay/page.tsx');
  assert.match(overlay, /card-pack-opened/);
  assert.match(overlay, /pokemon-pack-opened/);
  assert.match(overlay, /quackverse-pack-opened/);
  assert.match(overlay, /phase === 'feature'/);
  assert.match(overlay, /CardBack/);
  assert.match(overlay, /user-profile/);
  assert.match(overlay, /avatarUrl/);
});

test('Pokemon automation paths send tenant-scoped canonical pack events', async () => {
  const legacy = await read('src/services/automation/subactions/PokemonHandlers.ts');
  const executor = await read('src/services/automation/SubActionExecutor.ts');
  const routes = await read('src/server/routes.ts');
  assert.match(legacy, /card-pack-opened/);
  assert.match(legacy, /context\?\.tenantId/);
  assert.match(executor, /card-pack-opened/);
  assert.match(executor, /context\.tenantId/);
  assert.match(routes, /card-pack-opened/);
});

test('Discord pack reveal queues a GIF and preserves its old edit path as fallback', async () => {
  const source = await read('src/services/discord-pack-reveal.ts');
  assert.match(source, /queueCardPackGif/);
  assert.match(source, /waitForCardPackGif/);
  assert.match(source, /legacyFallback/);
  assert.match(source, /imageUrl: gifUrl/);
});


test('card pack overlay aliases include internal tenant and Twitch channel login', () => {
  assert.deepEqual(
    cardPackOverlayAliases({ tenantId: '489668931', channel: '#SpaceMountainLive', platform: 'twitch' }),
    ['489668931', 'spacemountainlive'],
  );
});

test('recent card pack events replay to reconnecting overlay sockets', () => {
  const event = { type: 'card-pack-opened', payload: { eventId: 'pack-replay-test' } };
  rememberPendingCardPack('SpaceMountainLive', event);
  assert.deepEqual(getPendingCardPack('spacemountainlive'), event);
});

test('websocket connection replays a recent pack event', async () => {
  const socket = await read('src/server/websocket.ts');
  assert.match(socket, /getPendingCardPack/);
  assert.match(socket, /pendingCardPack/);
});

test('Pokemon automation paths fan out to Twitch channel aliases', async () => {
  const legacy = await read('src/services/automation/subactions/PokemonHandlers.ts');
  const executor = await read('src/services/automation/SubActionExecutor.ts');
  assert.match(legacy, /cardPackOverlayAliases/);
  assert.match(legacy, /context\?\.channel/);
  assert.match(executor, /cardPackOverlayAliases/);
  assert.match(executor, /context\?\.channel/);
});


test('Discord Pokemon pack reveal starts with three-column card fields and later edits in the GIF', async () => {
  const source = await read('src/services/discord-pack-reveal.ts');
  assert.match(source, /function cardInfoFields/);
  assert.match(source, /inline: true/);
  assert.match(source, /first\.fields/);
  assert.match(source, /imageUrl: gifUrl/);
});

test('Twitch Pokemon pack openings queue GIF recording with the broadcaster alias', async () => {
  const legacy = await read('src/services/automation/subactions/PokemonHandlers.ts');
  const executor = await read('src/services/automation/SubActionExecutor.ts');
  assert.match(legacy, /queueCardPackGif\(canonical, captureTenant\)/);
  assert.match(executor, /queueCardPackGif\(canonical, captureTenant\)/);
});

test('captured pack render can carry the broadcaster tenant and pack front prefers the avatar', async () => {
  const event = await read('src/lib/card-pack-event.ts');
  const overlay = await read('src/app/card-pack-overlay/page.tsx');
  assert.match(event, /tenantParam/);
  assert.match(event, /buildCardPackRenderUrl\(event: CardPackOpenedEvent, tenantId\?: string\)/);
  assert.match(overlay, /avatarUrl \? \(/);
  assert.match(overlay, /rounded-full/);
});
