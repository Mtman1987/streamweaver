import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routePath = path.join(repoRoot, 'src', 'app', 'api', 'discord', 'chat', 'route.ts');
let source = fs.readFileSync(routePath, 'utf8').replace(/\r\n/g, '\n');

const importLine = "import { requestSpmtOwnerRecoveryCode } from '@/lib/spmt-client';";
if (!source.includes(importLine)) {
  const importMarker = "import { internalServiceHeaders } from '@/lib/internal-service-auth';";
  if (!source.includes(importMarker)) throw new Error('Owner recovery patch: import marker missing');
  source = source.replace(importMarker, `${importMarker}\n${importLine}`);
}

const sensitiveMarker = '    if (tenantId && message) {\n      try {';
const sensitiveReplacement = `    // Owner recovery commands contain account identifiers and must never be copied\n    // into the shared Commlink replay/history. The resulting code is returned only\n    // to the verified owner in the private Discord lane.\n    const isSensitiveOwnerRecoveryCommand = isPrivateDiscordLane && /^!spmtpassword(?:\\s|$)/i.test(message.trim());\n\n    if (tenantId && message && !isSensitiveOwnerRecoveryCommand) {\n      try {`;
if (!source.includes('const isSensitiveOwnerRecoveryCommand =')) {
  if (!source.includes(sensitiveMarker)) throw new Error('Owner recovery patch: ingestion marker missing');
  source = source.replace(sensitiveMarker, sensitiveReplacement);
}

const privateLaneMarker = `    if (isPrivateDiscordLane) {\n      if (!tenantId) {`;
const privateLaneReplacement = `    if (isPrivateDiscordLane) {\n      // Emergency owner recovery must not depend on resolving the DM to a tenant.\n      // SPMT authenticates the immutable requester Discord ID and admin flag itself.\n      const ownerRecoveryMatch = message.trim().match(/^!spmtpassword(?:\\s+(.+))?$/i);\n      if (ownerRecoveryMatch) {\n        const targetDiscordId = String(ownerRecoveryMatch[1] || '').replace(/[<@!>]/g, '').trim();\n        const recoveryBotName = tenantId ? getBotName(tenantId) : 'Athena';\n        if (!/^\\d{15,24}$/.test(targetDiscordId)) {\n          if (channelId) {\n            await sendDiscordRouteReplyOrCollect(\n              channelId,\n              'Usage: !spmtpassword <discordId> in this private Athena DM. This creates a one-time SPMT recovery code; it does not set a default password.',\n              recoveryBotName,\n              'SPMT Recovery',\n            );\n          }\n          if (tenantId) await markDmMessageHandled(tenantId, normalized.messageId);\n          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId: tenantId || null, context: 'private-spmt-recovery', error: 'invalid-target' });\n        }\n\n        try {\n          const handoff = await requestSpmtOwnerRecoveryCode({\n            requesterDiscordId: userId,\n            targetDiscordId,\n          });\n          if (channelId) {\n            await sendDiscordRouteReplyOrCollect(\n              channelId,\n              [\n                'SPMT recovery handoff: **' + handoff.account + '**',\n                'Recovery code: **' + handoff.recoveryCode + '**',\n                'Give that account name and code to the tenant. They open https://spmt.live, choose **Recover**, enter both, then choose their own new password.',\n                'This code replaces any older unused recovery code for that account. Keep it in DM only.',\n              ].join('\\n'),\n              recoveryBotName,\n              'SPMT Owner Recovery',\n            );\n          }\n          if (tenantId) await markDmMessageHandled(tenantId, normalized.messageId);\n          return apiOk({\n            success: true,\n            botResponded: Boolean(channelId),\n            tenantId: tenantId || null,\n            context: 'private-spmt-recovery',\n            account: handoff.account,\n            targetDiscordId,\n          });\n        } catch (error: any) {\n          const status = Number(error?.status || 0);\n          const safeMessage = status === 403\n            ? 'This owner recovery command is not authorized for your Discord account.'\n            : status === 404\n              ? 'No SPMT account is linked to that Discord ID.'\n              : status === 409\n                ? 'That Discord ID is linked ambiguously. Manual SPMT review is required.'\n                : 'SPMT recovery could not create a code right now. Try again after SPMT is healthy.';\n          if (channelId) {\n            await sendDiscordRouteReplyOrCollect(channelId, safeMessage, recoveryBotName, 'SPMT Recovery');\n          }\n          if (tenantId) await markDmMessageHandled(tenantId, normalized.messageId);\n          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId: tenantId || null, context: 'private-spmt-recovery', error: 'recovery-failed', status });\n        }\n      }\n\n      if (!tenantId) {`;
if (!source.includes('const ownerRecoveryMatch =')) {
  if (!source.includes(privateLaneMarker)) throw new Error('Owner recovery patch: private DM lane marker missing');
  source = source.replace(privateLaneMarker, privateLaneReplacement);
}

fs.writeFileSync(routePath, source, 'utf8');
console.log('Owner recovery DM patch applied.');
