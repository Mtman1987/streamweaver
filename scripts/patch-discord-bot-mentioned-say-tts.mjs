import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/app/api/discord/chat/route.ts');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const normalQueueMarker = `body: JSON.stringify({ tenantId: sayChannelKey, text: spokenMessage }),`;
const normalQueueReplacement = `body: JSON.stringify({ tenantId: sayChannelKey, text: spokenMessage, speakerUserId: userId, speakerName: userName }),`;
if (source.includes(normalQueueMarker)) {
  source = source.replace(normalQueueMarker, normalQueueReplacement);
} else if (!source.includes(normalQueueReplacement)) {
  throw new Error('Could not find normal Discord !say queue payload');
}

const insertionMarker = `    // Generate AI response\n    const botTenantId = botMatch?.tenantId;`;
const insertion = `    // Bot-directed human messages must use the same !say path as ordinary\n    // Discord conversation. The source message may be deleted after it is\n    // folded into the bot embed, so queue the HUMAN speech before generating\n    // the bot response. Bot-authored replies remain excluded from automatic\n    // TTS and can still be spoken manually with the embed speaker control.\n    if (!isDiscordBotAuthor(data) && isSayTextSpeakable(message) && !message.trim().startsWith('!')) {\n      try {\n        const sayUsers = await readSayUsers();\n        if (isSayEnabled(sayUsers, userId, channelId)) {\n          const sayChannelKey = resolveSayStreamKey(undefined, 'discord', channelId);\n          const spokenMessage = formatSaySpeechText(sayChannelKey, userName, message);\n          fetch(\`\${getInternalAppUrl()}/api/say/queue\`, {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({\n              tenantId: sayChannelKey,\n              text: spokenMessage,\n              speakerUserId: userId,\n              speakerName: userName,\n            }),\n          }).then(async (response) => {\n            const result = await response.json().catch(() => null);\n            logDiscordTrace(traceId, 'say-queue-bot-directed-result', {\n              ok: response.ok && Boolean(result?.ok),\n              status: response.status,\n              tenantId: sayChannelKey,\n              delivered: result?.delivered || null,\n              reason: result?.reason || result?.error || null,\n            });\n          }).catch((error) => {\n            logDiscordTrace(traceId, 'say-queue-bot-directed-result', {\n              ok: false,\n              tenantId: sayChannelKey,\n              error: error instanceof Error ? error.message : String(error),\n            });\n          });\n        }\n      } catch (error) {\n        logDiscordTrace(traceId, 'say-state-bot-directed-error', {\n          error: error instanceof Error ? error.message : String(error),\n        });\n      }\n    }\n\n    // Generate AI response\n    const botTenantId = botMatch?.tenantId;`;

if (!source.includes('say-queue-bot-directed-result')) {
  if (!source.includes(insertionMarker)) throw new Error('Could not find Discord bot response insertion marker');
  source = source.replace(insertionMarker, insertion);
}

for (const expected of [
  'speakerUserId: userId',
  'say-queue-bot-directed-result',
  'Bot-directed human messages must use the same !say path',
]) {
  if (!source.includes(expected)) throw new Error(`Discord TTS patch verification failed: ${expected}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Discord bot-directed !say TTS patch applied.');
