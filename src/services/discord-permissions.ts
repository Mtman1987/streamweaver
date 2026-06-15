const DISCORD_PERMISSION_BITS = {
  Administrator: 1n << 3n,
  ManageGuild: 1n << 5n,
  ManageMessages: 1n << 13n,
} as const;

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
  isAdmin?: unknown;
  isMod?: unknown;
  isOwner?: unknown;
  memberPermissions?: unknown;
}): boolean {
  if (Boolean(input.isAdmin) || Boolean(input.isMod) || Boolean(input.isOwner)) {
    return true;
  }

  const values = normalizePermissionValues(input.memberPermissions);
  return hasNamedDiscordModPermission(values) || hasBitfieldDiscordModPermission(values);
}
