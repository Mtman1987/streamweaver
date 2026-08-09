import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecentLanguageAvoidancePrompt,
  clearQwenModelCapabilityCacheForTests,
  countRecentLanguageHits,
  discoverAvailableBuiltInQwenModels,
  extractRecurringAssistantLanguage,
  getQwenSamplingProfile,
  isCandidateOverusingRecentLanguage,
  resolvePreferredBuiltInQwenModel,
  selectPreferredBuiltInQwenModel,
} from '../src/services/qwen-quality';

test('detects recurring cosmic language without hard-failing one familiar phrase', () => {
  const history = [
    { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) I will keep it slow and steady, like a comet tail through the stars.', timestamp: '1' },
    { type: 'user' as const, username: 'Mt', message: 'continue', timestamp: '2' },
    { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) Stay slow and steady while that comet tail crosses the stars.', timestamp: '3' },
    { type: 'user' as const, username: 'Mt', message: 'different words please', timestamp: '4' },
    { type: 'ai' as const, username: 'Athena', message: '(leans in, breath warm) We can move slow and steady beneath the stars.', timestamp: '5' },
  ];

  const recurring = extractRecurringAssistantLanguage(history);
  assert.ok(recurring.phrases.some((phrase) => phrase.includes('leans in breath warm')));
  assert.ok(recurring.phrases.some((phrase) => phrase.includes('slow and steady')));

  const prompt = buildRecentLanguageAvoidancePrompt(history);
  assert.match(prompt, /VARIETY GUARD/);
  assert.match(prompt, /slow and steady/);
  assert.match(prompt, /do not sacrifice a correct, direct answer/i);

  const oneFamiliarPhrase = '(leans in, breath warm) I answer your actual question directly with concrete new information.';
  assert.ok(countRecentLanguageHits(oneFamiliarPhrase, history) >= 1);
  assert.equal(isCandidateOverusingRecentLanguage(oneFamiliarPhrase, history), false);

  const collapsedStyle = '(leans in, breath warm) I keep it slow and steady beneath the stars while repeating the same familiar imagery.';
  assert.ok(countRecentLanguageHits(collapsedStyle, history) >= 2);
  assert.equal(isCandidateOverusingRecentLanguage(collapsedStyle, history), true);

  assert.equal(
    isCandidateOverusingRecentLanguage(
      'I answer the newest detail directly with a grounded reaction and no recycled imagery.',
      history,
    ),
    false,
  );
});

test('adult retry sampling increases variety without extreme penalty escalation', () => {
  const first = getQwenSamplingProfile(0, true);
  const retry = getQwenSamplingProfile(2, true);
  assert.equal(first.temperature, 0.72);
  assert.ok(retry.temperature > first.temperature);
  assert.ok(retry.temperature < 0.9);
  assert.ok(retry.frequency_penalty <= 0.3);
  assert.ok(retry.presence_penalty <= 0.3);
  assert.ok(retry.repetition_penalty <= 1.13);
});

test('prefers 14B then 8B only when the built-in worker advertises them', () => {
  assert.equal(
    selectPreferredBuiltInQwenModel('spmt-qwen3-4b', ['spmt-qwen3-4b', 'spmt-qwen3-8b', 'spmt-qwen3-14b']),
    'spmt-qwen3-14b',
  );
  assert.equal(
    selectPreferredBuiltInQwenModel('spmt-qwen3-4b', ['spmt-qwen3-4b', 'spmt-qwen3-8b']),
    'spmt-qwen3-8b',
  );
  assert.equal(
    selectPreferredBuiltInQwenModel('my-custom-model', ['spmt-qwen3-14b']),
    'my-custom-model',
  );
});

test('discovers the built-in worker model list and selects the largest advertised Qwen', async () => {
  clearQwenModelCapabilityCacheForTests();
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({
      data: [
        { id: 'spmt-qwen3-4b' },
        { id: 'spmt-qwen3-8b' },
        { id: 'spmt-qwen3-14b' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const models = await discoverAvailableBuiltInQwenModels({
    baseUrl: 'http://spmt-llm-worker.internal:8080/v1',
    fetchImpl,
  });
  assert.deepEqual(models, ['spmt-qwen3-4b', 'spmt-qwen3-8b', 'spmt-qwen3-14b']);

  const selected = await resolvePreferredBuiltInQwenModel({
    baseUrl: 'http://spmt-llm-worker.internal:8080/v1',
    configuredModel: 'spmt-qwen3-4b',
    fetchImpl,
  });

  assert.equal(selected, 'spmt-qwen3-14b');
  assert.deepEqual(urls, ['http://spmt-llm-worker.internal:8080/v1/models']);
});

test('keeps 4B when model discovery is unavailable instead of breaking private chat', async () => {
  clearQwenModelCapabilityCacheForTests();
  const fetchImpl = (async () => new Response('not supported', { status: 404 })) as typeof fetch;
  const selected = await resolvePreferredBuiltInQwenModel({
    baseUrl: 'http://spmt-llm-worker.internal:8080/v1',
    configuredModel: 'spmt-qwen3-4b',
    fetchImpl,
  });
  assert.equal(selected, 'spmt-qwen3-4b');
});
