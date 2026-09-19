export type ViewerActionPrompt = {
  id: string;
  question: string;
  options: string[];
  expiresAt: string;
};

export const VIEWER_ACTION_PROMPT = [
  'Normally let viewers answer you in Twitch chat. Do not use viewer-button tags for ordinary questions or conversation.',
  'Use a viewer-button tag only when the response should be sealed/private until reveal, such as rock-paper-scissors, hidden voting, quiz guesses, secret choices, or another interaction where seeing chat answers would spoil the result.',
  'Format: [buttons:Rock|Paper|Scissors] or [buttons:Option A|Option B|Option C].',
  'Use 2 to 5 short choices, each under 30 characters, and at most one button set in a reply.',
  'The spoken sentence immediately before the tag should clearly ask the private-choice question.',
  'Never mention the bracket tag aloud and never put it anywhere except the end of the reply, before an optional avatar gesture tag.',
].join(' ');

export function extractViewerActionPrompt(value: unknown): { text: string; options?: string[] } {
  const input = String(value || '').trim();
  if (!input) return { text: '' };
  const match = input.match(/\[buttons:([^\]]+)\]\s*$/i);
  if (!match) return { text: input };
  const options = String(match[1] || '')
    .split('|')
    .map((option) => option.replace(/\s+/g, ' ').trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 5);
  if (options.length < 2) return { text: input };
  return {
    text: input.slice(0, match.index).trim(),
    options,
  };
}
