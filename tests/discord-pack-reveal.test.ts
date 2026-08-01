import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPackGrid, packRevealRows, type PackRevealCard } from '../src/services/discord-pack-reveal';

const cards: PackRevealCard[] = Array.from({ length: 9 }, (_, index) => ({
  name: `Card ${index + 1}`,
  imageUrl: `https://cards.test/${index + 1}.png`,
}));

test('nine cards split into three rows of three', () => {
  const rows = packRevealRows(cards);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.length), [3, 3, 3]);
});

test('only the highlighted row is rendered bright', () => {
  const grid = formatPackGrid(cards, 1).split('\n');
  assert.equal(grid[0], '```ansi');
  assert.match(grid[1], /^\u001b\[0;37mCard 1/);
  assert.match(grid[2], /^\u001b\[1;33mCard 4/);
  assert.match(grid[3], /^\u001b\[0;37mCard 7/);
});

test('a highlight row of -1 dims every row', () => {
  const grid = formatPackGrid(cards, -1);
  assert.equal(grid.includes('\u001b[1;33m'), false);
});
