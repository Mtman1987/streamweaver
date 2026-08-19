'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Athena is pinned to one Deepgram Aura-2 identity across direct and LiveKit paths', () => {
  const voices = read('src/lib/tts-voices.ts');
  const provider = read('src/services/tts-provider.ts');
  const bots = read('src/app/api/spmt/bots/route.ts');
  assert.match(voices, /ATHENA_CANONICAL_TTS_VOICE = 'deepgram:aura-2:athena'/);
  assert.match(voices, /ATHENA_DEEPGRAM_TTS_MODEL = 'aura-2-athena-en'/);
  assert.match(voices, /ATHENA_LIVEKIT_TTS_DESCRIPTOR = 'deepgram\/aura-2:athena'/);
  assert.match(provider, /tenantId === ATHENA_TENANT_ID[\s\S]{0,100}ATHENA_CANONICAL_TTS_VOICE/);
  assert.match(provider, /api\.deepgram\.com\/v1\/speak/);
  assert.match(provider, /selected\.provider === 'deepgram'\) return \[\]/);
  assert.match(bots, /tenantId === ATHENA_TENANT_ID \? ATHENA_CANONICAL_TTS_VOICE/);
});

test('other tenant personas keep their configured voice and interests', () => {
  const bots = read('src/app/api/spmt/bots/route.ts');
  assert.match(bots, /: firstString\(settings\.voice\)/);
  assert.match(bots, /interests: splitInterests\(settings\.interests\)/);
});
