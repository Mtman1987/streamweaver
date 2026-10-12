import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { tenantPath } from '@/lib/tenant';
import type { StorageContext } from './storage';
const held = new AsyncLocalStorage<Set<string>>();
export async function withTenantPointMutation<T>(ctx: StorageContext | undefined, task: () => Promise<T>): Promise<T> {
  if (!ctx?.tenantId) return task();
  const lockPath = path.join(tenantPath(ctx.tenantId,'data'),ctx.username,'points.mutation.lock');
  if (held.getStore()?.has(lockPath)) return task();
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  const token = randomUUID(), deadline = Date.now()+20_000;
  while (true) {
    try { fs.writeFileSync(lockPath,token,{flag:'wx'}); break; }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      try { if(Date.now()-fs.statSync(lockPath).mtimeMs>120_000) fs.unlinkSync(lockPath); } catch {}
      if(Date.now()>deadline) throw new Error('Channel points are busy. Try the import again shortly.');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  try { return await held.run(new Set([...(held.getStore()||[]),lockPath]),task); }
  finally { try { if(fs.readFileSync(lockPath,'utf8')===token) fs.unlinkSync(lockPath); } catch {} }
}
