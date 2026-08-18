import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'app', 'api', 'private-chat', 'respond', 'route.ts');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const importBlock = `import {
  buildPersonalityPrompt,
  NATURAL_DIALOGUE_POLICY,
} from '@/lib/personality-prompt';`;
const replacementImportBlock = `import {
  buildPersonalityPrompt,
  NATURAL_DIALOGUE_POLICY,
  shouldIncludeExtendedPersonality,
} from '@/lib/personality-prompt';`;
if (!source.includes('shouldIncludeExtendedPersonality')) {
  if (!source.includes(importBlock)) throw new Error('Private personality budget import marker missing');
  source = source.replace(importBlock, replacementImportBlock);
}

const oldPromptBlock = `    const publicContext = formatRecentPublicContext(publicHistory as any, botName);
    const qwenSystemPrompt = [
      governedSystemIdentity,
      extendedGuidance,
      NATURAL_DIALOGUE_POLICY,
      publicContext,
    ].filter(Boolean).join('\\n\\n');`;
const newPromptBlock = `    const publicContext = formatRecentPublicContext(publicHistory as any, botName);
    const personalityContext = shouldIncludeExtendedPersonality({
      message,
      history: qwenHistory,
      participant: username,
    });
    const qwenSystemPrompt = [
      governedSystemIdentity,
      personalityContext.includeExtended ? extendedGuidance : '',
      personalityContext.conversationStart && extendedGuidance
        ? '[Conversation refresher: extended personality/background is loaded for this opening turn only. Routine turns use the compact identity above the --- separator.]'
        : '',
      publicContext,
    ].filter(Boolean).join('\\n\\n');`;
if (!source.includes('const personalityContext = shouldIncludeExtendedPersonality({')) {
  if (!source.includes(oldPromptBlock)) throw new Error('Private personality budget prompt marker missing');
  source = source.replace(oldPromptBlock, newPromptBlock);
}

// buildPersonalityPrompt already appends the global natural-dialogue policy to
// systemIdentity, so do not send the same policy a second time in qwenSystemPrompt.
source = source.replace(
  `      governedSystemIdentity,\n      personalityContext.includeExtended ? extendedGuidance : '',\n      personalityContext.conversationStart && extendedGuidance\n        ? '[Conversation refresher: extended personality/background is loaded for this opening turn only. Routine turns use the compact identity above the --- separator.]'\n        : '',\n      NATURAL_DIALOGUE_POLICY,\n      publicContext,`,
  `      governedSystemIdentity,\n      personalityContext.includeExtended ? extendedGuidance : '',\n      personalityContext.conversationStart && extendedGuidance\n        ? '[Conversation refresher: extended personality/background is loaded for this opening turn only. Routine turns use the compact identity above the --- separator.]'\n        : '',\n      publicContext,`,
);

fs.writeFileSync(file, source, 'utf8');
console.log('Personality context budget patch applied.');
