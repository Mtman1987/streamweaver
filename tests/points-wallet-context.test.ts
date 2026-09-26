import test from 'node:test';
import assert from 'node:assert/strict';
import { getPointsWalletContext } from '../src/services/points-wallet-context';

test('a Twitch pack selection uses the same channel wallet as !points', () => {
  const chatWallet = { tenantId: 'spacemountainlive', username: 'spacemountainlive' };
  assert.deepEqual(getPointsWalletContext('spacemountainlive', 'spacemountainlive'), chatWallet);
  assert.deepEqual(getPointsWalletContext('spacemountainlive', undefined, ''), chatWallet);
});

test('an unresolved numeric tenant cannot silently spend from an empty wallet', () => {
  assert.throws(() => getPointsWalletContext('94371378'), /Cannot resolve points wallet/);
  assert.deepEqual(getPointsWalletContext('94371378', 'Mtman1987'), { tenantId: '94371378', username: 'mtman1987' });
});
