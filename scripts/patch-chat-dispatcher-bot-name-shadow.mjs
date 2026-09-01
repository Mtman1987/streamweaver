import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/services/chat-dispatcher.ts');
const raw = fs.readFileSync(file, 'utf8');
let source = raw.replace(/\r\n/g, '\n');

const topLevelImport = "import { getBotName } from '../lib/bot-settings-store';";
const shadowed = "            const { getBotName, getBotInterests, getBotAliases } = require('../lib/bot-settings-store');";
const corrected = "            const { getBotInterests, getBotAliases } = require('../lib/bot-settings-store');";

if (!source.includes(topLevelImport)) {
  throw new Error('chat-dispatcher bot-name shadow patch: top-level getBotName import is missing');
}

if (source.includes(shadowed)) {
  source = source.replace(shadowed, corrected);
} else if (!source.includes(corrected)) {
  throw new Error('chat-dispatcher bot-name shadow patch: local settings declaration marker is missing');
}

if (/const\s*\{[^}]*\bgetBotName\b[^}]*\}\s*=\s*require\('\.\.\/lib\/bot-settings-store'\)/.test(source)) {
  throw new Error('chat-dispatcher bot-name shadow patch: a block-scoped getBotName declaration still exists');
}

if (source !== raw) fs.writeFileSync(file, source, 'utf8');
console.log('[ChatDispatcherPatch] getBotName uses the top-level import; no block-scoped shadow remains');
