import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('the built-in HearMeOut !play command is disabled in the default command catalog', () => {
  const file = path.join(process.cwd(), 'commands', 'play-hearmeout-system.json');
  const command = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

  assert.equal(command.id, 'hearmeout-play-system');
  assert.equal(command.command, '!play');
  assert.equal(command.enabled, false);
  assert.match(String(command.description), /HearMeOut/i);
});

test('the tenant override uses the same stable command ID and can disable !play', () => {
  const file = path.join(process.cwd(), '.github', 'workflows', 'disable-tenant-play.yml');
  const workflow = fs.readFileSync(file, 'utf8');

  assert.match(workflow, /tenant_id.*428161033/);
  assert.match(workflow, /the_lovely_princess_snow/);
  assert.match(workflow, /hearmeout-play-system/);
  assert.match(workflow, /"enabled": false/);
});
