import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  const persistRoot = await mkdtemp(join(tmpdir(), 'streamweaver-persistence-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const [{ VariableHandlers }, { readAutomationVariables }] = await Promise.all([
      import('../src/services/automation/subactions/SubActionHandlers'),
      import('../src/lib/automation-variables-store'),
    ]);

    await VariableHandlers.handleSetGlobalVariable(
      { variableName: 'scene', value: 'tenant-a-scene' } as any,
      { tenantId: 'tenant-a' }
    );
    await VariableHandlers.handleSetGlobalVariable(
      { variableName: 'scene', value: 'tenant-b-scene' } as any,
      { tenantId: 'tenant-b' }
    );
    await VariableHandlers.handleSetUserVariable(
      { userName: 'viewer', variableName: 'visits', value: '7' } as any,
      { tenantId: 'tenant-a' }
    );

    const [tenantA, tenantB] = await Promise.all([
      readAutomationVariables('tenant-a'),
      readAutomationVariables('tenant-b'),
    ]);

    if (tenantA.global.scene !== 'tenant-a-scene' || tenantB.global.scene !== 'tenant-b-scene') {
      throw new Error('Global automation variables crossed tenant boundaries.');
    }
    if (tenantA.users.viewer?.visits !== '7' || tenantB.users.viewer !== undefined) {
      throw new Error('User automation variables crossed tenant boundaries.');
    }

    const persisted = JSON.parse(
      await readFile(join(persistRoot, 'tenants', 'tenant-a', 'tokens', 'automation-variables.json'), 'utf8')
    );
    if (persisted.global.scene !== 'tenant-a-scene' || persisted.users.viewer?.visits !== '7') {
      throw new Error('Automation variables were not written to durable tenant storage.');
    }

    console.log('Automation variable persistence and tenant isolation verified.');
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
