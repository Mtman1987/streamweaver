import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const filePath = path.join(repoRoot, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after === before) {
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

patchFile('public/commlink/commlink.js', (source) => {
  if (!source.includes('function renderProviderChatText(')) {
    const marker = 'function canonicalProvider(item) {';
    if (!source.includes(marker)) throw new Error('Rich Discord chat patch: Commlink provider marker missing');
    const helper = `function renderProviderChatText(item, provider) {\n  const normalized = normalizeProviderMentions(item?.text, item);\n  let rendered = escapeHtml(normalized).replaceAll('\\n', '<br>');\n  if (provider === 'discord') {\n    rendered = rendered.replace(/&lt;(a?):([A-Za-z0-9_~.-]{1,64}):(\\d{15,24})&gt;/g, (_token, animated, name, id) => {\n      const src = \\`https://cdn.discordapp.com/emojis/\\${encodeURIComponent(id)}.webp?size=48\\${animated ? '&animated=true' : ''}\\`;\n      return \\`<img class="inline-chat-emote" src="\\${src}" alt=":\\${escapeHtml(name)}:" title=":\\${escapeHtml(name)}:" loading="lazy">\\`;\n    });\n  }\n  return rendered;\n}\n\n`;
    source = source.replace(marker, helper + marker);
  }

  const oldText = "    text: escapeHtml(normalizeProviderMentions(item.text, item)).replaceAll('\\n', '<br>'),";
  const newText = "    text: renderProviderChatText(item, provider),";
  if (source.includes(oldText)) source = source.replace(oldText, newText);
  if (!source.includes(newText)) throw new Error('Rich Discord chat patch: message text marker missing');

  const oldStreamweaver = "    streamweaver: item.meta?.streamweaver && typeof item.meta.streamweaver === 'object' ? item.meta.streamweaver : null,";
  const newStreamweaver = `${oldStreamweaver}\n    discord: item.meta?.discord && typeof item.meta.discord === 'object' ? item.meta.discord : null,`;
  if (!source.includes('discord: item.meta?.discord')) {
    if (!source.includes(oldStreamweaver)) throw new Error('Rich Discord chat patch: Discord meta marker missing');
    source = source.replace(oldStreamweaver, newStreamweaver);
  }

  if (!source.includes('const discordEmbeds =')) {
    const mediaMarker = "  const media = (message.media || []).slice(0, 4).map((item) => {";
    if (!source.includes(mediaMarker)) throw new Error('Rich Discord chat patch: media renderer marker missing');
    const embedRenderer = `  const discordEmbeds = (message.discord?.embeds || []).slice(0, 4).map((embed) => {\n    const fields = (embed.fields || []).slice(0, 8).map((field) => \\`<div class="discord-embed-field"><strong>\\${escapeHtml(field.name || '')}</strong><span>\\${escapeHtml(field.value || '')}</span></div>\\`).join('');\n    return \\`<div class="discord-embed-card">\n      \\${embed.author ? \\`<small>\\${escapeHtml(embed.author)}\\</small>\\` : ''}\n      \\${embed.title ? \\`<strong>\\${escapeHtml(embed.title)}\\</strong>\\` : ''}\n      \\${embed.description ? \\`<p>\\${escapeHtml(embed.description)}\\</p>\\` : ''}\n      \\${fields ? \\`<div class="discord-embed-fields">\\${fields}</div>\\` : ''}\n      \\${embed.provider || embed.footer ? \\`<small>\\${escapeHtml([embed.provider, embed.footer].filter(Boolean).join(' · '))}\\</small>\\` : ''}\n    </div>\\`;\n  }).join('');\n`;
    source = source.replace(mediaMarker, embedRenderer + mediaMarker);
  }

  const oldMediaRow = "      ${media ? `<div class=\"message-media-row\">${media}</div>` : ''}";
  const newMediaRow = "      ${media ? `<div class=\"message-media-row\">${media}</div>` : ''}\n      ${discordEmbeds ? `<div class=\"discord-embed-list\">${discordEmbeds}</div>` : ''}";
  if (!source.includes('discord-embed-list')) {
    if (!source.includes(oldMediaRow)) throw new Error('Rich Discord chat patch: message media row marker missing');
    source = source.replace(oldMediaRow, newMediaRow);
  }

  return source;
});

patchFile('public/commlink/commlink.css', (source) => {
  if (source.includes('.inline-chat-emote')) return source;
  return `${source}\n\n/* Canonical rich-chat rendering: provider emotes and Discord embeds stay inside the message card. */\n.inline-chat-emote {\n  display: inline-block;\n  width: 1.5em;\n  height: 1.5em;\n  object-fit: contain;\n  vertical-align: -0.32em;\n  margin: 0 0.08em;\n}\n.discord-embed-list {\n  display: grid;\n  gap: 8px;\n  margin-top: 8px;\n}\n.discord-embed-card {\n  display: grid;\n  gap: 5px;\n  max-width: 680px;\n  padding: 10px 12px;\n  border-left: 3px solid rgba(88, 101, 242, 0.8);\n  border-radius: 6px;\n  background: rgba(88, 101, 242, 0.08);\n}\n.discord-embed-card > strong {\n  font-size: 0.92rem;\n}\n.discord-embed-card > p,\n.discord-embed-field span {\n  margin: 0;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n.discord-embed-card > small {\n  opacity: 0.7;\n}\n.discord-embed-fields {\n  display: grid;\n  gap: 7px;\n}\n.discord-embed-field {\n  display: grid;\n  gap: 2px;\n  font-size: 0.82rem;\n}\n`;
});
