export type RelayQuotedSegment = {
  full: string;
  content: string;
  start: number;
  end: number;
};

function collectMatches(
  message: string,
  pattern: RegExp,
  contentIndex: number,
  prefixIndex?: number,
): RelayQuotedSegment[] {
  const matches: RelayQuotedSegment[] = [];
  pattern.lastIndex = 0;
  for (const match of message.matchAll(pattern)) {
    const prefix = prefixIndex === undefined ? '' : String(match[prefixIndex] || '');
    const content = String(match[contentIndex] || '');
    if (!content.trim()) continue;
    const start = Number(match.index || 0) + prefix.length;
    const full = String(match[0] || '').slice(prefix.length);
    matches.push({ full, content, start, end: start + full.length });
  }
  return matches;
}

/**
 * Return every explicitly quoted span in source order. Straight apostrophes are
 * only treated as quote delimiters at word boundaries so contractions such as
 * "don't" never become accidental immutable spans.
 */
export function extractRelayQuotedSegments(value: unknown): RelayQuotedSegment[] {
  const message = String(value || '');
  const matches = [
    ...collectMatches(message, /"([^"\r\n]+)"/g, 1),
    ...collectMatches(message, /“([^”\r\n]+)”/g, 1),
    ...collectMatches(message, /‘([^’\r\n]+)’/g, 1),
    ...collectMatches(message, /(^|[\s([{])'([^'\r\n]+)'(?=$|[\s)\]},.!?;:])/g, 2, 1),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const unique: RelayQuotedSegment[] = [];
  const seen = new Set<string>();
  for (const segment of matches) {
    const key = `${segment.start}:${segment.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
  }
  return unique;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeRepeatedExactSegment(reply: string, segment: RelayQuotedSegment): string {
  const exact = segment.content;
  if (!exact) return reply.trim();

  const escaped = escapeRegex(exact);
  const pattern = new RegExp(
    `(?:"${escaped}"|'${escaped}'|“${escaped}”|‘${escaped}’|${escaped})`,
    'g',
  );
  let seen = false;
  return reply
    .replace(pattern, (match) => {
      if (!seen) {
        seen = true;
        return match;
      }
      return '';
    })
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Receiving bots may restyle unquoted prose, but each quoted span must survive
 * byte-for-byte. If the model omitted or altered one, append the original span.
 */
export function preserveRelayQuotedSegments(reply: unknown, relayMessage: unknown): string {
  let result = String(reply || '').trim();
  const segments = extractRelayQuotedSegments(relayMessage);
  const seenContents = new Set<string>();

  for (const segment of segments) {
    if (seenContents.has(segment.content)) continue;
    seenContents.add(segment.content);
    result = removeRepeatedExactSegment(result, segment);
    if (!result.includes(segment.content)) {
      result = `${result} ${segment.full}`.trim();
    }
  }

  return result;
}


export type RelayReplyCommand = {
  matched: boolean;
  action?: 'reply' | 'close';
  message?: string;
  missingMessage?: boolean;
};

function stripLeadingRelayBotName(message: string, botNames: string[]): string {
  let normalized = message.trim();
  const names = Array.from(new Set(botNames.map((name) => String(name || '').trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const escaped = escapeRegex(name);
    const pattern = new RegExp(`^(?:hey\\s+)?@?${escaped}(?:\\s*[:,\\-])?\\s+`, 'i');
    if (pattern.test(normalized)) return normalized.replace(pattern, '').trim();
  }
  return normalized;
}

/**
 * Parse the short-lived response invitation shown by every delivered relay.
 * Quoted message content remains untouched because only the leading command is
 * removed.
 */
export function extractRelayReplyCommand(input: {
  message: unknown;
  botNames?: string[];
}): RelayReplyCommand {
  const normalized = stripLeadingRelayBotName(
    String(input.message || ''),
    input.botNames || [],
  );
  if (!normalized) return { matched: false };

  if (/^(?:["“‘']?no["”’']?)(?:[.!]|\\s+(?:thanks?|thank\\s+you)[.!]?)?$/i.test(normalized)) {
    return { matched: true, action: 'close' };
  }

  const match = normalized.match(
    /^(?:["“‘']?(reply|yes)["”’']?)(?:\\s*[:,\\-])?(?:\\s+([\\s\\S]+))?$/i,
  );
  if (!match) return { matched: false };

  const replyMessage = String(match[2] || '').trim();
  return {
    matched: true,
    action: 'reply',
    message: replyMessage || undefined,
    missingMessage: !replyMessage,
  };
}

export function buildRelayReplyInstructions(sourceUserName: unknown): string {
  const sender = String(sourceUserName || 'the original sender').trim() || 'the original sender';
  return `Would you like to reply back to ${sender} at the original location? Tell me "reply" (or "yes") followed by your message, or tell me "no" to close this relay. This reply option expires in 5 minutes.`;
}
