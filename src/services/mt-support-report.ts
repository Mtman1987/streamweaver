import * as fs from 'fs/promises';
import { createDiscordDmChannel, uploadFileToDiscord } from './discord';
import { readPublicChatMessages } from '@/lib/public-chat-store';
import { globalPath } from '@/lib/tenant';
import { readUserConfigSync } from '@/lib/user-config';
import { getRecentLogLines } from './runtime-log-buffer';
import { readDiscordConfig } from '@/lib/discord-config';
import { createMtCodexJob } from './mt-codex-gateway';

type SupportPlatform = 'twitch' | 'discord';

type SupportContext = {
  platform: SupportPlatform;
  tenantId?: string;
  username: string;
  channelId?: string;
  reporterId?: string;
};

type PendingSupportRequest = SupportContext & {
  createdAt: number;
};

type SubmitSupportReportInput = SupportContext & {
  description: string;
  triggerMessage: string;
};

type SubmitSupportReportResult = {
  ok: boolean;
  jobId?: string;
  dashboardUrl?: string;
  dmSent?: boolean;
  dmChannelId?: string;
  error?: string;
};

const PENDING_TTL_MS = 10 * 60 * 1000;

const globalState = global as typeof globalThis & {
  __streamweaverPendingMtSupportRequests?: Map<string, PendingSupportRequest>;
};

function getPendingSupportRequests(): Map<string, PendingSupportRequest> {
  if (!globalState.__streamweaverPendingMtSupportRequests) {
    globalState.__streamweaverPendingMtSupportRequests = new Map<string, PendingSupportRequest>();
  }
  return globalState.__streamweaverPendingMtSupportRequests;
}

function normalizeUsername(value: string): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function makeSupportKey(context: SupportContext): string {
  return [
    context.platform,
    context.tenantId || '__global__',
    context.channelId || '__no-channel__',
    normalizeUsername(context.username),
  ].join(':');
}

function cleanupExpiredPendingRequests(): void {
  const now = Date.now();
  const pending = getPendingSupportRequests();
  for (const [key, request] of pending.entries()) {
    if (now - request.createdAt > PENDING_TTL_MS) pending.delete(key);
  }
}

export function detectMtFixItIntent(message: string): { matched: boolean; description: string } {
  const text = String(message || '').trim();
  if (!text) return { matched: false, description: '' };

  const commandMatch = text.match(/^!mtfixit(?:\s+(.+))?$/i);
  if (commandMatch) return { matched: true, description: String(commandMatch[1] || '').trim() };

  const voiceAliasMatch = text.match(/^mt\s+fix\s+it(?:\s+(.+))?$/i);
  if (voiceAliasMatch) return { matched: true, description: String(voiceAliasMatch[1] || '').trim() };

  return { matched: false, description: '' };
}

export function beginPendingMtSupportRequest(context: SupportContext): void {
  cleanupExpiredPendingRequests();
  getPendingSupportRequests().set(makeSupportKey(context), { ...context, createdAt: Date.now() });
}

export function hasPendingMtSupportRequest(context: SupportContext): boolean {
  cleanupExpiredPendingRequests();
  return getPendingSupportRequests().has(makeSupportKey(context));
}

export function consumePendingMtSupportRequest(context: SupportContext): boolean {
  cleanupExpiredPendingRequests();
  return getPendingSupportRequests().delete(makeSupportKey(context));
}

export function getMtSupportPrompt(_platform: SupportPlatform): string {
  return 'tell me what broke and Athena will launch a private coding sandbox for the Commander.';
}

export function getMtFixItPublicReply(username: string): string {
  return `@${username}, Athena has logged the repair request for Commander review. The coding stars are aligning.`;
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/("?(?:access|refresh|api|client|bot)?_?token"?\s*[:=]\s*")([^"\r\n]+)"/gi, '$1[redacted]"')
    .replace(/("?(?:client|api)?_?secret"?\s*[:=]\s*")([^"\r\n]+)"/gi, '$1[redacted]"');
}

async function readDiscordChannelSettings(tenantId?: string): Promise<Record<string, unknown>> {
  try {
    return await readDiscordConfig(tenantId) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function getConfiguredSupportDestinationChannelId(): Promise<string> {
  const fromEnv = String(process.env.MT_SUPPORT_DM_CHANNEL_ID || '').trim();
  if (fromEnv) return fromEnv;
  const rootSettings = await readDiscordChannelSettings();
  return String(rootSettings.dmChannelId || '').trim();
}

async function resolveOwnerDmChannelId(): Promise<string> {
  const ownerId = String(process.env.MTMAN_DISCORD_USER_ID || '767875979561009173').trim();
  if (ownerId) {
    try {
      const dm = await createDiscordDmChannel(ownerId);
      if (dm.id) return dm.id;
    } catch (error) {
      console.warn('[MtFixIt] Could not create owner DM channel; trying configured fallback:', error);
    }
  }
  return getConfiguredSupportDestinationChannelId();
}

async function readRecentFlyLogLines(limit = 80): Promise<string[]> {
  try {
    const raw = await fs.readFile(globalPath('fly-logs.txt'), 'utf-8');
    return raw.split(/\r?\n/).filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

function formatChatTranscript(messages: Awaited<ReturnType<typeof readPublicChatMessages>>): string {
  if (!messages.length) return 'No recent public chat history captured.';
  return messages.map((entry) => `[${entry.timestamp}] ${entry.username} (${entry.type}): ${entry.message}`).join('\n');
}

export async function submitMtSupportReport(input: SubmitSupportReportInput): Promise<SubmitSupportReportResult> {
  const reporter = normalizeUsername(input.username) || 'unknown';
  const description = String(input.description || '').trim();
  if (!description) return { ok: false, error: 'Missing issue description.' };

  const tenantId = input.tenantId;
  const tenantDiscordSettings = await readDiscordChannelSettings(tenantId);
  const publicChat = await readPublicChatMessages(25, tenantId);
  const runtimeLogs = getRecentLogLines(120).map(redactSensitiveText);
  const flyLogs = (await readRecentFlyLogLines(80)).map(redactSensitiveText);

  let broadcasterUsername = '';
  try {
    broadcasterUsername = String(readUserConfigSync(tenantId).TWITCH_BROADCASTER_USERNAME || '').trim();
  } catch {
    broadcasterUsername = '';
  }

  const reportText = [
    'StreamWeaver Tenant Support Report',
    '================================',
    `Captured At: ${new Date().toISOString()}`,
    `Tenant ID: ${tenantId || 'global'}`,
    `Broadcaster: ${broadcasterUsername || 'unknown'}`,
    `Reporter: ${reporter}`,
    `Reporter ID: ${input.reporterId || 'unknown'}`,
    `Platform: ${input.platform}`,
    `Source Channel: ${input.channelId || 'unknown'}`,
    `Trigger: ${input.triggerMessage}`,
    '',
    'Issue Description',
    '-----------------',
    description,
    '',
    'Tenant Discord Settings',
    '-----------------------',
    `guildId: ${String(tenantDiscordSettings.guildId || '') || '(not set)'}`,
    `logChannelId: ${String(tenantDiscordSettings.logChannelId || '') || '(not set)'}`,
    `dmChannelId: ${String(tenantDiscordSettings.dmChannelId || '') || '(not set)'}`,
    `discordBridgeEnabled: ${String(tenantDiscordSettings.discordBridgeEnabled ?? 'true')}`,
    '',
    'Recent Public Chat',
    '------------------',
    formatChatTranscript(publicChat),
    '',
    'Recent Runtime Logs',
    '-------------------',
    runtimeLogs.length > 0 ? runtimeLogs.join('\n') : 'No buffered runtime logs available.',
    '',
    'Recent Fly Log Tail',
    '-------------------',
    flyLogs.length > 0 ? flyLogs.join('\n') : 'No fly-logs.txt tail available.',
  ].join('\n');

  const fileSafeReporter = reporter.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'reporter';
  const fileName = `mt-support-${tenantId || 'global'}-${fileSafeReporter}-${Date.now()}.txt`;
  const summary = `Support report from ${reporter}${broadcasterUsername ? ` in ${broadcasterUsername}'s tenant` : ''}. Description: ${description.slice(0, 160)}`;

  const job = await createMtCodexJob({
    source: input.platform,
    tenantId,
    reporter,
    reporterId: input.reporterId,
    channelId: input.channelId,
    description,
    triggerMessage: input.triggerMessage,
    context: {
      broadcasterUsername,
      recentPublicChat: formatChatTranscript(publicChat).slice(-6000),
      recentRuntimeLogs: runtimeLogs.slice(-30),
      recentFlyLogs: flyLogs.slice(-20),
    },
  });
  if (!job.ok) return job;

  const destinationChannelId = await resolveOwnerDmChannelId();
  if (!destinationChannelId) {
    return { ...job, dmSent: false, error: 'Codex job created, but Athena could not create or resolve the owner DM channel.' };
  }

  const ownerMessage = [
    `Athena Codex request from ${reporter} on ${input.platform}.`,
    `Job: ${job.jobId || 'queued'}`,
    `Issue: ${description.slice(0, 500)}`,
    `Repair station: ${job.dashboardUrl || 'https://mtman-machine-rotator.fly.dev/athena'}`,
  ].join('\n');

  try {
    await uploadFileToDiscord(destinationChannelId, reportText, fileName, `${ownerMessage}\n\n${summary}`.slice(0, 1900));
    return { ...job, dmSent: true, dmChannelId: destinationChannelId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[MtFixIt] Codex job created but owner DM failed:', message);
    return { ...job, dmSent: false, dmChannelId: destinationChannelId, error: `Codex job created, but owner DM failed: ${message}` };
  }
}
