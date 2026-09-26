type PendingCardPack = {
  message: any;
  expiresAt: number;
};

const TTL_MS = 45_000;
const pending = new Map<string, PendingCardPack>();

function key(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/^#/, '');
}

export function rememberPendingCardPack(tenantId: unknown, message: any) {
  const tenant = key(tenantId);
  const type = String(message?.type || '');
  if (!tenant || !['card-pack-opened', 'pokemon-pack-opened', 'quackverse-pack-opened'].includes(type)) return;
  pending.set(tenant, { message, expiresAt: Date.now() + TTL_MS });
}

export function getPendingCardPack(tenantId: unknown) {
  const tenant = key(tenantId);
  if (!tenant) return null;
  const entry = pending.get(tenant);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pending.delete(tenant);
    return null;
  }
  return entry.message;
}

export function cardPackOverlayAliases(input: { tenantId?: unknown; channel?: unknown; platform?: unknown }) {
  const aliases = new Set<string>();
  const tenant = key(input.tenantId);
  if (tenant) aliases.add(tenant);
  if (String(input.platform || '').toLowerCase() === 'twitch') {
    const channel = key(input.channel);
    if (channel) aliases.add(channel);
  }
  return [...aliases];
}
