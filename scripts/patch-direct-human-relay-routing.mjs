import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(repoRoot, 'src/services/chat-dispatcher.ts');
let source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importLine = "import { deliverDirectHumanRelay } from './direct-human-relay';";
if (!source.includes(importLine)) {
  const marker = "import { lookupDiscordRelayPresence } from './discord-relay-presence';";
  if (!source.includes(marker)) throw new Error('Direct human relay patch: import marker missing');
  source = source.replace(marker, `${marker}\n${importLine}`);
}

const badLog = "console.log('[Dispatcher] Relay delivered directly to human target in current Twitch chat:'";
if (source.includes(badLog)) {
  const branchStart = source.lastIndexOf('                            if (relayRequest.targetName && isDirectHumanRelayTarget(relayRequest.targetName)) {', source.indexOf(badLog));
  const nextWarning = source.indexOf("                            console.warn('[Dispatcher] Human relay target unresolved:'", source.indexOf(badLog));
  if (branchStart < 0 || nextWarning < 0) throw new Error('Direct human relay patch: unresolved target branch markers missing');

  const replacement = `                            if (relayRequest.targetName && isDirectHumanRelayTarget(relayRequest.targetName)) {\n                                const directDelivery = await deliverDirectHumanRelay({\n                                    targetName: relayRequest.targetName,\n                                    sourceUserName: actualUsername,\n                                    relayMessage: relayRequest.relayMessage,\n                                });\n                                if (directDelivery.delivered) {\n                                    console.log('[Dispatcher] Direct human relay delivered through Discord:', {\n                                        targetName: relayRequest.targetName,\n                                        mode: directDelivery.mode,\n                                        channelId: directDelivery.channelId || null,\n                                    });\n                                    return;\n                                }\n                                console.warn('[Dispatcher] Direct human relay Discord delivery failed:', {\n                                    targetName: relayRequest.targetName,\n                                    error: directDelivery.error || 'target unavailable',\n                                });\n                                return;\n                            }\n`;
  source = source.slice(0, branchStart) + replacement + source.slice(nextWarning);
}

if (source.includes(badLog)) throw new Error('Direct human relay patch: current-Twitch-chat fallback still present');
if (!source.includes('deliverDirectHumanRelay({')) throw new Error('Direct human relay patch: Discord delivery call missing');

fs.writeFileSync(filePath, source, 'utf8');
console.log('Direct human relay routing patch applied');
