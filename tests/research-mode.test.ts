import assert from 'node:assert/strict';
import test from 'node:test';
import { clearResearchModeStateForTests, detectResearchIntent, hasPendingResearchMode, normalizeResearchSettings, resolveResearchMode } from '../src/services/research-mode';

test('research mode recognizes the requested two-step question phrase', () => {
  assert.deepEqual(detectResearchIntent('Hey Professor Eevee, I have a question', 'Professor Eevee'), { kind: 'arm' });
  assert.deepEqual(
    detectResearchIntent('Professor Eevee, I have a question: what is a voicebank?', 'Professor Eevee'),
    { kind: 'query', query: 'what is a voicebank?' },
  );
});

test('research mode recognizes explicit search requests but not ordinary chat', () => {
  assert.deepEqual(
    detectResearchIntent('Hey Athena, look up the current Vocaloid editor', 'Athena'),
    { kind: 'query', query: 'the current Vocaloid editor' },
  );
  assert.deepEqual(detectResearchIntent('Athena, that song was fun', 'Athena'), { kind: 'none' });
});

test('research settings are bounded and normalized', () => {
  assert.equal(normalizeResearchSettings({}).liveSearchEnabled, false);
  const settings = normalizeResearchSettings({
    enabled: true,
    liveSearchEnabled: false,
    knowledgePacks: ['Vocaloid', 'vocaloid', '../bad'],
    sourceAllowlist: ['VOCALOID.COM'],
    maxResults: 99,
    cacheMinutes: 0,
  });
  assert.equal(settings.liveSearchEnabled, false);
  assert.deepEqual(settings.knowledgePacks, ['vocaloid']);
  assert.deepEqual(settings.sourceAllowlist, ['vocaloid.com']);
  assert.equal(settings.maxResults, 8);
  assert.equal(settings.cacheMinutes, 1);
  assert.equal(normalizeResearchSettings({ liveSearchEnabled: true }).liveSearchEnabled, true);
  clearResearchModeStateForTests();
});

test('Professor Eevee receives the Vocaloid pack through the two-step flow', async () => {
  clearResearchModeStateForTests();
  const base = {
    tenantId: 'research-test-tenant',
    botName: 'Professor Eevee',
    username: 'viewer',
    platform: 'discord',
    channelId: 'research-room',
  };
  const armed = await resolveResearchMode({ ...base, message: 'Hey Professor Eevee, I have a question' });
  assert.equal(armed.kind, 'prompt');
  assert.equal(hasPendingResearchMode(base), true);
  const answer = await resolveResearchMode({ ...base, message: 'What is a Vocaloid voicebank?' });
  assert.equal(answer.kind, 'research');
  if (answer.kind === 'research') {
    assert.equal(answer.query, 'What is a Vocaloid voicebank?');
    assert.ok(answer.sources.some((source) => source.packId === 'vocaloid'));
    assert.match(answer.context, /singing-voice synthesis/i);
  }
});
