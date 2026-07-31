import assert from 'node:assert/strict';
import test from 'node:test';
import { POKEMON_PACK_SIZE } from '../src/services/pokemon-packs';

test('Pokémon boosters retain their nine-card pack contract', () => {
  assert.equal(POKEMON_PACK_SIZE, 9);
});
