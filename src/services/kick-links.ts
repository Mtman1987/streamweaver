/**
 * Kick-to-Twitch Account Linking
 * Maps Kick usernames to Twitch user IDs so Kick viewers can use points/commands.
 */

import { promises as fs } from 'fs';
import { tenantPath } from '../lib/tenant';

interface KickLinks {
  [kickUsername: string]: { twitchId: string; twitchUsername: string; linkedAt: string };
}

const cache = new Map<string, KickLinks>();

function filePath(tenantId: string): string {
  return tenantPath(tenantId, 'data/kick-links.json');
}

async function load(tenantId: string): Promise<KickLinks> {
  if (cache.has(tenantId)) return cache.get(tenantId)!;
  try {
    const data = JSON.parse(await fs.readFile(filePath(tenantId), 'utf-8'));
    cache.set(tenantId, data);
    return data;
  } catch {
    cache.set(tenantId, {});
    return {};
  }
}

async function save(tenantId: string, links: KickLinks): Promise<void> {
  cache.set(tenantId, links);
  const fp = filePath(tenantId);
  const { mkdir } = await import('fs/promises');
  const { dirname } = await import('path');
  await mkdir(dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(links, null, 2));
}

export async function getLinkedTwitch(kickUsername: string, tenantId: string): Promise<{ twitchId: string; twitchUsername: string } | null> {
  const links = await load(tenantId);
  return links[kickUsername.toLowerCase()] || null;
}

export async function linkKickToTwitch(kickUsername: string, twitchId: string, twitchUsername: string, tenantId: string): Promise<void> {
  const links = await load(tenantId);
  links[kickUsername.toLowerCase()] = { twitchId, twitchUsername: twitchUsername.toLowerCase(), linkedAt: new Date().toISOString() };
  await save(tenantId, links);
  console.log(`[KickLinks] Linked ${kickUsername} → ${twitchUsername} (${twitchId}) for tenant ${tenantId}`);
}

export async function unlinkKick(kickUsername: string, tenantId: string): Promise<boolean> {
  const links = await load(tenantId);
  if (links[kickUsername.toLowerCase()]) {
    delete links[kickUsername.toLowerCase()];
    await save(tenantId, links);
    return true;
  }
  return false;
}
