function readDiscordMention(source: any, userId: string): any | null {
  if (!source) return null;
  if (typeof source.get === 'function') return source.get(userId) || null;
  if (Array.isArray(source)) {
    return source.find((entry: any) =>
      String(entry?.id || entry?.userId || entry?.user?.id || '') === userId
    ) || null;
  }
  return source[userId] || null;
}

export function resolveDiscordUserMention(
  rawTarget: unknown,
  dataOrMentions: any,
): { userId: string; displayName: string } | null {
  const match = String(rawTarget || '').trim().match(/^<@!?(\d+)>$/);
  if (!match) return null;

  const userId = match[1];
  const mentions = dataOrMentions?.mentions || dataOrMentions || {};
  const user = readDiscordMention(mentions.users || mentions, userId);
  const member = readDiscordMention(mentions.members, userId);
  const displayName =
    member?.displayName ||
    member?.display_name ||
    member?.nick ||
    member?.user?.globalName ||
    member?.user?.global_name ||
    member?.user?.username ||
    user?.displayName ||
    user?.globalName ||
    user?.global_name ||
    user?.username ||
    userId;

  return { userId, displayName };
}

export function replaceDiscordUserMentions(text: unknown, dataOrMentions: any): string {
  return String(text || '').replace(/<@!?(\d+)>/g, (mention) => {
    const resolved = resolveDiscordUserMention(mention, dataOrMentions);
    if (!resolved || resolved.displayName === resolved.userId) return mention;
    return `@${resolved.displayName}`;
  });
}
