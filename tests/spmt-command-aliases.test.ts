import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteSpmtLegacyAlias } from '../src/services/spmt-command-aliases';

test('canonical SPMT aliases preserve legacy handlers without stealing Nebula roots', () => {
  assert.equal(rewriteSpmtLegacyAlias('spmt points'), '!points');
  assert.equal(rewriteSpmtLegacyAlias('spmt hug @viewer'), '!hug @viewer');
  assert.equal(rewriteSpmtLegacyAlias('spmt shoutout @creator'), '!so @creator');
  assert.equal(rewriteSpmtLegacyAlias('spmt image moon dragon'), '!img moon dragon');
  assert.equal(rewriteSpmtLegacyAlias('spmt translate es hello there'), '!t es hello there');
  assert.equal(rewriteSpmtLegacyAlias('spmt media song Space Oddity'), '!sr Space Oddity');
  assert.equal(rewriteSpmtLegacyAlias('spmt media movie Space Jam'), '!wr Space Jam');
  assert.equal(rewriteSpmtLegacyAlias('spmt media skip'), '!skip');
  assert.equal(rewriteSpmtLegacyAlias('spmt pokemon pack base set'), '!pack base set');
  assert.equal(rewriteSpmtLegacyAlias('spmt pokemon show Pikachu'), '!show Pikachu');
  assert.equal(rewriteSpmtLegacyAlias('spmt economy gamble 100'), '!gamble 100');
  assert.equal(rewriteSpmtLegacyAlias('spmt checkin'), '!checkin');
  assert.equal(rewriteSpmtLegacyAlias('spmt mtfixit video froze'), '!mtfixit video froze');

  for (const command of [
    'spmt stop',
    'spmt pack',
    'spmt card',
    'spmt show all',
    'spmt view 1',
    'spmt join',
    'spmt leave',
    'spmt mosaic kitten',
    'spmt ghost',
  ]) assert.equal(rewriteSpmtLegacyAlias(command), null, command);
});
