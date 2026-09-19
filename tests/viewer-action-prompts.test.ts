import test from 'node:test';
import assert from 'node:assert/strict';

import { extractViewerActionPrompt } from '../src/lib/viewer-action-prompts';

test('viewer action tags are stripped and choices are preserved', () => {
  const parsed = extractViewerActionPrompt('Would you like me to queue that? [buttons:Yes|No]');
  assert.equal(parsed.text, 'Would you like me to queue that?');
  assert.deepEqual(parsed.options, ['Yes', 'No']);
});

test('viewer action tags require at least two choices', () => {
  const parsed = extractViewerActionPrompt('Continue? [buttons:Yes]');
  assert.equal(parsed.text, 'Continue? [buttons:Yes]');
  assert.equal(parsed.options, undefined);
});

test('viewer action choices are bounded', () => {
  const parsed = extractViewerActionPrompt('Pick one. [buttons:A|B|C|D|E|F]');
  assert.deepEqual(parsed.options, ['A', 'B', 'C', 'D', 'E']);
});
