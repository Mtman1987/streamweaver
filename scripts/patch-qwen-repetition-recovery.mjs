import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/services/qwen-private-chat.ts';
let source = await readFile(path, 'utf8');

if (!source.includes('countRecentLanguageHits,')) {
  source = source.replace(
    "  buildRecentLanguageAvoidancePrompt,\n  getQwenSamplingProfile,",
    "  buildRecentLanguageAvoidancePrompt,\n  countRecentLanguageHits,\n  getQwenSamplingProfile,",
  );
}

const similarityPattern = /export function isTooSimilarToRecentAssistantReplies\([\s\S]*?\n}\n\nfunction stripQwenControlTokens/;
const similarityReplacement = `export function isNearDuplicateToRecentAssistantReplies(
  candidate: string,
  history: PrivateChatMessage[],
): boolean {
  const candidateWords = comparisonWords(candidate);
  if (candidateWords.length < 5) return false;
  const candidateKey = candidateWords.join(' ');
  const candidateTrigrams = ngrams(candidateWords, 3);

  return history
    .filter((entry) => entry.type === 'ai')
    .slice(-8)
    .some((entry) => {
      const previousWords = comparisonWords(entry.message);
      if (previousWords.length < 5) return false;
      const previousKey = previousWords.join(' ');
      if (candidateKey === previousKey) return true;

      const sharedPrefix = candidateWords
        .slice(0, Math.min(8, candidateWords.length, previousWords.length))
        .every((word, index) => word === previousWords[index]);
      if (sharedPrefix && Math.min(candidateWords.length, previousWords.length) >= 8) return true;

      return overlapRatio(candidateTrigrams, ngrams(previousWords, 3)) >= 0.74;
    });
}

export function isTooSimilarToRecentAssistantReplies(
  candidate: string,
  history: PrivateChatMessage[],
): boolean {
  return (
    isNearDuplicateToRecentAssistantReplies(candidate, history) ||
    isCandidateOverusingRecentLanguage(candidate, history)
  );
}

function stripQwenControlTokens`;

if (!similarityPattern.test(source)) {
  throw new Error('Could not find Qwen similarity block to patch.');
}
source = source.replace(similarityPattern, similarityReplacement);

const loopPattern = /    const rejectedDrafts: string\[\] = \[\];[\s\S]*?    return \{\n      text: '',\n      provider,\n      upstreamError: `Qwen produced only repetitive replies after \$\{rejectedDrafts\.length\} attempts\.`,\n    \};/;
const loopReplacement = `    type RejectedDraft = {
      completion: QwenPrivateChatCompletion;
      hardDuplicate: boolean;
      styleHits: number;
    };
    const rejectedDrafts: RejectedDraft[] = [];
    const pickStyleFallback = (): QwenPrivateChatCompletion | null => {
      const best = rejectedDrafts
        .filter((draft) => !draft.hardDuplicate && draft.completion.text)
        .sort((left, right) => (
          left.styleHits - right.styleHits ||
          right.completion.text.length - left.completion.text.length
        ))[0];
      if (!best) return null;
      return {
        ...best.completion,
        finishReason: best.completion.finishReason || 'style_fallback',
      };
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await complete(rejectedDrafts.at(-1)?.completion.text, attempt);
        if (!completion.text) {
          return pickStyleFallback() || completion;
        }
        const comparisonHistory: PrivateChatMessage[] = [
          ...input.history,
          ...rejectedDrafts.map((draft, index) => ({
            type: 'ai' as const,
            username: input.botName,
            message: draft.completion.text,
            timestamp: \`rejected-\${index}\`,
          })),
        ];
        const hardDuplicate = isNearDuplicateToRecentAssistantReplies(completion.text, comparisonHistory);
        const styleOveruse = isCandidateOverusingRecentLanguage(completion.text, comparisonHistory);
        if (!hardDuplicate && !styleOveruse) return completion;
        rejectedDrafts.push({
          completion,
          hardDuplicate,
          styleHits: countRecentLanguageHits(completion.text, comparisonHistory),
        });
      } catch (error) {
        const fallback = pickStyleFallback();
        if (fallback) return fallback;
        return {
          text: '',
          provider,
          upstreamError: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const fallback = pickStyleFallback();
    if (fallback) return fallback;
    return {
      text: '',
      provider,
      upstreamError: \`Qwen produced only repetitive replies after \${rejectedDrafts.length} attempts.\`,
    };`;

if (!loopPattern.test(source)) {
  throw new Error('Could not find Qwen retry loop to patch.');
}
source = source.replace(loopPattern, loopReplacement);

await writeFile(path, source, 'utf8');
console.log('Patched Qwen repetition recovery.');
