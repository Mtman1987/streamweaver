import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

type Json = Record<string, any>;

function readJsonFiles(dir: string): Array<{ file: string; data: Json }> {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json') && file !== '_metadata.json')
    .map((file) => {
      const full = path.join(dir, file);
      try {
        return { file, data: JSON.parse(fs.readFileSync(full, 'utf8')) as Json };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; data: Json } => Boolean(entry));
}

function normalizeCommand(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^!/, '')
    .split(/\s+/)[0]
    .toLowerCase();
}

function dispatcherBuiltIns(source: string): Set<string> {
  const names = new Set<string>();

  for (const match of source.matchAll(/actualMessage\.toLowerCase\(\)\s*===\s*['"]!([^'"]+)['"]/g)) {
    const name = normalizeCommand(match[1]);
    if (name) names.add(name);
  }

  for (const match of source.matchAll(/actualMessage\.toLowerCase\(\)\.startsWith\(['"]!([^'"]+)['"]\)/g)) {
    const name = normalizeCommand(match[1]);
    if (name) names.add(name);
  }

  for (const match of source.matchAll(/cmdName\s*===\s*['"]([^'"]+)['"]/g)) {
    const name = normalizeCommand(match[1]);
    if (name) names.add(name);
  }

  for (const match of source.matchAll(/\^!([a-z0-9_-]+)/gi)) {
    names.add(match[1].toLowerCase());
  }

  return names;
}

test('every enabled root Twitch command has an executable runtime path', () => {
  const cwd = process.cwd();
  const commands = readJsonFiles(path.join(cwd, 'commands'));
  const actions = readJsonFiles(path.join(cwd, 'actions'));
  const dispatcher = fs.readFileSync(path.join(cwd, 'src/services/chat-dispatcher.ts'), 'utf8');
  const socialSource = fs.readFileSync(path.join(cwd, 'src/services/social-command-replies.ts'), 'utf8');

  const builtIns = dispatcherBuiltIns(dispatcher);
  for (const match of socialSource.matchAll(/['"]([a-z0-9_-]+)['"]/g)) {
    const name = normalizeCommand(match[1]);
    if (name) builtIns.add(name);
  }

  const actionById = new Map(actions.map(({ data }) => [String(data.id || ''), data]));
  const commandTriggeredActions = new Map<string, Json[]>();

  for (const { data: action } of actions) {
    if (action.enabled === false) continue;
    for (const trigger of Array.isArray(action.triggers) ? action.triggers : []) {
      const commandId = String(trigger?.commandId || '').trim();
      if (!commandId) continue;
      if (Number(trigger?.type) !== 401) continue;
      const list = commandTriggeredActions.get(commandId) || [];
      list.push(action);
      commandTriggeredActions.set(commandId, list);
    }
  }

  const dead: Array<Record<string, unknown>> = [];

  for (const { file, data: command } of commands) {
    if (command.enabled === false) continue;

    const name = normalizeCommand(command.command || command.trigger);
    if (!name) continue;

    const hasResponse = typeof command.response === 'string' && command.response.trim().length > 0;
    const hasInlineActions = Array.isArray(command.actions) && command.actions.length > 0;
    const directAction = command.actionId ? actionById.get(String(command.actionId)) : null;
    const directActionExecutable = Boolean(
      directAction
      && directAction.enabled !== false
      && (directAction.handler || (Array.isArray(directAction.subActions) && directAction.subActions.length > 0)),
    );
    const triggered = commandTriggeredActions.get(String(command.id || '')) || [];
    const triggeredExecutable = triggered.some((action) =>
      Boolean(action.handler || (Array.isArray(action.subActions) && action.subActions.length > 0)),
    );

    if (
      builtIns.has(name)
      || hasResponse
      || hasInlineActions
      || directActionExecutable
      || triggeredExecutable
    ) {
      continue;
    }

    dead.push({
      command: command.command || command.trigger,
      file,
      id: command.id,
      directActionId: command.actionId || null,
      numericCommandTriggerActions: triggered.map((action) => ({
        id: action.id,
        name: action.name,
        subActions: Array.isArray(action.subActions) ? action.subActions.length : 0,
        handler: Boolean(action.handler),
      })),
    });
  }

  assert.deepEqual(
    dead,
    [],
    'Enabled command(s) have no executable Twitch runtime path:\n' + JSON.stringify(dead, null, 2),
  );
});
