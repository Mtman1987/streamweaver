import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('plain-language idea creates a linked disabled draft that can be promoted live', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-command-flow-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const builder = await import('../src/services/automation/ai-workflow-builder');
    const commandsStore = await import('../src/lib/commands-store');
    const actionsStore = await import('../src/lib/actions-store');

    const created = await builder.createWorkflowFromPrompt({
      message: 'give viewers a random fortune',
      tenantId: 'tenant-command',
      userName: 'owner',
    });

    assert.equal(created.commandText, '!fortune');
    assert.equal(created.command.enabled, false);
    assert.equal(created.action.enabled, false);
    assert.equal(created.action.triggers[0].commandId, created.command.id);

    await builder.setWorkflowEnabledByCommand('!fortune', true, 'tenant-command');
    const command = (await commandsStore.getAllCommands('tenant-command')).find((entry) => entry.id === created.command.id);
    const action = (await actionsStore.getAllActions('tenant-command')).find((entry) => entry.id === created.action.id);
    assert.equal(command?.enabled, true);
    assert.equal(action?.enabled, true);
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});
