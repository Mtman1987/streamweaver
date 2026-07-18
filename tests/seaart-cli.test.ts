import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSeaArtCliImageUrls } from '../src/services/seaart-cli';

test('extracts image URLs from SeaArt CLI JSON and streamed output', () => {
  const output = [
    'data: {"status":"running","progress":50}',
    '{"result":{"images":[{"url":"https://image.cdn2.seaart.me/a.webp"}]}}',
    'completed: https://image.cdn2.seaart.me/b.png',
  ].join('\n');

  assert.deepEqual(extractSeaArtCliImageUrls(output), [
    'https://image.cdn2.seaart.me/a.webp',
    'https://image.cdn2.seaart.me/b.png',
  ]);
});

test('does not mistake API links for generated images', () => {
  assert.deepEqual(extractSeaArtCliImageUrls('docs: https://www.seaart.ai/api/v1/task'), []);
});
