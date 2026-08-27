import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/app/api/discord/chat/route.ts');
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `async function addLoreCandidate(messageLower: string, candidates: BotMatch[], tenantId?: string) {\n  if (!tenantId) return;\n  const lore = await readWorldLore();\n  const characters = Object.values(lore?.characters || {});\n  const tenantCharacters = characters.filter((character) =>\n    (character.stableId.startsWith(\`\${tenantId}:\`) || character.stableId.startsWith('unknown:'))\n    && character.stableId !== THE_COUNT_STABLE_ID\n  );\n\n  for (const character of tenantCharacters) {\n    const triggers = Array.from(new Set([\n      character.currentName,\n      ...(character.aliases || []),\n      ...(character.previousNames || []),\n    ].filter(Boolean).map((value) => value.toLowerCase())));\n\n    for (const trigger of triggers) {\n      const index = triggerIndex(messageLower, trigger);\n      if (index >= 0) {\n        candidates.push({ tenantId, botName: character.currentName, trigger, index });\n      }\n    }\n  }\n}`;

const newBlock = `async function addLoreCandidate(messageLower: string, candidates: BotMatch[], tenantId?: string) {\n  if (!tenantId) return;\n  const lore = await readWorldLore();\n  const characters = Object.values(lore?.characters || {});\n  const configuredNames = new Set([\n    getBotName(tenantId),\n    ...splitAliases(readUserConfigSync(tenantId).AI_BOT_ALIASES),\n    ...splitAliases(getBotAliases(tenantId)),\n  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));\n\n  const tenantCharacters = characters.filter((character) => {\n    if (character.stableId.startsWith(\`\${tenantId}:\`)) return true;\n    if (!character.stableId.startsWith('unknown:')) return false;\n\n    const loreNames = characterTriggers(character)\n      .map((value) => String(value || '').trim().toLowerCase())\n      .filter(Boolean);\n    return character.stableId !== THE_COUNT_STABLE_ID\n      && loreNames.some((name) => configuredNames.has(name));\n  });\n\n  for (const character of tenantCharacters) {\n    const triggers = Array.from(new Set([\n      character.currentName,\n      ...(character.aliases || []),\n      ...(character.previousNames || []),\n    ].filter(Boolean).map((value) => value.toLowerCase())));\n\n    for (const trigger of triggers) {\n      const index = triggerIndex(messageLower, trigger);\n      if (index >= 0) {\n        candidates.push({ tenantId, botName: character.currentName, trigger, index });\n      }\n    }\n  }\n}`;

if (before.includes(newBlock)) {
  console.log('[LoreTenantRoutingPatch] already applied');
  process.exit(0);
}
if (!before.includes(oldBlock)) {
  throw new Error('Lore tenant routing patch: resolver marker missing');
}

const after = before.replace(oldBlock, newBlock);
fs.writeFileSync(file, after, 'utf8');
console.log('[LoreTenantRoutingPatch] applied');
