import { selectFlowPackageEntries, type FlowPackage, type FlowPackageSelection } from '@/lib/flow-packages';

type SandboxInput = {
  userName?: string;
  rawInput?: string;
  message?: string;
  platform?: string;
  channel?: string;
};

type SandboxEvent = {
  type: 'chat' | 'discord' | 'obs' | 'audio' | 'code' | 'wait' | 'control' | 'variable' | 'http' | 'unsupported';
  label: string;
  detail?: string;
};

type SandboxObsState = {
  currentScene: string;
  sources: Record<string, { scene?: string; visible: boolean }>;
  textSources: Record<string, string>;
};

type SandboxResult = {
  packageId: string;
  packageName: string;
  selectedCommand?: string | null;
  executedActions: string[];
  events: SandboxEvent[];
  warnings: string[];
  variables: Record<string, any>;
  chatTranscript: Array<{ speaker: 'viewer' | 'bot' | 'discord'; message: string }>;
  obsState: SandboxObsState;
};

type SandboxRuntime = {
  variables: Record<string, any>;
  warnings: string[];
  events: SandboxEvent[];
  executedActions: string[];
  chatTranscript: Array<{ speaker: 'viewer' | 'bot' | 'discord'; message: string }>;
  obsState: SandboxObsState;
  actionMap: Map<string, Record<string, any>>;
};

const TYPE = {
  PLAY_SOUND: 1,
  RUN_ACTION: 4,
  SEND_MESSAGE: 10,
  TWITCH_SET_TITLE: 15,
  TWITCH_SET_GAME: 16,
  GET_DATE_TIME: 21,
  OBS_SET_SCENE: 25,
  OBS_TOGGLE_SOURCE: 30,
  OBS_SET_TEXT: 31,
  GET_GLOBAL_VAR: 121,
  SET_GLOBAL_VAR: 122,
  SET_ARGUMENT: 123,
  BREAK: 124,
  IF_ELSE: 120,
  IF_BLOCK: 99901,
  ELSE_BLOCK: 99902,
  WAIT: 1002,
  RANDOM_NUMBER: 1003,
  HTTP_REQUEST: 1007,
  COMMENT: 1009,
  SET_USER_VAR: 1050,
  GET_USER_VAR: 1051,
  MATH_OPERATION: 1052,
  STRING_OPERATION: 1053,
  DISCORD_SEND_MESSAGE: 5001,
  EXECUTE_CODE: 99999,
} as const;

function interpolate(value: unknown, variables: Record<string, any>): string {
  const text = String(value ?? '');
  return text
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => String(variables[key] ?? ''))
    .replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, key) => String(variables[key] ?? ''));
}

function resolveValue(key: string, variables: Record<string, any>): string {
  if (key in variables) return String(variables[key] ?? '');
  return interpolate(key, variables);
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addWarning(runtime: SandboxRuntime, message: string) {
  if (!runtime.warnings.includes(message)) runtime.warnings.push(message);
}

function pushEvent(runtime: SandboxRuntime, event: SandboxEvent) {
  runtime.events.push(event);
}

function normalizeCommandText(value: unknown): string {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text.startsWith('!') ? text : `!${text.replace(/^!+/, '')}`;
}

function normalizeComparableText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function maybeSimulateBuiltInCommand(command: Record<string, any>, runtime: SandboxRuntime): boolean {
  const commandText = normalizeCommandText(command.command || command.name);
  if (commandText !== '!time') return false;

  const now = new Date();
  const format = (timeZone: string) =>
    now.toLocaleString('en-US', { timeZone, hour: '2-digit', minute: '2-digit' });
  const message = `🕐 PST: ${format('America/Los_Angeles')} | MST: ${format('America/Denver')} | CST: ${format('America/Chicago')} | EST: ${format('America/New_York')} | UTC: ${format('UTC')}`;

  runtime.chatTranscript.push({ speaker: 'bot', message });
  pushEvent(runtime, {
    type: 'chat',
    label: 'Built-in utility reply',
    detail: message,
  });
  addWarning(runtime, 'This command is currently handled by StreamWeaver built-in chat logic, not by editable action steps.');
  return true;
}

function findActionsForCommand(pkg: FlowPackage, commandKey?: string): Array<Record<string, any>> {
  if (!commandKey) return [];
  const command = pkg.commands.find((item) => {
    const key = String(item.id || item.command || item.name || '').trim();
    return key === commandKey;
  });
  if (!command) return [];

  const actionsById = new Map(pkg.actions.map((action) => [String(action.id || ''), action]));
  const out = new Map<string, Record<string, any>>();

  if (command.actionId && actionsById.has(String(command.actionId))) {
    out.set(String(command.actionId), actionsById.get(String(command.actionId)) as Record<string, any>);
  }

  const commandText = String(command.command || '').trim().toLowerCase();
  const commandComparable = normalizeComparableText(command.command || command.name);
  for (const action of pkg.actions) {
    const actionComparable = normalizeComparableText((action as any).name);
    if (commandComparable && actionComparable === commandComparable) {
      out.set(String(action.id || action.name), action as Record<string, any>);
    }

    for (const trigger of Array.isArray((action as any).triggers) ? (action as any).triggers : []) {
      const triggerCommandId = String(trigger?.commandId || '');
      const triggerCommand = String(trigger?.config?.command || trigger?.pattern || '').trim().toLowerCase();
      if (triggerCommandId && command.id && triggerCommandId === String(command.id)) {
        out.set(String(action.id || action.name), action as Record<string, any>);
      } else if (triggerCommand && triggerCommand === commandText) {
        out.set(String(action.id || action.name), action as Record<string, any>);
      }
    }
  }

  return [...out.values()];
}

function evaluateCondition(subAction: Record<string, any>, variables: Record<string, any>): boolean {
  const inputField = String(subAction.input || '');
  const compareValue = resolveValue(String(subAction.value || ''), variables);
  const operation = Number(subAction.operation || 0);

  let input = resolveValue(inputField, variables);
  if (inputField in variables) input = String(variables[inputField] ?? '');

  switch (operation) {
    case 0:
      return input === compareValue;
    case 1:
      return input !== compareValue;
    case 2:
      return input.includes(compareValue);
    case 3:
      return !input.includes(compareValue);
    case 4:
      return input.startsWith(compareValue);
    case 5:
      return input.endsWith(compareValue);
    case 6:
      return !input || input.trim() === '' || input === inputField;
    case 7:
      return input.trim() !== '' && input !== inputField;
    case 8:
      return parseNumber(input) > parseNumber(compareValue);
    case 9:
      return parseNumber(input) >= parseNumber(compareValue);
    case 10:
      return parseNumber(input) < parseNumber(compareValue);
    case 11:
      return parseNumber(input) <= parseNumber(compareValue);
    case 12:
      try {
        return new RegExp(compareValue).test(input);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function handleVariableMutation(subAction: Record<string, any>, runtime: SandboxRuntime) {
  switch (Number(subAction.type)) {
    case TYPE.SET_ARGUMENT:
    case TYPE.SET_GLOBAL_VAR:
    case TYPE.SET_USER_VAR: {
      const variableName = String(subAction.variableName || '');
      if (!variableName) return;
      const value = resolveValue(String(subAction.value || ''), runtime.variables);
      runtime.variables[variableName] = value;
      pushEvent(runtime, {
        type: 'variable',
        label: 'Set variable',
        detail: `${variableName} = ${value}`,
      });
      return;
    }
    case TYPE.GET_GLOBAL_VAR:
    case TYPE.GET_USER_VAR: {
      const sourceName = String(subAction.variableName || '');
      const destination = String(subAction.destinationVariable || sourceName || 'value');
      const value = runtime.variables[sourceName] ?? subAction.defaultValue ?? '';
      runtime.variables[destination] = value;
      pushEvent(runtime, {
        type: 'variable',
        label: 'Read variable',
        detail: `${destination} = ${String(value)}`,
      });
      return;
    }
    case TYPE.MATH_OPERATION: {
      const left = parseNumber(resolveValue(String((subAction as any).operand1 || 0), runtime.variables));
      const right = parseNumber(resolveValue(String((subAction as any).operand2 || 0), runtime.variables));
      const operationRaw = (subAction as any).operation;
      const operation = typeof operationRaw === 'number'
        ? ({ 0: 'add', 1: 'subtract', 2: 'multiply', 3: 'divide', 4: 'modulo', 5: 'power' } as Record<number, string>)[operationRaw] || 'add'
        : String(operationRaw || 'add');
      const variableName = String(subAction.variableName || 'mathResult');
      let result = 0;
      switch (operation) {
        case 'subtract':
          result = left - right;
          break;
        case 'multiply':
          result = left * right;
          break;
        case 'divide':
          result = right !== 0 ? left / right : 0;
          break;
        case 'modulo':
          result = right !== 0 ? left % right : 0;
          break;
        case 'power':
          result = Math.pow(left, right);
          break;
        default:
          result = left + right;
          break;
      }
      runtime.variables[variableName] = result;
      pushEvent(runtime, { type: 'variable', label: 'Math operation', detail: `${variableName} = ${String(result)}` });
      return;
    }
    case TYPE.STRING_OPERATION: {
      const variableName = String(subAction.variableName || 'stringResult');
      const input = resolveValue(String((subAction as any).input || ''), runtime.variables);
      const operation = String((subAction as any).operation || 'append').toLowerCase();
      const compare = resolveValue(String((subAction as any).value || ''), runtime.variables);
      let result = input;
      if (operation.includes('upper')) result = input.toUpperCase();
      else if (operation.includes('lower')) result = input.toLowerCase();
      else if (operation.includes('trim')) result = input.trim();
      else if (operation.includes('replace')) result = input.replaceAll(String((subAction as any).find || ''), String((subAction as any).replace || ''));
      else result = `${input}${compare}`;
      runtime.variables[variableName] = result;
      pushEvent(runtime, { type: 'variable', label: 'String operation', detail: `${variableName} = ${result}` });
      return;
    }
    case TYPE.RANDOM_NUMBER: {
      const min = parseNumber(resolveValue(String((subAction as any).min || 1), runtime.variables), 1);
      const max = parseNumber(resolveValue(String((subAction as any).max || 100), runtime.variables), 100);
      const variableName = String(subAction.variableName || 'randomNumber');
      const result = min + Math.floor((max - min) / 2);
      runtime.variables[variableName] = result;
      pushEvent(runtime, { type: 'variable', label: 'Random number', detail: `${variableName} = ${String(result)} (deterministic midpoint)` });
      return;
    }
    case TYPE.GET_DATE_TIME: {
      const variableName = String(subAction.variableName || 'dateTime');
      const now = new Date().toISOString();
      runtime.variables[variableName] = now;
      pushEvent(runtime, { type: 'variable', label: 'Get date/time', detail: `${variableName} = ${now}` });
      return;
    }
    default:
      return;
  }
}

function handleObsMutation(subAction: Record<string, any>, runtime: SandboxRuntime) {
  switch (Number(subAction.type)) {
    case TYPE.OBS_SET_SCENE: {
      const sceneName = resolveValue(String(subAction.sceneName || ''), runtime.variables);
      runtime.obsState.currentScene = sceneName;
      pushEvent(runtime, { type: 'obs', label: 'Set OBS scene', detail: sceneName });
      return;
    }
    case TYPE.OBS_TOGGLE_SOURCE: {
      const sceneName = resolveValue(String(subAction.sceneName || ''), runtime.variables);
      const sourceName = resolveValue(String(subAction.sourceName || ''), runtime.variables);
      const visible = Number(subAction.state ?? 1) === 1;
      runtime.obsState.sources[sourceName] = { scene: sceneName, visible };
      pushEvent(runtime, { type: 'obs', label: visible ? 'Show OBS source' : 'Hide OBS source', detail: `${sourceName} in ${sceneName}` });
      return;
    }
    case TYPE.OBS_SET_TEXT: {
      const sourceName = resolveValue(String(subAction.sourceName || ''), runtime.variables);
      const text = resolveValue(String(subAction.text || subAction.value || ''), runtime.variables);
      runtime.obsState.textSources[sourceName] = text;
      pushEvent(runtime, { type: 'obs', label: 'Update OBS text source', detail: `${sourceName} = ${text}` });
      return;
    }
    default:
      return;
  }
}

function executeSubAction(
  subAction: Record<string, any>,
  runtime: SandboxRuntime,
  actionStack: string[]
) {
  const type = Number(subAction.type);

  if (type === TYPE.COMMENT) return;

  if (type === TYPE.IF_ELSE) {
    const passed = evaluateCondition(subAction, runtime.variables);
    pushEvent(runtime, {
      type: 'control',
      label: 'Conditional branch',
      detail: `Condition evaluated to ${passed ? 'true' : 'false'}`,
    });
    const branches = Array.isArray(subAction.subActions) ? subAction.subActions : [];
    const selected = branches.find((item: any) => Number(item.type) === (passed ? TYPE.IF_BLOCK : TYPE.ELSE_BLOCK));
    const nested = Array.isArray(selected?.subActions) ? selected.subActions : [];
    for (const child of nested.sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0))) {
      executeSubAction(child, runtime, actionStack);
    }
    return;
  }

  if (
    type === TYPE.SET_ARGUMENT ||
    type === TYPE.SET_GLOBAL_VAR ||
    type === TYPE.SET_USER_VAR ||
    type === TYPE.GET_GLOBAL_VAR ||
    type === TYPE.GET_USER_VAR ||
    type === TYPE.MATH_OPERATION ||
    type === TYPE.STRING_OPERATION ||
    type === TYPE.RANDOM_NUMBER ||
    type === TYPE.GET_DATE_TIME
  ) {
    handleVariableMutation(subAction, runtime);
    return;
  }

  if (type === TYPE.OBS_SET_SCENE || type === TYPE.OBS_TOGGLE_SOURCE || type === TYPE.OBS_SET_TEXT) {
    handleObsMutation(subAction, runtime);
    return;
  }

  switch (type) {
    case TYPE.SEND_MESSAGE: {
      const message = resolveValue(String(subAction.text || subAction.message || ''), runtime.variables);
      runtime.chatTranscript.push({ speaker: 'bot', message });
      pushEvent(runtime, { type: 'chat', label: 'Send chat message', detail: message });
      return;
    }
    case TYPE.DISCORD_SEND_MESSAGE: {
      const message = resolveValue(String(subAction.text || subAction.message || ''), runtime.variables);
      runtime.chatTranscript.push({ speaker: 'discord', message });
      pushEvent(runtime, { type: 'discord', label: 'Send Discord message', detail: message });
      return;
    }
    case TYPE.PLAY_SOUND: {
      pushEvent(runtime, {
        type: 'audio',
        label: 'Play sound',
        detail: resolveValue(String(subAction.soundFile || subAction.fileName || ''), runtime.variables),
      });
      return;
    }
    case TYPE.TWITCH_SET_TITLE: {
      pushEvent(runtime, {
        type: 'control',
        label: 'Set stream title',
        detail: resolveValue(String(subAction.text || subAction.value || ''), runtime.variables),
      });
      return;
    }
    case TYPE.TWITCH_SET_GAME: {
      pushEvent(runtime, {
        type: 'control',
        label: 'Set stream game',
        detail: resolveValue(String(subAction.text || subAction.value || ''), runtime.variables),
      });
      return;
    }
    case TYPE.WAIT: {
      const min = resolveValue(String((subAction as any).minValue || (subAction as any).min || subAction.value || 1000), runtime.variables);
      const max = resolveValue(String((subAction as any).maxValue || (subAction as any).max || min), runtime.variables);
      pushEvent(runtime, { type: 'wait', label: 'Wait', detail: min === max ? `${min}ms` : `${min}-${max}ms` });
      return;
    }
    case TYPE.HTTP_REQUEST: {
      pushEvent(runtime, {
        type: 'http',
        label: 'HTTP request',
        detail: resolveValue(String(subAction.url || ''), runtime.variables),
      });
      addWarning(runtime, `HTTP request "${String(subAction.url || '')}" was not executed in sandbox mode.`);
      return;
    }
    case TYPE.EXECUTE_CODE: {
      pushEvent(runtime, {
        type: 'code',
        label: 'Execute code',
        detail: String(subAction.name || 'Programmable block'),
      });
      addWarning(runtime, `Execute Code block "${subAction.name || subAction.id || 'unnamed'}" was not executed in sandbox mode.`);
      return;
    }
    case TYPE.RUN_ACTION: {
      pushEvent(runtime, { type: 'control', label: 'Run linked action', detail: String(subAction.actionId || '') });
      const next = runtime.actionMap.get(String(subAction.actionId || ''));
      if (next) {
        simulateAction(next, runtime, actionStack);
      } else {
        addWarning(runtime, `Linked action ${String(subAction.actionId || '')} was not found in the selected package.`);
      }
      return;
    }
    case TYPE.BREAK: {
      pushEvent(runtime, { type: 'control', label: 'Break execution', detail: 'Sandbox stopped this branch.' });
      return;
    }
    default: {
      pushEvent(runtime, {
        type: 'unsupported',
        label: `Subaction ${String(subAction.type)}`,
        detail: String(subAction.name || 'Not yet simulated'),
      });
      addWarning(runtime, `Unsupported sandbox subaction type ${String(subAction.type)} encountered.`);
    }
  }
}

function simulateAction(
  action: Record<string, any>,
  runtime: SandboxRuntime,
  actionStack: string[]
) {
  const actionId = String(action.id || action.name || '');
  if (actionStack.includes(actionId)) {
    addWarning(runtime, `Recursive action reference detected for ${actionId}.`);
    return;
  }

  runtime.executedActions.push(String(action.name || actionId));
  const ordered = Array.isArray(action.subActions)
    ? [...action.subActions].sort((a: any, b: any) => Number(a.index ?? 0) - Number(b.index ?? 0))
    : [];

  for (const subAction of ordered) {
    executeSubAction(subAction as Record<string, any>, runtime, [...actionStack, actionId]);
  }
}

export function sandboxFlowPackage(input: {
  package: FlowPackage;
  selection?: FlowPackageSelection;
  commandKey?: string;
  actionKey?: string;
  sandboxInput?: SandboxInput;
}): SandboxResult {
  const pkg = selectFlowPackageEntries(input.package, input.selection);
  const variables: Record<string, any> = {
    user: input.sandboxInput?.userName || 'SandboxUser',
    userName: input.sandboxInput?.userName || 'SandboxUser',
    rawInput: input.sandboxInput?.rawInput || '',
    message: input.sandboxInput?.message || input.sandboxInput?.rawInput || '',
    platform: input.sandboxInput?.platform || 'twitch',
    channel: input.sandboxInput?.channel || 'sandbox-channel',
  };
  const runtime: SandboxRuntime = {
    variables,
    warnings: [],
    events: [],
    executedActions: [],
    chatTranscript: [
      {
        speaker: 'viewer',
        message: variables.message || '(no message)',
      },
    ],
    obsState: {
      currentScene: '',
      sources: {},
      textSources: {},
    },
    actionMap: new Map(pkg.actions.map((action) => [String(action.id || action.name || ''), action as Record<string, any>])),
  };

  const targetActions = input.actionKey
    ? pkg.actions.filter((action) => String(action.id || `${action.name}:${action.group || ''}` || action.name || '').trim() === input.actionKey)
    : findActionsForCommand(pkg, input.commandKey);

  if (targetActions.length === 0) {
    const selectedCommand = pkg.commands.find((item) => String(item.id || item.command || item.name || '').trim() === input.commandKey);
    if (!selectedCommand || !maybeSimulateBuiltInCommand(selectedCommand as Record<string, any>, runtime)) {
      addWarning(runtime, 'No actions matched the selected sandbox target. This command is not tied to an editable action in the selected package.');
    }
  }

  for (const action of targetActions) {
    simulateAction(action as Record<string, any>, runtime, []);
    const selectedCommand = pkg.commands.find((item) => String(item.id || item.command || item.name || '').trim() === input.commandKey);
    const ordered = Array.isArray((action as any).subActions) ? (action as any).subActions : [];
    if (selectedCommand && ordered.length === 0) {
      maybeSimulateBuiltInCommand(selectedCommand as Record<string, any>, runtime);
    }
  }

  return {
    packageId: pkg.packageId,
    packageName: pkg.name,
    selectedCommand: input.commandKey || null,
    executedActions: [...new Set(runtime.executedActions)],
    events: runtime.events,
    warnings: runtime.warnings,
    variables: runtime.variables,
    chatTranscript: runtime.chatTranscript,
    obsState: runtime.obsState,
  };
}
