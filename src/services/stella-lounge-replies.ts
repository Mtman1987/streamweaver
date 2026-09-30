type ReplyIdentity = 'bot' | 'broadcaster';

let readoutIndex = 0;
const READOUT_LEADS = [
  'I have your readout, Passenger.',
  'Stella has the numbers for you.',
  'The shipboard readout is in.',
  'A little data from the bridge.',
];

/** Command replies in the Lounge only. Links and machine receipts stay with the broadcaster. */
export function prepareStellaLoungeReply(message: string, requestedAs: ReplyIdentity): { message: string; as: ReplyIdentity } {
  const text = message.trim();
  if (/https?:\/\/|www\.|\n|\s\|\s/.test(text)
    || text.length > 240
    || /\busage:|(?:\buse|\btype)\s+!|\breply\s+[1-9]\b/i.test(text)) {
    return { message, as: 'broadcaster' };
  }

  // Keep exact counts in chat without making Stella recite them. The Lounge
  // TTS path removes parenthesized text for stellabot87 only.
  const isReadout = /\d/.test(text)
    && /\b(?:points?|pts|followers?|views?|uptime|watchtime|stats?|votes?|balance|rank|level|score|volume)\b|%/i.test(text)
    && !/\b(?:failed|error|couldn't|timed out|not found)\b/i.test(text);
  if (isReadout && !/^\s*\(/.test(text)) {
    const lead = READOUT_LEADS[readoutIndex++ % READOUT_LEADS.length];
    return { message: `${lead} (${text})`, as: 'bot' };
  }

  return { message, as: requestedAs === 'broadcaster' ? 'bot' : requestedAs };
}
