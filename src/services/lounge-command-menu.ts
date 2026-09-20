import { buildLoungeCategoryReplies, buildLoungeCommandMenu } from '@/lib/lounge-command-directory';

type CommandMenuContext = {
  platform: 'twitch' | 'discord';
  tenantId?: string;
  channelId?: string;
  username: string;
  isMod: boolean;
};

type PendingMenu = { expiresAt: number; isMod: boolean };

const MENU_TTL_MS = 2 * 60_000;
const pendingMenus = new Map<string, PendingMenu>();

function key(context: CommandMenuContext) {
  return [context.platform, context.tenantId || 'global', context.channelId || 'global', context.username.toLowerCase()].join(':');
}

function prune(now: number) {
  for (const [menuKey, pending] of pendingMenus) {
    if (pending.expiresAt <= now) pendingMenus.delete(menuKey);
  }
}

export function beginLoungeCommandMenu(context: CommandMenuContext, now = Date.now()) {
  prune(now);
  pendingMenus.set(key(context), { expiresAt: now + MENU_TTL_MS, isMod: context.isMod });
  return buildLoungeCommandMenu();
}

export function directLoungeCommandCategory(messageValue: unknown, isMod: boolean) {
  const match = String(messageValue || '').trim().match(/^!commands\s+([1-8])$/i);
  return match ? buildLoungeCategoryReplies(Number(match[1]), isMod) : null;
}

export function consumeLoungeCommandMenuChoice(messageValue: unknown, context: CommandMenuContext, now = Date.now()) {
  prune(now);
  const match = String(messageValue || '').trim().match(/^([1-8])$/);
  if (!match) return null;
  const menuKey = key(context);
  const pending = pendingMenus.get(menuKey);
  if (!pending || pending.expiresAt <= now) return null;
  pendingMenus.delete(menuKey);
  return buildLoungeCategoryReplies(Number(match[1]), pending.isMod || context.isMod);
}

export function resetLoungeCommandMenusForTests() {
  pendingMenus.clear();
}
