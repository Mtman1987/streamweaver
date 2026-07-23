import * as fs from 'fs/promises';
import { dirname, resolve } from 'path';
import { listTenants, tenantPath } from '../lib/tenant';
import { readDiscordConfig } from '../lib/discord-config';
import { readUserConfigSync } from '../lib/user-config';
import { sendChatMessage } from './twitch';
import { uploadFileToDiscord } from './discord';
import { markUserWelcomed } from './welcome-wagon';
import { recordShoutout } from './welcome-wagon-tracker';
import { getRecentLogLines } from './runtime-log-buffer';

type RecoveryStatus = 'pending' | 'resolved' | 'reported';

interface WalkOnRecoveryJob {
  id: string;
  tenantId?: string;
  username: string;
  displayName: string;
  profileImage: string;
  firstFailureAt: string;
  retryAfter: string;
  attempts: number;
  lastError: string;
  status: RecoveryStatus;
}

const RETRY_DELAY_MS = Number(process.env.WALKON_RETRY_DELAY_MS || 5 * 60 * 1000);
const SCAN_INTERVAL_MS = 30 * 1000;
let schedulerStarted = false;
let restartRequested = false;

function circuitBreakerPath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/walk-on-recovery-circuit.json');
  return resolve(process.cwd(), 'data', 'walk-on-recovery-circuit.json');
}

function queuePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/walk-on-recovery-queue.json');
  return resolve(process.cwd(), 'data', 'walk-on-recovery-queue.json');
}

function jobId(tenantId: string | undefined, username: string): string {
  return `${tenantId || '__global__'}:${username.toLowerCase()}`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack || ''}`.trim();
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isNonRestartableDeliveryFailure(error: unknown): boolean {
  return /Shared chat source-only send (?:failed|skipped).+\((?:permission|broadcaster-not-found|sender-not-found|sender-unavailable)\)/i.test(stringifyError(error));
}

async function loadQueue(tenantId?: string): Promise<WalkOnRecoveryJob[]> {
  try {
    const raw = await fs.readFile(queuePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((job) => job?.status === 'pending') : [];
  } catch {
    return [];
  }
}

async function saveQueue(tenantId: string | undefined, jobs: WalkOnRecoveryJob[]): Promise<void> {
  const filePath = queuePath(tenantId);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(jobs, null, 2), 'utf-8');
}

async function isRestartCircuitOpen(tenantId?: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(circuitBreakerPath(tenantId), 'utf-8'));
    return parsed?.restartDisabled === true;
  } catch {
    return false;
  }
}

async function disableRestartCircuit(tenantId: string | undefined, reason: string): Promise<void> {
  const filePath = circuitBreakerPath(tenantId);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    restartDisabled: true,
    disabledAt: new Date().toISOString(),
    reason,
    note: 'Clear this file or set restartDisabled=false after fixing the root cause.',
  }, null, 2), 'utf-8');
}

async function shouldRestartProcess(tenantId?: string): Promise<boolean> {
  if (process.env.WALKON_RESTART_ON_FAILURE === 'false') return false;
  if (await isRestartCircuitOpen(tenantId)) return false;
  return process.env.WALKON_RESTART_ON_FAILURE === 'true' || Boolean(process.env.FLY_APP_NAME);
}

async function requestProcessRestart(tenantId: string | undefined, reason: string): Promise<void> {
  if (restartRequested || !(await shouldRestartProcess(tenantId))) {
    console.warn(`[WalkOnRecovery] Restart requested but not enabled: ${reason}`);
    return;
  }

  restartRequested = true;
  console.error(`[WalkOnRecovery] Restarting process for walk-on retry recovery: ${reason}`);
  const timer = setTimeout(() => process.exit(1), 1500);
  timer.unref?.();
}

export async function queueWalkOnRetry(input: {
  tenantId?: string;
  username: string;
  displayName: string;
  profileImage: string;
  error: unknown;
}): Promise<void> {
  const now = new Date();
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);
  const id = jobId(input.tenantId, input.username);
  const jobs = await loadQueue(input.tenantId);
  const existing = jobs.find((job) => job.id === id);

  if (existing) {
    existing.retryAfter = retryAt.toISOString();
    existing.attempts = Math.max(existing.attempts, 1);
    existing.lastError = stringifyError(input.error);
    existing.status = 'pending';
  } else {
    jobs.push({
      id,
      tenantId: input.tenantId,
      username: input.username.toLowerCase(),
      displayName: input.displayName,
      profileImage: input.profileImage,
      firstFailureAt: now.toISOString(),
      retryAfter: retryAt.toISOString(),
      attempts: 1,
      lastError: stringifyError(input.error),
      status: 'pending',
    });
  }

  await saveQueue(input.tenantId, jobs);
  if (isNonRestartableDeliveryFailure(input.error)) {
    console.warn(`[WalkOnRecovery] Queued non-restartable shared-chat delivery failure for ${input.displayName}; waiting for token or channel repair.`);
  } else {
    await requestProcessRestart(input.tenantId, `walk-on shoutout failed for ${input.displayName}`);
  }
}

async function getAlertDiscordChannelId(tenantId?: string): Promise<string | null> {
  const tenantConfig = readUserConfigSync(tenantId);
  const globalConfig = readUserConfigSync();
  const configured =
    process.env.WALKON_ALERT_DISCORD_CHANNEL_ID ||
    tenantConfig.WALKON_ALERT_DISCORD_CHANNEL_ID ||
    globalConfig.WALKON_ALERT_DISCORD_CHANNEL_ID;
  if (configured) return configured;

  if (!tenantId) return null;

  try {
    const channels = await readDiscordConfig(tenantId);
    return channels.logChannelId || channels.shoutoutChannelId || null;
  } catch {
    return null;
  }
}

async function buildSuggestedFixes(job: WalkOnRecoveryJob, retryError: string): Promise<string> {
  const evidence = `${job.lastError}\n\nRetry error:\n${retryError}`.toLowerCase();
  const suggestions = [
    'Confirm the tenant Twitch broadcaster and bot tokens are still valid, then reconnect Twitch from the StreamWeaver integration page.',
    'Check that only one Fly Machine is actively connected to Twitch chat to avoid duplicate IRC clients and message collisions.',
    'Verify TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are present on the running deployment; missing app credentials will break profile and clip lookup.',
  ];

  if (evidence.includes('client not available') || evidence.includes('no usable')) {
    suggestions.unshift('The Twitch IRC client was unavailable after restart. Inspect the tenant startup logs for token refresh or tmi.js connection failures.');
  }
  if (evidence.includes('unauthorized') || evidence.includes('authentication') || evidence.includes('401')) {
    suggestions.unshift('This looks auth-related. Reauthorize the broadcaster/bot token for this tenant and verify required chat scopes.');
  }
  if (evidence.includes('fetch') || evidence.includes('timeout') || evidence.includes('econn')) {
    suggestions.unshift('This may be network/API instability. Check Fly region health and Twitch API response failures around the failure time.');
  }

  return suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

async function reportFailure(job: WalkOnRecoveryJob, retryError: unknown, fallbackAttempted: boolean): Promise<void> {
  const retryErrorText = stringifyError(retryError);
  const channelId = await getAlertDiscordChannelId(job.tenantId);
  if (!channelId) {
    console.warn('[WalkOnRecovery] No Discord alert channel configured; report not sent.');
    return;
  }

  const suggestedFixes = await buildSuggestedFixes(job, retryErrorText);
  const recentLogs = getRecentLogLines(160);
  const report = [
    'StreamWeaver Walk-On Shoutout Failure Report',
    '===========================================',
    `Tenant ID: ${job.tenantId || 'global'}`,
    `User: ${job.displayName} (${job.username})`,
    `First failure: ${job.firstFailureAt}`,
    `Retry due: ${job.retryAfter}`,
    `Attempts before fallback: ${job.attempts + 1}`,
    '',
    'Initial error:',
    job.lastError || 'No error captured',
    '',
    'Retry error:',
    retryErrorText || 'No retry error captured',
    '',
    'Recent runtime logs:',
    recentLogs.length > 0 ? recentLogs.join('\n') : 'No buffered logs available in this process.',
    '',
    'Fallback result:',
    fallbackAttempted
      ? 'Simple text fallback was attempted after the retry failed.'
      : 'Simple text fallback was skipped because it would use the same blocked shared-chat authorization path.',
    'Walk-on restart recovery circuit was disabled for this tenant. Clear data/walk-on-recovery-circuit.json after fixing the root cause.',
    '',
    'Suggested next checks:',
    suggestedFixes,
  ].join('\n');

  const fileName = `walk-on-shoutout-${job.tenantId || 'global'}-${job.username}-${Date.now()}.txt`;
  await uploadFileToDiscord(
    channelId,
    report,
    fileName,
    `⚠️ Walk-on shoutout failed after retry for **${job.displayName}**. ${fallbackAttempted ? 'Simple text fallback was attempted.' : 'Authorization repair is required; duplicate fallback was skipped.'} Report attached.`
  ).catch((error) => {
    console.error('[WalkOnRecovery] Failed to upload Discord report:', error);
  });
}

async function sendSimpleFallback(job: WalkOnRecoveryJob): Promise<void> {
  const message = `Welcome @${job.displayName}! Go check them out: https://twitch.tv/${job.username}`;
  await sendChatMessage(message, 'bot', undefined, job.tenantId);
  await recordShoutout(job.username, job.tenantId);
  await markUserWelcomed(job.username, job.tenantId);
}

async function processQueueForTenant(tenantId?: string): Promise<void> {
  const jobs = await loadQueue(tenantId);
  if (jobs.length === 0) return;

  const now = Date.now();
  const remaining: WalkOnRecoveryJob[] = [];

  for (const job of jobs) {
    if (new Date(job.retryAfter).getTime() > now) {
      remaining.push(job);
      continue;
    }

    try {
      const { handleWalkOnShoutout } = await import('./walk-on-shoutout');
      const completed = await handleWalkOnShoutout(
        job.username,
        job.displayName,
        job.profileImage,
        false,
        job.tenantId
      );
      if (completed) {
        await markUserWelcomed(job.username, job.tenantId);
        console.log(`[WalkOnRecovery] Retry succeeded for ${job.displayName}`);
        continue;
      }
      throw new Error('Retry was skipped by cooldown/exclusion rules');
    } catch (retryError) {
      const fallbackAttempted = !isNonRestartableDeliveryFailure(retryError);
      console.error(`[WalkOnRecovery] Retry failed for ${job.displayName}; ${fallbackAttempted ? 'sending simple fallback' : 'authorization repair required'}`, retryError);
      if (fallbackAttempted) {
        try {
          await sendSimpleFallback(job);
        } catch (fallbackError) {
          console.error(`[WalkOnRecovery] Simple fallback failed for ${job.displayName}:`, fallbackError);
        }
      } else {
        console.warn(`[WalkOnRecovery] Skipping identical chat fallback for ${job.displayName}; authorization repair is required.`);
      }
      await reportFailure(job, retryError, fallbackAttempted);
      await disableRestartCircuit(job.tenantId, `Walk-on retry failed for ${job.displayName}; report sent and simple fallback attempted.`);
    }
  }

  await saveQueue(tenantId, remaining);
}

async function scanQueues(): Promise<void> {
  await processQueueForTenant();
  const tenantIds = await listTenants();
  for (const tenantId of tenantIds) {
    await processQueueForTenant(tenantId).catch((error) => {
      console.error(`[WalkOnRecovery] Queue scan failed for tenant ${tenantId}:`, error);
    });
  }
}

export function startWalkOnRecoveryScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  scanQueues().catch((error) => console.error('[WalkOnRecovery] Initial scan failed:', error));
  setInterval(() => {
    scanQueues().catch((error) => console.error('[WalkOnRecovery] Scheduled scan failed:', error));
  }, SCAN_INTERVAL_MS).unref?.();
}
