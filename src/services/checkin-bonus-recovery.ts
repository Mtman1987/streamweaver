import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { globalPath, tenantPath, tenantRoot } from '../lib/tenant';
import { getStoredTokens } from '../lib/token-utils.server';
import { awardNebulaCheckinBonus } from './nebula-actions';
import { sendTwitchChatMessage } from './twitch';
import { getTenantIdFromChannel } from './twitch-client';
const taskLock = require('proper-lockfile') as { lock(file: string, options: Record<string, unknown>): Promise<() => Promise<void>> };

type BonusInput = Parameters<typeof awardNebulaCheckinBonus>[0];
type Award = Awaited<ReturnType<typeof awardNebulaCheckinBonus>>;
type Task = { input: BonusInput; tenantId?: string };
const directory = () => globalPath('checkin-bonus-outbox');
const fileFor = (input: BonusInput) => path.join(directory(), createHash('sha256').update(input.awardId).digest('hex') + '.json');
let running = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;

async function atomicWrite(file: string, value: unknown) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

// Claim through a hard link so another process never reads a half-written task.
export async function rememberPendingCheckinBonus(input: BonusInput, tenantId?: string): Promise<string> {
  await fs.mkdir(directory(), { recursive: true });
  const file = fileFor(input);
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify({ input, tenantId } satisfies Task), { mode: 0o600 });
    try { await fs.link(temporary, file); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Task;
    if (saved.input.channel !== input.channel || saved.input.username !== input.username
        || saved.input.userId !== input.userId) throw new Error('Check-in award ID belongs to another rider.');
    return file;
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function completePendingCheckinBonus(file: string, award: Award, notify = true): Promise<void> {
  let task: Task;
  try { task = JSON.parse(await fs.readFile(file, 'utf8')) as Task; }
  catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  let receiptFound = false;
  const confirm = () => sendTwitchChatMessage('@' + task.input.username + ' earned +100 Nebula points for the front seat!', 'bot', task.input.channel, getTenantIdFromChannel(task.input.channel) || task.tenantId);
  if (task.tenantId && /^[a-f0-9]{64}$/.test(task.input.awardId)) {
    const receipt = tenantPath(task.tenantId, 'data/chat-tag-checkins/' + task.input.awardId + '.json');
    try {
      const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
      receiptFound = true;
      // The HTTP check-in is still constructing its receipt. Leave the task
      // durable until that response is saved, avoiding a cross-process overwrite.
      if (saved.pending) return;
      if (saved.payload?.kind === 'space-mountain') {
        saved.bonusRecoveryNoticePending ||= saved.payload.frontSeatBonusStatus !== 'credited';
        saved.payload.frontSeatBonusPoints = award.amount;
        saved.payload.frontSeatBonusStatus = 'credited';
        saved.payload.frontSeatNebulaBalance = award.balance;
        saved.reply = String(saved.reply || '').replace(
          /(?:Nebula bonus could not be confirmed|Bonus unconfirmed)/g,
          'Bonus: +' + award.amount + ' Nebula points',
        );
        saved.bonusRecoveredAt = new Date().toISOString();
        await atomicWrite(receipt, saved);
        if (saved.bonusRecoveryNoticePending) {
          if (!notify) return;
          await confirm();
          saved.bonusRecoveryNoticePending = false;
          await atomicWrite(receipt, saved);
        }
      }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!receiptFound && notify) await confirm();
  await fs.unlink(file).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
}

export async function recoverPendingCheckinBonuses(now = Date.now()): Promise<number> {
  if (running) return 0;
  running = true;
  let recovered = 0;
  try {
    await fs.mkdir(directory(), { recursive: true });
    const files = (await fs.readdir(directory())).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    let attempted = 0;
    for (const name of files) {
      const file = path.join(directory(), name);
      let release: (() => Promise<void>) | undefined;
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs < 60_000) continue;
        if (++attempted > 25) break;
        release = await taskLock.lock(file, { realpath: false, stale: 120_000, update: 20_000, retries: 0 });
        const task = JSON.parse(await fs.readFile(file, 'utf8')) as Task;
        const award = await awardNebulaCheckinBonus(task.input);
        await completePendingCheckinBonus(file, award);
        recovered++;
        console.info('[CheckinBonusRecovery] Wallet confirmed award:', task.input.awardId);
      } catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'ELOCKED') continue; // Another process completed it.
        await fs.utimes(file, new Date(now), new Date(now)).catch(() => {});
        console.warn('[CheckinBonusRecovery] Saved award will retry:', error);
      } finally { if (release) await release().catch(() => {}); }
    }
  } finally { running = false; }
  return recovered;
}

// Backfill previous incomplete receipts with their original wallet award IDs.
export async function restoreUnfinishedCheckinBonuses() {
  const tenants = await fs.readdir(path.dirname(tenantRoot('_')));
  for (const tenantId of tenants.filter(value => /^[a-zA-Z0-9_-]{2,64}$/.test(value))) {
    const folder = tenantPath(tenantId, 'data/chat-tag-checkins');
    let files: string[];
    try { files = await fs.readdir(folder); }
    catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
    for (const name of files.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const file = path.join(folder, name);
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > 24 * 60 * 60_000) continue;
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      if (saved.payload?.kind !== 'space-mountain' || saved.payload.frontSeatBonusStatus !== 'unconfirmed') continue;
      const tokens = /^\d+$/.test(tenantId) ? await getStoredTokens(tenantId) : null;
      const channel = tokens?.broadcasterUsername || tenantId;
      const entry = saved.payload.entry;
      const username = String(entry?.twitchLogin || saved.payload.frontSeat || '').toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(channel) || !/^[a-z0-9_]{1,25}$/.test(username)) continue;
      const task = await rememberPendingCheckinBonus({
        awardId: name.slice(0, -5), channel, username,
        userId: entry?.twitchUserId, displayName: saved.payload.frontSeat,
      }, tenantId);
      // Existing failed receipts are immediately eligible for recovery.
      const old = new Date(Date.now() - 61_000);
      await fs.utimes(task, old, old);
    }
  }
}

export function startCheckinBonusRecovery() {
  if (recoveryTimer) return;
  const tick = () => void recoverPendingCheckinBonuses().catch(error =>
    console.error('[CheckinBonusRecovery] Recovery pass failed:', error));
  void restoreUnfinishedCheckinBonuses().then(tick).catch(error =>
    console.error('[CheckinBonusRecovery] Receipt recovery failed:', error));
  recoveryTimer = setInterval(tick, 30_000);
  recoveryTimer.unref();
}
