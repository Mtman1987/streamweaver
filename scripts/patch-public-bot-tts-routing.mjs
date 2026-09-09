import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(repoRoot, 'src/services/discord-structured-replies.ts');
let source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importMarker = "import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';";
const stateImport = "import { getPublicBotTtsEnabled } from './public-bot-tts';";
if (!source.includes(stateImport)) {
  if (!source.includes(importMarker)) throw new Error('Public bot TTS patch: import marker missing');
  source = source.replace(importMarker, `${importMarker}\n${stateImport}\nimport { hasActiveTtsConsumer } from './tts-consumer-presence';\nimport { generateTTS } from './tts-provider';\nimport { addSayQueueItem } from '@/app/api/say/_store';`);
}

const helperMarker = 'async function queuePersistentPublicBotTts(';
if (!source.includes(helperMarker)) {
  const insertionMarker = 'async function finalizePublicControls(input: {';
  const index = source.indexOf(insertionMarker);
  if (index < 0) throw new Error('Public bot TTS patch: finalize controls marker missing');
  const helper = `async function queuePersistentPublicBotTts(input: { channelId: string; tenantId: string; text: string }): Promise<number> {\n  if (!await getPublicBotTtsEnabled(input.channelId, input.tenantId)) return 0;\n  const streamKey = \`discord:\${input.channelId}\`;\n  if (!hasActiveTtsConsumer(streamKey, 'say')) return 0;\n  const text = String(input.text || '').trim();\n  if (!text) return 0;\n  const chunks = text.match(/[\\s\\S]{1,450}/g) || [];\n  let queued = 0;\n  for (const chunk of chunks) {\n    const audioDataUri = await generateTTS(chunk, undefined, streamKey, { requireActiveConsumer: true, consumerScope: 'say' });\n    if (!audioDataUri) continue;\n    addSayQueueItem(streamKey, audioDataUri);\n    queued += 1;\n  }\n  return queued;\n}\n\n`;
  source = source.slice(0, index) + helper + source.slice(index);
}

const callMarker = 'await queuePersistentPublicBotTts({';
if (!source.includes(callMarker)) {
  const insertionMarker = '  if (sentId && isPrivateImageLibraryRequest && replyInput.tenantId && galleryImages.length) {';
  const index = source.indexOf(insertionMarker);
  if (index < 0) throw new Error('Public bot TTS patch: post-send marker missing');
  const call = `  if (sentId && !replyInput.isPrivate) {\n    const publicTtsTenantId = speaker.tenantId || replyInput.tenantId;\n    if (publicTtsTenantId) {\n      await queuePersistentPublicBotTts({\n        channelId: replyInput.channelId,\n        tenantId: publicTtsTenantId,\n        text: replyInput.message,\n      }).catch((error) => console.warn('[Discord Reply] Persistent public bot TTS failed:', error));\n    }\n  }\n\n`;
  source = source.slice(0, index) + call + source.slice(index);
}

if (!source.includes(stateImport) || !source.includes(helperMarker) || !source.includes(callMarker)) {
  throw new Error('Public bot TTS patch: contract incomplete');
}
fs.writeFileSync(filePath, source, 'utf8');
console.log('Persistent public bot TTS routing patch applied');
