import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('community export includes a trigger-linked generated action with a different name', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'generated-community-export-'));
  process.env.PERSIST_ROOT = root;
  try {
    const { createCommand } = await import('../src/lib/commands-store');
    const { createAction } = await import('../src/lib/actions-store');
    const { listTenantFlowPackages, getRequiredFlowPackageActionKeys } = await import('../src/lib/flow-packages');
    const command = await createCommand({ name: 'testkick', command: '!testkick', group: 'AI Automations', enabled: true } as any, 'fixture-export');
    const action = await createAction({
      name: 'Generated Kick Response', group: 'AI Automations', enabled: true,
      triggers: [{ type: 401, enabled: true, commandId: command.id }],
      subActions: [{ type: 10, text: 'Test reply', enabled: true }],
    } as any, 'fixture-export');
    const pkg = (await listTenantFlowPackages('fixture-export')).find(p => p.commands.some(c => c.id === command.id));
    assert(pkg);
    assert(pkg.actions.some(a => a.id === action.id));
    assert.equal(getRequiredFlowPackageActionKeys(pkg).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
