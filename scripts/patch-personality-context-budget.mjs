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
  shouldIncludeExtendedPersonality,
} from '@/lib/personality-prompt';`;
if (!source.includes('shouldIncludeExtendedPersonality')) {
  if (!source.includes(importBlock)) throw new Error('Private personality budget import marker missing');
  source = source.replace(importBlock, replacementImportBlock);
}

// Private turns may borrow a little public continuity, but twelve full public
// messages on every DM is unnecessary prompt weight. Four is enough to orient
// the bot without crowding out the private conversation itself.
source = source.replace(
  '    const publicHistory = await readPublicChatMessages(12, tenantId).catch(() => []);',
  '    const publicHistory = await readPublicChatMessages(4, tenantId).catch(() => []);',
);

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

if (!source.includes('readPublicChatMessages(4, tenantId)')) {
  throw new Error('Private personality budget: compact public-history limit was not applied');
}
if (source.includes('NATURAL_DIALOGUE_POLICY')) {
  throw new Error('Private personality budget: duplicate natural-dialogue policy import/use remains');
}

fs.writeFileSync(file, source, 'utf8');
console.log('Personality context budget patch applied.');
