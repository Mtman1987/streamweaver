import { withTenantPointMutation } from './points-mutation-lock';
import { randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFile, type StorageContext } from './storage';
import { parseLoyaltyImport, type WatchUnit } from './loyalty-import-parser';
import { snapshotWatchtime, importWatchtimeMinutes } from './user-stats';
import { importLoyaltyPointBalances } from './points';
export async function previewLoyaltyImport(text: string, unit: WatchUnit, ctx: StorageContext) {
  const parsed = parseLoyaltyImport(text,unit);
  const [points,stats] = await Promise.all([readJsonFile<Record<string,any>>('points.json',{},ctx), snapshotWatchtime(ctx)]);
  const receipts = await readJsonFile<Record<string,any>>('loyalty-import-receipts.json',{},ctx);
  const changes = parsed.rows.map(row => {
    const currentPoints = BigInt(String(points[row.username]?.points || 0));
    const currentWatch = Number(stats[row.username]?.watchtime || 0);
    const afterPoints = row.points === undefined ? currentPoints : BigInt(row.points) > currentPoints ? BigInt(row.points) : currentPoints;
    const afterWatch = Math.max(currentWatch,row.watchMinutes || 0);
    return { username: row.username, beforePoints: currentPoints.toString(), afterPoints: afterPoints.toString(), beforeWatchMinutes: currentWatch, afterWatchMinutes: afterWatch, changed: afterPoints !== currentPoints || afterWatch !== currentWatch };
  });
  return { alreadyImported:!!receipts[parsed.digest], digest: parsed.digest, viewers: parsed.rows.length, changed: changes.filter(r=>r.changed).length, sample: changes.slice(0,50), channel:ctx.username };
}
async function applyLoyaltyImportUnlocked(text: string, unit: WatchUnit, digest: string, ctx: StorageContext) {
  const parsed = parseLoyaltyImport(text,unit);
  if (parsed.digest !== digest) throw new Error('The file changed. Preview it again before importing.');
  const receipts = await readJsonFile<Record<string,any>>('loyalty-import-receipts.json',{},ctx);
  if (receipts[parsed.digest]) return { imported:0, alreadyImported:true, backupId:receipts[parsed.digest].backupId, channel:ctx.username };
  const backupId = randomUUID();
  const [points,watchtime] = await Promise.all([readJsonFile('points.json',{},ctx),snapshotWatchtime(ctx)]);
  await writeJsonFile('loyalty-import-' + backupId + '.json',{ source:'streamelements', tenantId:ctx.tenantId, channel:ctx.username, digest, createdAt:new Date().toISOString(), points, watchtime },ctx);
  // Max-merge is deliberately idempotent. Existing totals never decrease, and
  // retrying the same file after an interruption cannot double any balances.
  await importLoyaltyPointBalances(parsed.rows,ctx);
  await importWatchtimeMinutes(parsed.rows,ctx.username,ctx);
  receipts[parsed.digest] = {backupId, completedAt:new Date().toISOString(), viewers:parsed.rows.length};
  await writeJsonFile('loyalty-import-receipts.json',receipts,ctx);
  return { imported:parsed.rows.length, backupId, channel:ctx.username };
}

export async function applyLoyaltyImport(...args: Parameters<typeof applyLoyaltyImportUnlocked>) { return withTenantPointMutation(args[3],()=>applyLoyaltyImportUnlocked(...args)); }
