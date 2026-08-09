from pathlib import Path

service_path = Path('src/services/qwen-private-chat.ts')
text = service_path.read_text()
marker = 'Qwen produced only repetitive replies after'

if marker not in text:
    replacements = []

    replacements.append((
'''    const complete = async (retryAfterRepetition?: string): Promise<QwenPrivateChatCompletion> => {
      const messages = buildQwenMessages({ ...input, retryAfterRepetition });''',
'''    const complete = async (
      retryAfterRepetition?: string,
      attempt = 0,
    ): Promise<QwenPrivateChatCompletion> => {
      const messages = buildQwenMessages({ ...input, retryAfterRepetition });'''))

    replacements.append((
'''          temperature: input.adultMode ? 0.78 : 0.72,
          top_p: 0.8,
          top_k: 20,
          repetition_penalty: 1.12,
          presence_penalty: 0.3,
          frequency_penalty: 0.35,''',
'''          temperature: attempt > 0 ? (input.adultMode ? 0.92 : 0.88) : (input.adultMode ? 0.78 : 0.72),
          top_p: attempt > 0 ? 0.9 : 0.8,
          top_k: attempt > 0 ? 40 : 20,
          repetition_penalty: attempt > 0 ? 1.24 : 1.12,
          presence_penalty: attempt > 0 ? 0.65 : 0.3,
          frequency_penalty: attempt > 0 ? 0.7 : 0.35,'''))

    replacements.append((
'''  const deduplicated: QwenChatMessage[] = [];
  for (const entry of historyEntries) {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      previous.role === entry.role &&
      normalizeForComparison(previous.content) === normalizeForComparison(entry.content)
    ) {
      continue;
    }
    deduplicated.push(entry);
  }''',
'''  const deduplicated: QwenChatMessage[] = [];
  const keptAssistantHistory: PrivateChatMessage[] = [];
  for (const entry of historyEntries) {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      previous.role === entry.role &&
      normalizeForComparison(previous.content) === normalizeForComparison(entry.content)
    ) {
      continue;
    }
    if (
      entry.role === 'assistant' &&
      isTooSimilarToRecentAssistantReplies(entry.content, keptAssistantHistory)
    ) {
      continue;
    }
    deduplicated.push(entry);
    if (entry.role === 'assistant') {
      keptAssistantHistory.push({
        type: 'ai',
        username: input.botName,
        message: entry.content,
        timestamp: `history-${keptAssistantHistory.length}`,
      });
    }
  }'''))

    replacements.append((
'''    const rejectedDrafts: string[] = [];
    let last: QwenPrivateChatCompletion | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await complete(rejectedDrafts.at(-1));
        last = completion;
        if (!completion.text) return completion;
        const comparisonHistory: PrivateChatMessage[] = [
          ...input.history,
          ...rejectedDrafts.map((message, index) => ({
            type: 'ai' as const,
            username: input.botName,
            message,
            timestamp: `rejected-${index}`,
          })),
        ];
        if (!isTooSimilarToRecentAssistantReplies(completion.text, comparisonHistory)) return completion;
        rejectedDrafts.push(completion.text);
      } catch {
        if (last) return last;
      }
    }
    return last || { text: '', provider, upstreamError: 'Qwen did not produce a distinct reply.' };''',
'''    const rejectedDrafts: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await complete(rejectedDrafts.at(-1), attempt);
        if (!completion.text) return completion;
        const comparisonHistory: PrivateChatMessage[] = [
          ...input.history,
          ...rejectedDrafts.map((message, index) => ({
            type: 'ai' as const,
            username: input.botName,
            message,
            timestamp: `rejected-${index}`,
          })),
        ];
        if (!isTooSimilarToRecentAssistantReplies(completion.text, comparisonHistory)) return completion;
        rejectedDrafts.push(completion.text);
      } catch (error) {
        return {
          text: '',
          provider,
          upstreamError: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      text: '',
      provider,
      upstreamError: `Qwen produced only repetitive replies after ${rejectedDrafts.length} attempts.`,
    };'''))

    for old, new in replacements:
        if old not in text:
            raise SystemExit('Expected Qwen source block not found')
        text = text.replace(old, new)

    service_path.write_text(text)


test_path = Path('tests/private-chat-qwen-mode.test.ts')
tests = test_path.read_text()
if "does not leak the third rejected repetitive draft" not in tests:
    tests += r'''

test('does not leak the third rejected repetitive draft', async () => {
  let calls = 0;
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: repeated } }] }), { status: 200 });
    },
  });

  assert.equal(calls, 3);
  assert.equal(completion.text, '');
  assert.match(completion.upstreamError || '', /only repetitive replies after 3 attempts/i);
});

test('does not leak an already rejected draft when a retry request fails', async () => {
  let calls = 0;
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async () => {
      calls += 1;
      if (calls == 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: repeated } }] }), { status: 200 });
      }
      throw new Error('retry transport failed');
    },
  });

  assert.equal(calls, 2);
  assert.equal(completion.text, '');
  assert.match(completion.upstreamError || '', /retry transport failed/i);
});

test('drops near-duplicate assistant turns from the Qwen history prompt', () => {
  const messages = buildQwenMessages({
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'Give me a new answer.',
    history: [
      { type: 'user', username: 'Commander', message: 'Start.', timestamp: '1' },
      { type: 'ai', username: 'Athena', message: 'I step closer with a crooked smile and lower my voice as the room goes quiet.', timestamp: '2' },
      { type: 'user', username: 'Commander', message: 'And then?', timestamp: '3' },
      { type: 'ai', username: 'Athena', message: 'I step closer with a crooked smile and lower my voice while the room goes quiet.', timestamp: '4' },
    ],
  });

  const assistantMessages = messages.filter((entry) => entry.role === 'assistant');
  assert.equal(assistantMessages.length, 1);
});

test('uses stronger anti-loop sampling on regeneration attempts', async () => {
  const bodies: any[] = [];
  const repeated = 'I step closer with a crooked smile and lower my voice as the room goes quiet.';
  const completion = await requestQwenPrivateChatCompletion({
    baseUrl: 'https://qwen.example.com/v1',
    model: 'Qwen/private-roleplay',
    systemPrompt: 'You are Athena.',
    username: 'Commander',
    botName: 'Athena',
    message: 'What happens next?',
    history: [{ type: 'ai', username: 'Athena', message: repeated, timestamp: '1' }],
    runtime: { production: true },
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || '{}')));
      const content = bodies.length === 1
        ? repeated
        : 'I stop, change direction completely, and answer the new point instead.';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });

  assert.equal(completion.text, 'I stop, change direction completely, and answer the new point instead.');
  assert.equal(bodies[0].repetition_penalty, 1.12);
  assert.equal(bodies[1].repetition_penalty, 1.24);
  assert.ok(bodies[1].temperature > bodies[0].temperature);
  assert.ok(bodies[1].frequency_penalty > bodies[0].frequency_penalty);
});
'''
    test_path.write_text(tests)
