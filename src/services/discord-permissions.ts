const DISCORD_PERMISSION_BITS = {
  Administrator: 1n << 3n,
  ManageGuild: 1n << 5n,
  ManageMessages: 1n << 13n,
} as const;

const PERMANENT_APP_OWNER_DISCORD_IDS = new Set([
  '767875979561009173',
  String(process.env.STREAMWEAVER_OWNER_DISCORD_ID || '').trim(),
  String(process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID || '').trim(),
].filter(Boolean));

function normalizePermissionValues(memberPermissions: unknown): string[] {
  if (Array.isArray(memberPermissions)) {
    return memberPermissions.map((value) => String(value).trim()).filter(Boolean);
  }

  const raw = String(memberPermissions || '').trim();
  if (!raw) return [];
  return raw.split(/[,\s|]+/).map((value) => value.trim()).filter(Boolean);
}

function hasNamedDiscordModPermission(values: string[]): boolean {
  return values.some((value) =>
    value === 'Administrator' ||
    value === 'ManageGuild' ||
    value === 'ManageMessages'
  );
}

function hasBitfieldDiscordModPermission(values: string[]): boolean {
  for (const value of values) {
    if (!/^\d+$/.test(value)) continue;
    try {
      const bitfield = BigInt(value);
      if ((bitfield & DISCORD_PERMISSION_BITS.Administrator) !== 0n) return true;
      if ((bitfield & DISCORD_PERMISSION_BITS.ManageGuild) !== 0n) return true;
      if ((bitfield & DISCORD_PERMISSION_BITS.ManageMessages) !== 0n) return true;
    } catch {
      // Ignore malformed bitfields.
    }
  }
  return false;
}

export function hasDiscordModAccess(input: {
  id?: unknown;
  userId?: unknown;
  user_id?: unknown;
  author?: { id?: unknown } | null;
  isAdmin?: unknown;
  isMod?: unknown;
  isOwner?: unknown;
  memberPermissions?: unknown;
}): boolean {
  const userId = String(input.author?.id || input.userId || input.user_id || input.id || '').trim();
  if (userId && PERMANENT_APP_OWNER_DISCORD_IDS.has(userId)) {
    return true;
  }

  if (Boolean(input.isAdmin) || Boolean(input.isMod) || Boolean(input.isOwner)) {
    return true;
  }

  const values = normalizePermissionValues(input.memberPermissions);
  return hasNamedDiscordModPermission(values) || hasBitfieldDiscordModPermission(values);
}
