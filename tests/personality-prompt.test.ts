import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonalityPrompt,
  NATURAL_DIALOGUE_POLICY,
  splitPersonalityPrompt,
} from '../src/lib/personality-prompt';

test('splits compact identity from extended tenant guidance', () => {
  assert.deepEqual(splitPersonalityPrompt('You are Athena.\n---\nVOICE:\n- dry and warm'), {
    systemIdentity: 'You are Athena.',
    extendedGuidance: 'VOICE:\n- dry and warm',
  });
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
  assert.match(result.extendedGuidance, /Dry, observant, and direct/i);
  assert.match(result.extendedGuidance, /Never invent memories/i);
  assert.match(result.extendedGuidance, /challenges him honestly/i);
  assert.doesNotMatch(result.extendedGuidance, /adult content/i);
});

test('shared natural-dialogue policy rejects forced mascot habits', () => {
  assert.match(NATURAL_DIALOGUE_POLICY, /not a mascot performing a script/i);
  assert.match(NATURAL_DIALOGUE_POLICY, /Do not force catchphrases/i);
});
