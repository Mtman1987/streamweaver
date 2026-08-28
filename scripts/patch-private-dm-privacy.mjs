import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const filePath = path.join(repoRoot, relativePath);
  const diskSource = fs.readFileSync(filePath, 'utf8');
  const source = diskSource.replace(/\r\n/g, '\n');
  const next = transform(source);
  fs.writeFileSync(filePath, next, 'utf8');
  console.log(`Private DM privacy patch applied: ${relativePath}`);
}

patchFile('src/app/api/discord/chat/route.ts', (source) => {
  const importLine = "import { resolvePrivateDiscordTenant } from '@/services/private-discord-tenant';";
  if (!source.includes(importLine)) {
    const marker = "import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';";
    if (!source.includes(marker)) throw new Error('Private DM privacy patch: route import marker missing');
    source = source.replace(marker, `${marker}\n${importLine}`);
  }

  const unsafeResolution = `    const isPrivateDiscordLane = isDirectMessage;\n    let tenantId = normalized.tenantId;\n    let tenantResolution = tenantId ? 'payload' : 'none';\n    if (!tenantId) {\n      tenantId = isPrivateDiscordLane\n        ? await resolveGuildTenant('', channelId)\n        : await resolveDiscordAuthorTenant(userId, userName);\n      tenantResolution = tenantId ? (isPrivateDiscordLane ? 'dm-channel' : 'discord-author') : 'none';\n    }\n    if (!tenantId && !isPrivateDiscordLane && dshAccess?.isOwner) {`;

  const safeResolution = `    const isPrivateDiscordLane = isDirectMessage;\n    let tenantId: string | undefined;\n    let tenantResolution = 'none';\n\n    if (isPrivateDiscordLane) {\n      // PRIVATE DATA BOUNDARY: never trust a forwarded tenantId for Discord DMs.\n      // Verify the exact Discord message + immutable author ID, then resolve only\n      // that user's configured/SPMT tenant. Unknown DMs fail closed and cannot\n      // read or append another tenant's private history.\n      const privateTenant = await resolvePrivateDiscordTenant({\n        discordUserId: userId,\n        discordUsername: normalized.username,\n        channelId,\n        messageId: normalized.messageId,\n      });\n      tenantId = privateTenant?.tenantId;\n      tenantResolution = privateTenant?.source || 'none';\n\n      if (!tenantId) {\n        logDiscordTrace(traceId, 'private-tenant-rejected', {\n          channelId: channelId || null,\n          messageId: normalized.messageId || null,\n          userId: userId || null,\n          reason: 'private-discord-identity-not-verified',\n        });\n        return apiOk({\n          success: true,\n          botResponded: false,\n          skipped: 'unverified-private-tenant',\n        });\n      }\n    } else if (permanentOwner) {\n      const ownerTenantId = getAdminTwitchId().trim();\n      if (ownerTenantId && (await listTenants()).includes(ownerTenantId)) {\n        tenantId = ownerTenantId;\n        tenantResolution = 'discord-owner';\n      }\n    } else {\n      tenantId = normalized.tenantId || await resolveDiscordAuthorTenant(userId, userName);\n      tenantResolution = normalized.tenantId ? 'payload' : (tenantId ? 'discord-author' : 'none');\n    }\n\n    if (!tenantId && !isPrivateDiscordLane && dshAccess?.isOwner) {`;

  if (source.includes(unsafeResolution)) source = source.replace(unsafeResolution, safeResolution);

  if (!source.includes(importLine)) throw new Error('Private DM privacy patch: route resolver import missing');
  if (!source.includes("skipped: 'unverified-private-tenant'")) throw new Error('Private DM privacy patch: route fail-closed marker missing');
  if (!source.includes('} else if (permanentOwner) {')) throw new Error('Private DM privacy patch: permanent owner routing missing');
  if (source.includes("isPrivateDiscordLane\n        ? await resolveGuildTenant('', channelId)")) {
    throw new Error('Private DM privacy patch: unsafe route owner/channel fallback still present');
  }
  if (source.includes("let tenantId = normalized.tenantId;\n    let tenantResolution = tenantId ? 'payload' : 'none';")) {
    throw new Error('Private DM privacy patch: private route still trusts payload tenant');
  }
  return source;
});

patchFile('src/services/chat-monitor.ts', (source) => {
  const importLine = "import { resolvePrivateDiscordTenant } from './private-discord-tenant';";
  if (!source.includes(importLine)) {
    const marker = "import { pollOwns } from './discord-processing-owner';";
    if (!source.includes(marker)) throw new Error('Private DM privacy patch: sweep import marker missing');
    source = source.replace(marker, `${marker}\n${importLine}`);
  }

  const marker = `        for (const msg of newMessages.reverse()) {\n            if (msg?.author?.bot) continue;\n            const messageText = String(msg?.content || '').trim();`;
  const replacement = `        for (const msg of newMessages.reverse()) {\n            if (msg?.author?.bot) continue;\n\n            // PRIVATE DATA BOUNDARY: a configured DM channel is not sufficient\n            // proof of tenant ownership. Verify the exact Discord message and\n            // immutable author ID, then require it to resolve back to this loop's\n            // tenant before touching private history or private settings.\n            const verifiedPrivateTenant = await resolvePrivateDiscordTenant({\n                discordUserId: msg.author?.id,\n                discordUsername: msg.author?.username,\n                channelId: normalizedDmChannelId,\n                messageId: msg.id,\n            });\n            if (!verifiedPrivateTenant || verifiedPrivateTenant.tenantId !== tenantId) {\n                console.error('[DM Sweep] Refusing private message with mismatched tenant ownership', {\n                    configuredTenantId: tenantId,\n                    verifiedTenantId: verifiedPrivateTenant?.tenantId || null,\n                    channelId: normalizedDmChannelId,\n                    messageId: msg.id || null,\n                    discordUserId: msg.author?.id || null,\n                });\n                continue;\n            }\n\n            const messageText = String(msg?.content || '').trim();`;

  if (!source.includes('verifiedPrivateTenant = await resolvePrivateDiscordTenant')) {
    if (!source.includes(marker)) throw new Error('Private DM privacy patch: sweep processing marker missing');
    source = source.replace(marker, replacement);
  }

  if (!source.includes(importLine)) throw new Error('Private DM privacy patch: sweep resolver import missing');
  if (!source.includes('verifiedPrivateTenant.tenantId !== tenantId')) {
    throw new Error('Private DM privacy patch: sweep tenant ownership guard missing');
  }
  return source;
});
