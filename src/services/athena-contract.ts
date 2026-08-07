export const ATHENA_SURFACES = [
  'twitch-chat',
  'kick-chat',
  'discord-channel',
  'discord-dm',
  'streamweaver-private',
  'rotator-workbench',
  'mountainview',
  'app-layout',
  'internal',
] as const;

export type AthenaSurface = (typeof ATHENA_SURFACES)[number];
export type AthenaVisibility = 'public' | 'private';
export type AthenaReplyMode = 'chat' | 'voice' | 'structured' | 'silent';
export type AthenaRole = 'user' | 'assistant' | 'system' | 'tool';

export type AthenaActor = {
  userId?: string;
  username: string;
  displayName?: string;
  isOwner?: boolean;
  isAdmin?: boolean;
  isModerator?: boolean;
};

export type AthenaLocation = {
  app?: string;
  surface: AthenaSurface;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  channelType?: string | number;
  messageId?: string;
  createdAt?: string;
  live?: boolean;
  layout?: string;
  replyMode?: AthenaReplyMode;
  capabilities?: string[];
};

export type AthenaTransientMessage = {
  role: Exclude<AthenaRole, 'tool'>;
  content: string;
};

export type AthenaRequest = {
  tenantId: string;
  message: string;
  actor: AthenaActor;
  location: AthenaLocation;
  visibility: AthenaVisibility;
  conversationId?: string;
  transientHistory?: AthenaTransientMessage[];
  personalityOverride?: string;
  responseName?: string;
  additionalContext?: string;
  executeTools?: boolean;
  confirmedActionId?: string;
  metadata?: Record<string, unknown>;
};

export type AthenaDecision = {
  mode: 'chat' | 'tool' | 'command' | 'confirm';
  reason: string;
  confidence: number;
  toolId?: string;
  command?: string;
  arguments?: Record<string, unknown>;
  risk?: 'read' | 'reversible' | 'destructive';
  actionId?: string;
  executed?: boolean;
  delivered?: boolean;
};

export type AthenaResponse = {
  response: string;
  provider: string;
  model: string;
  visibility: AthenaVisibility;
  surface: AthenaSurface;
  conversationId: string;
  decision: AthenaDecision;
  images?: string[];
  memorySources: Array<{
    id: string;
    visibility: AthenaVisibility;
    label: string;
    sourceApp: string;
    sourceSurface: AthenaSurface | 'legacy';
    timestamp: string;
  }>;
};

const PRIVATE_SURFACES = new Set<AthenaSurface>([
  'discord-dm',
  'streamweaver-private',
  'rotator-workbench',
  'mountainview',
  'app-layout',
  'internal',
]);

const LIVE_SURFACES = new Set<AthenaSurface>(['twitch-chat', 'kick-chat', 'discord-channel']);

export function isAthenaSurface(value: unknown): value is AthenaSurface {
  return typeof value === 'string' && (ATHENA_SURFACES as readonly string[]).includes(value);
}

export function isPrivateAthenaSurface(surface: AthenaSurface): boolean {
  return PRIVATE_SURFACES.has(surface);
}

export function trustedVisibilityForSurface(surface: AthenaSurface): AthenaVisibility {
  return isPrivateAthenaSurface(surface) ? 'private' : 'public';
}

export function isLiveAthenaSurface(surface: AthenaSurface): boolean {
  return LIVE_SURFACES.has(surface);
}

function cleanPart(value: unknown, fallback: string): string {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

export function deriveAthenaConversationId(request: Pick<AthenaRequest, 'tenantId' | 'actor' | 'location' | 'visibility' | 'conversationId'>): string {
  if (request.conversationId?.trim()) {
    return cleanPart(request.conversationId, 'conversation');
  }

  const tenant = cleanPart(request.tenantId, 'tenant');
  const surface = cleanPart(request.location.surface, 'surface');
  const channel = cleanPart(
    request.location.channelId || request.location.channelName || request.location.layout,
    request.visibility === 'private' ? 'private' : 'public',
  );
  const participant = request.visibility === 'private'
    ? cleanPart(request.actor.userId || request.actor.username, 'user')
    : 'audience';

  return [tenant, surface, channel, participant].join(':');
}

export function describeAthenaLocation(location: AthenaLocation, visibility: AthenaVisibility): string {
  const audience = visibility === 'private'
    ? 'This is a private authenticated context. Public and private memory may be used.'
    : 'This is a public context. Private memory is unavailable and must not be mentioned.';
  const live = location.live ?? isLiveAthenaSurface(location.surface);
  const place = [
    `app=${location.app || 'streamweaver'}`,
    `surface=${location.surface}`,
    location.guildName ? `guild=${location.guildName}` : '',
    location.channelName ? `channel=${location.channelName}` : '',
    location.layout ? `layout=${location.layout}` : '',
    `live=${live ? 'true' : 'false'}`,
    `replyMode=${location.replyMode || (live ? 'chat' : 'structured')}`,
  ].filter(Boolean).join('; ');
  const capabilities = location.capabilities?.length
    ? `Available surface capabilities: ${location.capabilities.join(', ')}.`
    : 'No extra surface capabilities were declared.';

  return [
    `Current location: ${place}.`,
    audience,
    capabilities,
    'Use this location to decide whether to answer conversationally, call a safe tool, or run a command that is valid on this surface.',
  ].join(' ');
}

export function surfaceAllowsTransportCommands(surface: AthenaSurface): boolean {
  return surface === 'twitch-chat' || surface === 'kick-chat' || surface === 'discord-channel' || surface === 'discord-dm';
}
