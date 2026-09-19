import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');

test('SpaceMountainLive Stella mentions bypass generic bot routing and queue Lounge TTS', () => {
  assert.match(dispatcher, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(dispatcher, /\(\^\|\\W\)stella\(\\W\|\$\)/i);
  assert.match(dispatcher, /queueTtsOverlay\(aiReply, SPACEMOUNTAIN_SYSTEM_TENANT_ID\)/);
  assert.match(dispatcher, /Stella answered @/);
});
