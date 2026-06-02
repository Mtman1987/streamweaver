import { getAllActions, getActionById } from '@/lib/actions-store';
import { getCommandById } from '@/lib/commands-store';
import { SubActionExecutor, type ExecutionContext } from '@/services/automation/SubActionExecutor';
import { TriggerType, type Action, type Command } from '@/services/automation/types';

export type ManualRunInput = {
  user?: string;
  userName?: string;
  message?: string;
  rawInput?: string;
  platform?: string;
  channel?: string;
  args?: Record<string, any>;
};

function buildArgs(rawInput: string, extraArgs?: Record<string, any>): Record<string, any> {
  const args: Record<string, any> = { ...(extraArgs || {}), rawInput };
  rawInput
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .forEach((part, index) => {
      args[`input${index}`] = part;
    });
  return args;
}

function buildContext(input: ManualRunInput, tenantId?: string): ExecutionContext {
  const userName = input.userName || input.user || 'StreamWeaverTester';
  const rawInput = input.rawInput ?? '';
  const args = {
    ...buildArgs(rawInput, input.args),
    tenantId: tenantId || '',
    channel: input.channel || '',
  };

  return {
    user: userName,
    userName,
    message: input.message || rawInput,
    rawInput,
    platform: input.platform || 'twitch',
    tenantId,
    args,
    variables: {
      ...args,
      user: userName,
      userName,
      message: input.message || rawInput,
      rawInput,
      platform: input.platform || 'twitch',
      tenantId: tenantId || '',
      channel: input.channel || '',
    },
    breakRequested: false,
    actionStack: [],
  };
}

async function executeAction(action: Action, context: ExecutionContext): Promise<boolean> {
  const executor = new SubActionExecutor();
  return executor.executeAction(action, context);
}

export async function runActionById(
  actionId: string,
  tenantId?: string,
  input: ManualRunInput = {}
): Promise<{ action: Action; success: boolean }> {
  const action = await getActionById(actionId, tenantId);
  if (!action) {
    throw new Error('Action not found.');
  }

  const context = buildContext(input, tenantId);
  context.actionStack = [action.id];
  const success = await executeAction(action, context);
  return { action, success };
}

export async function runCommandById(
  commandId: string,
  tenantId?: string,
  input: ManualRunInput = {}
): Promise<{
  command: Command;
  matchedActions: number;
  actionsRun: number;
  actionsFailed: number;
}> {
  const command = await getCommandById(commandId, tenantId);
  if (!command) {
    throw new Error('Command not found.');
  }

  if (command.enabled === false) {
    throw new Error('Command is disabled.');
  }

  const rawInput = input.rawInput ?? '';
  const message = input.message || `${command.command}${rawInput ? ` ${rawInput}` : ''}`;
  const context = buildContext({ ...input, message, rawInput }, tenantId);
  context.args = {
    ...context.args,
    commandId: command.id,
    commandName: command.name,
    command: command.command,
  };
  context.variables = {
    ...context.variables,
    ...context.args,
  };

  const actions = (await getAllActions(tenantId)).filter((action) => {
    if (action.enabled === false) return false;
    return (action.triggers || []).some(
      (trigger: any) =>
        trigger?.enabled !== false &&
        Number(trigger?.type) === TriggerType.COMMAND &&
        String(trigger?.commandId) === String(command.id)
    );
  });

  let actionsRun = 0;
  let actionsFailed = 0;
  for (const action of actions) {
    const success = await executeAction(action, {
      ...context,
      actionStack: [action.id],
    });
    if (success) {
      actionsRun += 1;
    } else {
      actionsFailed += 1;
    }
  }

  return {
    command,
    matchedActions: actions.length,
    actionsRun,
    actionsFailed,
  };
}
