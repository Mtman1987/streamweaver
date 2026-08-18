import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routePath = path.join(repoRoot, 'src/app/api/discord/chat/route.ts');
let source = fs.readFileSync(routePath, 'utf8').replace(/\r\n/g, '\n');

const importLine = "import { resolvePrivateDiscordTenant } from '@/services/private-discord-tenant';";
if (!source.includes(importLine)) {
  const marker = "import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';";
  if (!source.includes(marker)) throw new Error('Private DM privacy patch: import marker missing');
  source = source.replace(marker, `${marker}\n${importLine}`);
}

const unsafeResolution = `    const isPrivateDiscordLane = isDirectMessage;\n    let tenantId = normalized.tenantId;\n    let tenantResolution = tenantId ? 'payload' : 'none';\n    if (!tenantId) {\n      tenantId = isPrivateDiscordLane\n        ? await resolveGuildTenant('', channelId)\n        : await resolveDiscordAuthorTenant(userId, userName);\n      tenantResolution = tenantId ? (isPrivateDiscordLane ? 'dm-channel' : 'discord-author') : 'none';\n    }\n    if (!tenantId && !isPrivateDiscordLane && dshAccess?.isOwner) {`;

const safeResolution = `    const isPrivateDiscordLane = isDirectMessage;\n    let tenantId: string | undefined;\n    let tenantResolution = 'none';\n\n    if (isPrivateDiscordLane) {\n      // PRIVATE DATA BOUNDARY: never trust a forwarded tenantId for Discord DMs.\n      // Verify the exact Discord message + immutable author ID, then resolve only\n      // that user's configured/SPMT tenant. Unknown DMs fail closed and cannot\n      // read or append another tenant's private history.\n      const privateTenant = await resolvePrivateDiscordTenant({\n        discordUserId: userId,\n        discordUsername: normalized.username,\n        channelId,\n        messageId: normalized.messageId,\n      });\n      tenantId = privateTenant?.tenantId;\n      tenantResolution = privateTenant?.source || 'none';\n\n      if (!tenantId) {\n        logDiscordTrace(traceId, 'private-tenant-rejected', {\n          channelId: channelId || null,\n          messageId: normalized.messageId || null,\n          userId: userId || null,\n          reason: 'private-discord-identity-not-verified',\n        });\n        return apiOk({\n          success: true,\n          botResponded: false,\n          skipped: 'unverified-private-tenant',\n        });\n      }\n    } else {\n      tenantId = normalized.tenantId || await resolveDiscordAuthorTenant(userId, userName);\n      tenantResolution = normalized.tenantId ? 'payload' : (tenantId ? 'discord-author' : 'none');\n    }\n\n    if (!tenantId && !isPrivateDiscordLane && dshAccess?.isOwner) {`;

if (source.includes(unsafeResolution)) {
  source = source.replace(unsafeResolution, safeResolution);
}

if (!source.includes(importLine)) throw new Error('Private DM privacy patch: resolver import missing');
if (!source.includes("skipped: 'unverified-private-tenant'")) throw new Error('Private DM privacy patch: fail-closed marker missing');
if (source.includes("isPrivateDiscordLane\n        ? await resolveGuildTenant('', channelId)")) {
  throw new Error('Private DM privacy patch: unsafe owner/channel fallback still present');
}
if (source.includes("let tenantId = normalized.tenantId;\n    let tenantResolution = tenantId ? 'payload' : 'none';")) {
  throw new Error('Private DM privacy patch: private lane still trusts payload tenant');
}

fs.writeFileSync(routePath, source, 'utf8');
console.log('Private DM privacy patch applied: src/app/api/discord/chat/route.ts');
