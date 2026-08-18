import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function patch(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) {
    console.log(`[SignalPatch] already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[SignalPatch] applied: ${relativePath}`);
}

patch('src/services/chat-dispatcher.ts', (source) => {
  const importMarker = "import { sendDiscordCommandShoutout } from './discord-command-shoutout';";
  const signalImport = "import { handleDiscordSignalCommand, handleTwitchSignalCommand } from './signal-system';";
  if (!source.includes(signalImport)) {
    if (!source.includes(importMarker)) throw new Error('Signal patch: command import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${signalImport}`);
  }

  const nativeMarker = "    'commands', 'admin', 'so', 'watchtime', 'time', 'coinflip', 'leaderboard',";
  const nativeReplacement = "    'commands', 'admin', 'so', 'signal', 'watchtime', 'time', 'coinflip', 'leaderboard',";
  if (!source.includes(nativeReplacement)) {
    if (!source.includes(nativeMarker)) throw new Error('Signal patch: native command marker missing');
    source = source.replace(nativeMarker, nativeReplacement);
  }

  if (!source.includes("if (cmdName === 'signal')")) {
    const soMarker = "    if (cmdName === 'so') {";
    const signalBlock = `    if (cmdName === 'signal') {\n        try {\n            const result = await handleDiscordSignalCommand({\n                msg,\n                tenantId,\n                actualUsername,\n                actualMessage,\n                sourceChannelId,\n                sourceUserAvatarUrl,\n            });\n            if (!result.ok && result.message) {\n                await reply(\`@\${actualUsername}, \${result.message}\`);\n            }\n        } catch (error: any) {\n            console.error('[Discord Dispatcher] !signal failed:', error);\n            await reply(\`@\${actualUsername}, Signal failed: \${error?.message || 'unknown error'}\`);\n        }\n        return true;\n    }\n\n`;
    if (!source.includes(soMarker)) throw new Error('Signal patch: Discord !so marker missing');
    source = source.replace(soMarker, `${signalBlock}${soMarker}`);
  }

  if (!source.includes("handleTwitchSignalCommand({")) {
    const activityMarker = `    recordDashboardActivity({\n        id: String(tags.id || \`twitch-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`),\n        tenantId,`;
    const twitchBlock = `    if (isCommand && /^!signal(?:\\s|$)/i.test(actualMessage)) {\n        try {\n            const result = await handleTwitchSignalCommand({\n                providerUserId: String(tags['user-id'] || tags.userId || ''),\n                username: actualUsername,\n                broadcaster: replyChannel,\n                tenantId,\n                rawMessage: actualMessage,\n            });\n            if (!result.ok && result.message) {\n                await replyMaybeKick(result.message, 'bot').catch(() => {});\n            }\n        } catch (error: any) {\n            console.error('[Dispatcher] Twitch !signal failed:', error);\n            await replyMaybeKick(\`@\${actualUsername}, Signal failed: \${error?.message || 'unknown error'}\`, 'bot').catch(() => {});\n        }\n        return;\n    }\n\n`;
    if (!source.includes(activityMarker)) throw new Error('Signal patch: Twitch activity marker missing');
    source = source.replace(activityMarker, `${twitchBlock}${activityMarker}`);
  }

  return source;
});

patch('server.ts', (source) => {
  if (source.includes('startSignalScheduler();')) return source;
  const marker = "        const serverHost = process.env.SERVER_HOST || (isProductionRuntime ? '0.0.0.0' : appConfig?.server?.host || '127.0.0.1');";
  const block = `        if (process.env.SIGNAL_SCHEDULER_ENABLED === 'true') {\n            try {\n                const { startSignalScheduler } = await import('./src/services/signal-system');\n                startSignalScheduler();\n                console.log('[Signal] Lost Signal scheduler armed');\n            } catch (error) {\n                console.warn('[Signal] Scheduler startup skipped:', error);\n            }\n        } else {\n            console.log('[Signal] Lost Signal scheduler disabled until SIGNAL_SCHEDULER_ENABLED=true');\n        }\n\n`;
  if (!source.includes(marker)) throw new Error('Signal patch: server startup marker missing');
  return source.replace(marker, `${block}${marker}`);
});
