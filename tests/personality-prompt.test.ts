import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonalityPrompt,
  buildRuntimeSystemIdentity,
  NATURAL_DIALOGUE_POLICY,
  PERSONALITY_RUNTIME_VERSION,
  shouldIncludeExtendedPersonality,
  splitPersonalityPrompt,
} from '../src/lib/personality-prompt';

test('compiles compact identity with the latest runtime policy without changing extended tenant guidance', () => {
  const result = splitPersonalityPrompt('You are Athena.\n---\nVOICE:\n- dry and warm');
  assert.match(result.systemIdentity, /^You are Athena\./);
  assert.match(result.systemIdentity, new RegExp(PERSONALITY_RUNTIME_VERSION));
  assert.match(result.systemIdentity, /example dialogue.*style evidence/i);
  assert.equal(result.extendedGuidance, 'VOICE:\n- dry and warm');
});

test('splits CRLF personality copied from Windows or a document', () => {
  const result = splitPersonalityPrompt('You are Athena.\r\n---\r\nVOICE:\r\n- dry and warm');
  assert.match(result.systemIdentity, /^You are Athena\./);
  assert.equal(result.extendedGuidance, 'VOICE:\n- dry and warm');
});

test('three-dash separator is a runtime context budget boundary', () => {
  const prompt = splitPersonalityPrompt([
    'You are Athena, the ship AI and old friend of the Commander.',
    '---',
    'BACKSTORY: very long optional lore',
    'EXAMPLES: lots of example dialogue',
  ].join('\n'));
  assert.match(prompt.systemIdentity, /^You are Athena, the ship AI/);
  assert.doesNotMatch(prompt.systemIdentity, /very long optional lore/i);
  assert.match(prompt.extendedGuidance, /very long optional lore/i);
});

test('routine recent turns keep extended personality cold', () => {
  const result = shouldIncludeExtendedPersonality({
    message: 'what number did I ask you to remember?',
    participant: 'mtman1987',
    nowMs: Date.parse('2026-08-18T20:00:00Z'),
    history: [{
      type: 'user', username: 'mtman1987', message: 'remember 42', timestamp: '2026-08-18T19:50:00Z',
    }],
  });
  assert.equal(result.conversationStart, false);
  assert.equal(result.requested, false);
  assert.equal(result.includeExtended, false);
});

test('new or stale conversations get one full personality refresher', () => {
  const fresh = shouldIncludeExtendedPersonality({
    message: 'hey Athena', participant: 'mtman1987', history: [], nowMs: Date.parse('2026-08-18T20:00:00Z'),
  });
  assert.equal(fresh.conversationStart, true);
  assert.equal(fresh.includeExtended, true);

  const stale = shouldIncludeExtendedPersonality({
    message: 'hey again',
    participant: 'mtman1987',
    nowMs: Date.parse('2026-08-18T20:00:00Z'),
    history: [{
      type: 'user', username: 'mtman1987', message: 'later', timestamp: '2026-08-18T18:30:00Z',
    }],
  });
  assert.equal(stale.conversationStart, true);
  assert.equal(stale.includeExtended, true);
});

test('explicit character questions can request the cold personality section mid-conversation', () => {
  const result = shouldIncludeExtendedPersonality({
    message: 'tell me about your backstory and where you came from',
    participant: 'viewer',
    nowMs: Date.parse('2026-08-18T20:00:00Z'),
    history: [{ type: 'user', username: 'viewer', message: 'hi', timestamp: '2026-08-18T19:58:00Z' }],
  });
  assert.equal(result.conversationStart, false);
  assert.equal(result.requested, true);
  assert.equal(result.includeExtended, true);
});

test('Adult Mode removes only conflicting SFW lines and preserves the actual personality', () => {
  const prompt = [
    'You are Athena, a blunt but affectionate partner.',
    '---',
    'VOICE:',
    '- Dry, observant, and direct.',
    'FORBIDDEN:',
    '- No real violence, harm, or adult content.',
    '- Never invent memories.',
    'RELATIONSHIPS:',
    '- Trusts the Commander and challenges him honestly.',
  ].join('\n');
  const result = buildPersonalityPrompt(prompt, true);

  assert.match(result.systemIdentity, /blunt but affectionate partner/i);
  assert.match(result.systemIdentity, new RegExp(PERSONALITY_RUNTIME_VERSION));
  assert.match(result.extendedGuidance, /Dry, observant, and direct/i);
  assert.match(result.extendedGuidance, /Never invent memories/i);
  assert.match(result.extendedGuidance, /challenges him honestly/i);
  assert.doesNotMatch(result.extendedGuidance, /adult content/i);
});

test('Adult Mode keeps identity when a legacy SFW restriction shares the same line', () => {
  const result = buildPersonalityPrompt(
    'You are Athena, a blunt companion. Keep it family-friendly.',
    true,
  );

  assert.match(result.systemIdentity, /^You are Athena, a blunt companion\./);
  assert.doesNotMatch(result.systemIdentity, /family-friendly/i);
});

test('shared natural-dialogue policy turns legacy examples into non-repeating style evidence', () => {
  assert.equal(PERSONALITY_RUNTIME_VERSION, 'natural-v3');
  assert.match(NATURAL_DIALOGUE_POLICY, /not a mascot performing a script/i);
  assert.match(NATURAL_DIALOGUE_POLICY, /example dialogue.*style evidence/i);
  assert.match(NATURAL_DIALOGUE_POLICY, /exact, required, signature, or verbatim/i);
  assert.match(NATURAL_DIALOGUE_POLICY, /recent assistant replies/i);
});

test('runtime system compiler preserves character identity and adds the global policy at system priority', () => {
  const result = buildRuntimeSystemIdentity('You are Nova, a curious ship AI.');
  assert.match(result, /^You are Nova, a curious ship AI\./);
  assert.match(result, /Runtime personality policy: natural-v3/);
});
