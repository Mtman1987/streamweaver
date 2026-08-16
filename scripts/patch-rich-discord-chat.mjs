import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const filePath = path.join(repoRoot, relativePath);
  const diskSource = fs.readFileSync(filePath, 'utf8');
  // GitHub Windows runners check files out as CRLF while Fly/Linux uses LF.
  // Normalize only inside the disposable build workspace so deterministic
  // source markers behave identically on both platforms.
  const before = diskSource.replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before && diskSource === before) {
    console.log(`Rich Discord chat patch already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(filePath, after, 'utf8');
  console.log(`Rich Discord chat patch applied: ${relativePath}`);
}

patchFile('src/services/shared-chat-normalizers.ts', (source) => {
  const oldChannelId = "  const channelId = channelIdRaw ? `discord:${channelIdRaw}` : 'discord:unknown';";
  const newChannelId = "  const channelId = channelIdRaw || 'unknown';";
  if (source.includes(oldChannelId)) source = source.replace(oldChannelId, newChannelId);
  if (!source.includes(newChannelId)) throw new Error('Rich Discord chat patch: Discord channel-id marker missing');

  const oldRouting = "      canReply: Boolean(channelIdRaw),\n      replyTarget: channelIdRaw ? `discord:${channelIdRaw}` : undefined,";
  const newRouting = "      // Discord channel compose/delete are verified, but source-thread reply is\n      // not implemented by the SPMT outbound adapter. Do not advertise a dead action.\n      canReply: false,\n      replyTarget: undefined,";
  if (source.includes(oldRouting)) source = source.replace(oldRouting, newRouting);
  if (!source.includes('canReply: false,\n      replyTarget: undefined,')) {
    throw new Error('Rich Discord chat patch: Discord reply capability marker missing');
  }
  return source;
});

patchFile('src/services/discord-rich-chat.ts', (source) => {
  source = source.replace("signal: AbortSignal.timeout(5_000)", "signal: AbortSignal.timeout(1_800)");
  source = source.replace(".filter(Boolean))).slice(0, 30);", ".filter(Boolean))).slice(0, 12);");
  source = source.replace("/messages?limit=100`, 45_000", "/messages?limit=50`, 45_000");
  source = source.replace("mapWithConcurrency(channelIds, 4", "mapWithConcurrency(channelIds, 12");
  const oldReturn = "      sourceName: text(guild?.name) || event.sourceName,\n      channelName: channelName || event.channelName,";
  const newReturn = "      sourceName: text(guild?.name) || event.sourceName,\n      channelId: channelId || event.channelId,\n      channelName: channelName || event.channelName,";
  if (!source.includes('channelId: channelId || event.channelId')) {
    if (!source.includes(oldReturn)) throw new Error('Rich Discord chat patch: hydrated channel-id return marker missing');
    source = source.replace(oldReturn, newReturn);
  }

  const oldMetaStart = "      text: resolveDiscordText(content, message, channelNames, rolesByGuild.get(guildId) || new Map()),\n      media,\n      reply,\n      editedAt: text(message?.edited_timestamp) || event.editedAt,\n      meta: {";
  const newMetaStart = "      text: resolveDiscordText(content, message, channelNames, rolesByGuild.get(guildId) || new Map()),\n      media,\n      reply,\n      editedAt: text(message?.edited_timestamp) || event.editedAt,\n      // Old replay entries may have been recorded when Discord incorrectly\n      // advertised canReply=true. Hydration repairs that stale capability too.\n      routing: { ...event.routing, canReply: false, replyTarget: undefined },\n      meta: {";
  if (!source.includes('routing: { ...event.routing, canReply: false, replyTarget: undefined }')) {
    if (!source.includes(oldMetaStart)) throw new Error('Rich Discord chat patch: hydrated routing marker missing');
    source = source.replace(oldMetaStart, newMetaStart);
  }

  if (!source.includes('AbortSignal.timeout(1_800)')) throw new Error('Rich Discord chat patch: provider timeout marker missing');
  if (!source.includes('mapWithConcurrency(channelIds, 12')) throw new Error('Rich Discord chat patch: channel concurrency marker missing');
  if (!source.includes('channelId: channelId || event.channelId')) throw new Error('Rich Discord chat patch: legacy channel id normalization missing');
  if (!source.includes('routing: { ...event.routing, canReply: false, replyTarget: undefined }')) {
    throw new Error('Rich Discord chat patch: hydrated Discord reply capability repair missing');
  }
  return source;
});

patchFile('src/app/api/shared-chat/spmt-feed/route.ts', (source) => {
  const importLine = "import { enrichDiscordSharedChatEvents } from '@/services/discord-rich-chat';";
  if (!source.includes(importLine)) {
    const marker = "import { readSharedChatReplay } from '@/services/shared-chat-ingestion';";
    if (!source.includes(marker)) throw new Error('Rich Discord chat patch: feed import marker missing');
    source = source.replace(marker, `${marker}\n${importLine}`);
  }

  if (!source.includes('const filteredAll = replay.filter')) {
    const pattern = /(  const replay = dedupeEvents\(await readSharedChatReplay\(tenantId, \{ limit: 500 \}\)\);\n)  const filtered = replay\.filter\(\(event\) => \{([\s\S]*?)\n  \}\);/;
    const match = source.match(pattern);
    if (!match) throw new Error('Rich Discord chat patch: feed filtering marker missing');
    source = source.replace(pattern, `$1  const filteredAll = replay.filter((event) => {$2\n  });\n  // Hydrate only the bounded visible window. Discord channel/message lookups are\n  // cached, so Commlink gets names, avatars, mentions and rich media without\n  // turning a 500-event replay into hundreds of provider requests.\n  const filtered = await enrichDiscordSharedChatEvents(filteredAll.slice(-limit));`);
  }

  if (!source.includes('const channelReplay = replay.map')) {
    const marker = '  const channels = Array.from(new Map(replay.map((event) => {';
    if (!source.includes(marker)) throw new Error('Rich Discord chat patch: channels marker missing');
    const replacement = `  const richEventById = new Map(filtered.map((event) => [event.eventId, event]));\n  const channelReplay = replay.map((event) => richEventById.get(event.eventId) || event);\n  const channels = Array.from(new Map(channelReplay.map((event) => {`;
    source = source.replace(marker, replacement);
  }

  source = source.replace('    hasMore: filtered.length > events.length,', '    hasMore: filteredAll.length > events.length,');
  if (!source.includes('hasMore: filteredAll.length > events.length')) throw new Error('Rich Discord chat patch: hasMore marker missing');
  return source;
});

patchFile('src/server/websocket.ts', (source) => {
  const importMarker = "import { resolveTenantSocketAction } from './websocket-tenant';";
  const aliasImport = "import { resolveOverlayTenantId } from '../lib/overlay-tenant.server';";
  if (!source.includes(aliasImport)) {
    if (!source.includes(importMarker)) throw new Error('Overlay tenant alias patch: websocket import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${aliasImport}`);
  }

  const oldResolution = "        const urlTenantId = extractTenantIdFromRequest(request);\n        const cookieTenantId = extractTenantIdFromCookie(request);\n        const resolvedTenantId = cookieTenantId || urlTenantId;";
  const newResolution = "        const urlTenantAlias = extractTenantIdFromRequest(request);\n        const cookieTenantId = extractTenantIdFromCookie(request);\n        const urlTenantId = urlTenantAlias ? (await resolveOverlayTenantId(urlTenantAlias) || urlTenantAlias) : '';\n        const resolvedTenantId = cookieTenantId || urlTenantId;";
  if (!source.includes(newResolution)) {
    if (!source.includes(oldResolution)) throw new Error('Overlay tenant alias patch: websocket tenant marker missing');
    source = source.replace(oldResolution, newResolution);
  }

  if (!source.includes(aliasImport) || !source.includes('await resolveOverlayTenantId(urlTenantAlias)')) {
    throw new Error('Overlay tenant alias patch: websocket alias resolution missing');
  }
  return source;
});
