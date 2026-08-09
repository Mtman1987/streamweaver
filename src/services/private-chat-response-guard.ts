import type { PrivateChatMessage } from '@/lib/private-chat-store';
import { isNearDuplicateToRecentAssistantReplies } from '@/services/qwen-private-chat';

const PRIVATE_RECALL_INTENT = /\b(?:remember|recall|memory|memories|last time|earlier|previously|where we left off|pick up where|continue from (?:before|last time|where we left off))\b/i;
const LTM_DIRECTIVE_PATTERN = /(?:^|\n)\s*LTM_REQUEST:\s*([^\n]+?)\s*(?=\n|$)/gi;

export type PrivateLtmDirective = {
  title: string;
  visibleText: string;
};

export function shouldOfferPrivateLtm(message: string): boolean {
  return PRIVATE_RECALL_INTENT.test(String(message || ''));
}

export function extractPrivateLtmDirective(value: string): PrivateLtmDirective | null {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  let title = '';
  const visibleText = text
    .replace(LTM_DIRECTIVE_PATTERN, (_match, rawTitle: string) => {
      if (!title) title = String(rawTitle || '').trim();
      return '\n';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return title ? { title, visibleText } : null;
}

export function isPrivateReplyRepetitive(
  candidate: string,
  history: PrivateChatMessage[],
): boolean {
  // This is the final save/send boundary. Only block actual near-duplicates here.
  // Softer style/cliche overlap is handled inside Qwen generation as a retry preference.
  return isNearDuplicateToRecentAssistantReplies(candidate, history);
}

export function prunePrivateChatHistoryLoops(history: PrivateChatMessage[]): PrivateChatMessage[] {
  const repeatedAssistantIndexes = new Set<number>();

  for (let left = 0; left < history.length; left++) {
    const entry = history[left];
    if (entry.type !== 'ai') continue;

    for (let right = left + 1; right < history.length; right++) {
      const other = history[right];
      if (other.type !== 'ai') continue;

      if (isNearDuplicateToRecentAssistantReplies(entry.message, [other])) {
        repeatedAssistantIndexes.add(left);
        repeatedAssistantIndexes.add(right);
      }
    }
  }

  if (!repeatedAssistantIndexes.size) return history;
  return history.filter((entry, index) => entry.type !== 'ai' || !repeatedAssistantIndexes.has(index));
}
