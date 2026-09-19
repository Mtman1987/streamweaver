import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const middleware = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf8');

test('legacy and canonical card-pack overlay surfaces stay public', () => {
  assert.match(middleware, /'\/card-pack-overlay'/);
  assert.match(middleware, /pathname\.startsWith\('\/overlay\/'\)/);
  assert.match(middleware, /'\/card-pack-overlay'[\s\S]*'\/pokemon-overlay'/);
});
