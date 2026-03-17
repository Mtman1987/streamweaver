// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  🔔 NOTIFICATION HELPER                                               ║
// ║  Easy-to-use notifications for overlays                              ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import { showOverlay } from './overlay-manager';

export async function notify(message: string, icon?: string): Promise<void> {
  await showOverlay('notification', { message, icon });
}

export async function notifySuccess(message: string): Promise<void> {
  await notify(message, '✅');
}

export async function notifyError(message: string): Promise<void> {
  await notify(message, '❌');
}

export async function notifyInfo(message: string): Promise<void> {
  await notify(message, 'ℹ️');
}

export async function notifyWarning(message: string): Promise<void> {
  await notify(message, '⚠️');
}
