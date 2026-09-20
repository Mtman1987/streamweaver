import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '../lib/tenant';

export function shouldQueueTwitchSay(input: {
  tenantId?: string;
  username: string;
  isCommand: boolean;
  isBotMessage: boolean;
  isKnownAutomationBotMessage: boolean;
}): boolean {
  if (input.isCommand) return false;
  if (!input.isBotMessage && !input.isKnownAutomationBotMessage) return true;

  return String(input.tenantId || '').toLowerCase() === SPACEMOUNTAIN_SYSTEM_TENANT_ID
    && input.username.toLowerCase() === 'stellabot87';
}
