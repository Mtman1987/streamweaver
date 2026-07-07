const DISCORD_CHAT_STRING_FIELDS = [
  'userId',
  'guildId',
  'message',
  'dispatch',
  'userName',
  'channelId',
  'messageId',
  'userAvatar',
];

function escapeControlCharactersInsideStrings(source: string) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (const char of source) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (char < ' ' || char === '\u007F') output += ' ';
    else output += char;
  }

  return output;
}

function extractJsonStringField(source: string, key: string, nextKeys: string[] = []) {
  const simple = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 's'))?.[1];
  if (simple !== undefined) return simple;

  const marker = `"${key}"`;
  const keyIndex = source.indexOf(marker);
  if (keyIndex < 0) return '';
  const colonIndex = source.indexOf(':', keyIndex + marker.length);
  if (colonIndex < 0) return '';
  const firstQuoteIndex = source.indexOf('"', colonIndex + 1);
  if (firstQuoteIndex < 0) return '';

  let endIndex = -1;
  for (const nextKey of nextKeys) {
    const nextMarker = new RegExp(`"\\s*,\\s*"${nextKey}"\\s*:`, 's');
    const match = nextMarker.exec(source.slice(firstQuoteIndex + 1));
    if (match?.index !== undefined) {
      const candidate = firstQuoteIndex + 1 + match.index;
      if (endIndex < 0 || candidate < endIndex) endIndex = candidate;
    }
  }

  if (endIndex < 0) return '';
  return source.slice(firstQuoteIndex + 1, endIndex);
}

export function parseDiscordChatPayload(rawBody: string) {
  const raw = rawBody.trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {}

  const escapedControls = escapeControlCharactersInsideStrings(raw);
  try {
    return JSON.parse(escapedControls);
  } catch {}

  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    const salvaged = {
      userId: extractJsonStringField(raw, 'userId', DISCORD_CHAT_STRING_FIELDS.filter((key) => key !== 'userId')),
      guildId: extractJsonStringField(raw, 'guildId', DISCORD_CHAT_STRING_FIELDS.filter((key) => !['userId', 'guildId'].includes(key))),
      message: extractJsonStringField(raw, 'message', DISCORD_CHAT_STRING_FIELDS.filter((key) => !['userId', 'guildId', 'message'].includes(key))),
      userName: extractJsonStringField(raw, 'userName', ['channelId', 'messageId', 'userAvatar']),
      channelId: extractJsonStringField(raw, 'channelId', ['messageId', 'userAvatar']),
      messageId: extractJsonStringField(raw, 'messageId', ['userAvatar']),
      userAvatar: extractJsonStringField(raw, 'userAvatar', []),
    };

    if (salvaged.message && salvaged.channelId) {
      console.warn('[Discord Chat] Salvaged malformed JSON payload', {
        keys: Object.keys(salvaged).filter((key) => Boolean((salvaged as any)[key])),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return salvaged;
    }

    console.warn('[Discord Chat] Invalid JSON payload', {
      preview: raw.slice(0, 500),
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    return null;
  }
}
