export type CommandCooldownScope = {
  command: string;
  tenantId?: string;
  userId?: string;
};

export type CommandCooldownResult = {
  allowed: boolean;
  remainingMs: number;
  expiresAt: number;
};

const cooldowns = new Map<string, number>();

function cooldownKey(scope: CommandCooldownScope): string {
  return [
    String(scope.tenantId || 'global').trim().toLowerCase(),
    String(scope.command || '').trim().toLowerCase(),
    String(scope.userId || 'all').trim().toLowerCase(),
  ].join(':');
}

export function checkCommandCooldown(
  scope: CommandCooldownScope,
  durationMs: number,
  now = Date.now(),
): CommandCooldownResult {
  const key = cooldownKey(scope);
  const expiresAt = cooldowns.get(key) || 0;
  const remainingMs = Math.max(0, expiresAt - now);

  if (remainingMs > 0) {
    return { allowed: false, remainingMs, expiresAt };
  }

  const nextExpiry = now + Math.max(0, durationMs);
  cooldowns.set(key, nextExpiry);
  return { allowed: true, remainingMs: 0, expiresAt: nextExpiry };
}

export function clearCommandCooldown(scope: CommandCooldownScope): void {
  cooldowns.delete(cooldownKey(scope));
}

export function resetCommandCooldowns(): void {
  cooldowns.clear();
}
