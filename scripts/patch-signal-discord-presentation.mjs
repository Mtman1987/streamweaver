import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) {
    console.log(`[SignalPresentationPatch] already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[SignalPresentationPatch] applied: ${relativePath}`);
}

patch('src/services/signal-system.ts', (source) => {
  source = source.replace("import { buildBotAvatarUrl, resolveDiscordBotThumbnailUrl } from './discord-branding';\n", '');
  source = source.replace("import { hasTenantOwnAvatar } from './discord-avatar-media';\n", '');

  const tenantMarker = "const SIGNAL_TWITCH_TENANT_ID = String(process.env.SIGNAL_TWITCH_TENANT_ID || 'spacemountainlive').trim();";
  const spotlightConstant = "const SIGNAL_COMMUNITY_SPOTLIGHT_GIF_URL = 'https://cdn.discordapp.com/emojis/1284931162896334929.gif';";
  if (!source.includes(spotlightConstant)) {
    if (!source.includes(tenantMarker)) throw new Error('Signal presentation patch: tenant marker missing');
    source = source.replace(tenantMarker, `${tenantMarker}\n${spotlightConstant}`);
  }

  const oldHelper = `async function resolveSignalDiscordAvatarUrl(): Promise<string> {\n  const configured = String(process.env.SIGNAL_DISCORD_GIF_URL || '').trim();\n  if (/^https?:\\/\\//i.test(configured)) return configured;\n  if (hasTenantOwnAvatar(SIGNAL_TWITCH_TENANT_ID)) return buildBotAvatarUrl(SIGNAL_TWITCH_TENANT_ID);\n  return resolveDiscordBotThumbnailUrl(SIGNAL_TWITCH_TENANT_ID).catch(() => '');\n}`;
  const newHelper = `function resolveSignalEmbedBadgeUrl(): string {\n  const configured = String(process.env.SIGNAL_DISCORD_GIF_URL || '').trim();\n  return /^https?:\\/\\//i.test(configured) ? configured : SIGNAL_COMMUNITY_SPOTLIGHT_GIF_URL;\n}`;
  if (!source.includes(newHelper)) {
    if (!source.includes(oldHelper)) throw new Error('Signal presentation patch: old Signal avatar helper missing');
    source = source.replace(oldHelper, newHelper);
  }

  const oldBlock = `  const signalAvatarUrl = await resolveSignalDiscordAvatarUrl();\n  const local = await sendWebhookMessage(\n    input.sourceChannelId,\n    '',\n    input.actualUsername,\n    signalAvatarUrl || input.sourceUserAvatarUrl,\n    [{\n      title: '📡 SIGNAL',\n      description: boldSignalText(signalText),\n      color: 0x22d3ee,\n      ...(signalAvatarUrl ? { thumbnail: { url: signalAvatarUrl } } : {}),\n    }],\n  );`;
  const newBlock = `  const signalBadgeUrl = resolveSignalEmbedBadgeUrl();\n  const webhookAvatarUrl = String(input.sourceUserAvatarUrl || '').trim()\n    || 'https://cdn.discordapp.com/embed/avatars/0.png';\n  const webhookUsername = String(\n    input.msg.member?.displayName\n    || input.msg.displayName\n    || input.msg.author?.globalName\n    || input.msg.author?.global_name\n    || input.actualUsername\n    || 'Discord User'\n  ).trim();\n\n  const local = await sendWebhookMessage(\n    input.sourceChannelId,\n    '',\n    webhookUsername,\n    webhookAvatarUrl,\n    [{\n      title: '📡 SIGNAL',\n      description: boldSignalText(signalText),\n      color: 0x22d3ee,\n      thumbnail: { url: signalBadgeUrl },\n      footer: { text: 'SIGNAL LOCKED • MESSAGE ACQUIRED' },\n    }],\n  );`;
  if (!source.includes("footer: { text: 'SIGNAL LOCKED • MESSAGE ACQUIRED' }")) {
    if (!source.includes(oldBlock)) throw new Error('Signal presentation patch: Discord Signal send block missing');
    source = source.replace(oldBlock, newBlock);
  }

  if (!source.includes('webhookAvatarUrl') || !source.includes('SIGNAL_COMMUNITY_SPOTLIGHT_GIF_URL')) {
    throw new Error('Signal presentation patch: Signal presentation postcondition failed');
  }
  return source;
});

patch('src/app/api/discord/chat/route.ts', (source) => {
  const oldAuthor = `        author: {\n          id: userId,\n          username: normalized.username,\n          globalName: userName,\n          global_name: userName,\n          bot: false,\n        },`;
  const newAuthor = `        userAvatar,\n        avatarUrl: userAvatar,\n        author: {\n          id: userId,\n          username: normalized.username,\n          globalName: userName,\n          global_name: userName,\n          avatarUrl: userAvatar,\n          bot: false,\n        },`;

  if (!source.includes('          avatarUrl: userAvatar,\n          bot: false,')) {
    if (!source.includes(oldAuthor)) throw new Error('Signal presentation patch: Discord command author marker missing');
    source = source.replace(oldAuthor, newAuthor);
  }

  if (!source.includes('        userAvatar,\n        avatarUrl: userAvatar,\n        author: {')) {
    throw new Error('Signal presentation patch: Discord avatar propagation postcondition failed');
  }
  return source;
});
