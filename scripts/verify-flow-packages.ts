import { promises as fsp } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAllActions } from '@/lib/actions-store';
import { getAllCommands } from '@/lib/commands-store';
import { flowPackageSchema, listTenantFlowPackages, importFlowPackage } from '@/lib/flow-packages';
import { tenantRoot } from '@/lib/tenant';

type VerificationResult = {
  packageId: string;
  ok: boolean;
  importedCommands: number;
  importedActions: number;
  missingCommandRefs: string[];
  missingActionRefs: string[];
  warnings: string[];
  error?: string;
};

function collectSubActionActionIds(subActions: any[], into: string[]) {
  for (const subAction of subActions) {
    if (subAction?.actionId) into.push(String(subAction.actionId));
    if (Array.isArray(subAction?.subActions)) {
      collectSubActionActionIds(subAction.subActions, into);
    }
  }
}

async function verifyPackage(pkg: any): Promise<VerificationResult> {
  const parsed = flowPackageSchema.parse(pkg);
  const tempTenantId = `pkg-verify-${randomUUID()}`;
  const root = tenantRoot(tempTenantId);

  try {
    const imported = await importFlowPackage(parsed, tempTenantId);
    const [commands, actions] = await Promise.all([
      getAllCommands(tempTenantId),
      getAllActions(tempTenantId),
    ]);

    const commandIds = new Set(commands.map((command) => String((command as any).id)));
    const actionIds = new Set(actions.map((action) => String((action as any).id)));

    const missingCommandRefs: string[] = [];
    const missingActionRefs: string[] = [];
    const warnings: string[] = [];

    for (const command of commands as any[]) {
      if (command.actionId && !actionIds.has(String(command.actionId))) {
        missingActionRefs.push(`${parsed.packageId}:command:${command.command}->${String(command.actionId)}`);
      }
    }

    for (const action of actions as any[]) {
      for (const trigger of Array.isArray(action.triggers) ? action.triggers : []) {
        if (trigger?.commandId && !commandIds.has(String(trigger.commandId))) {
          missingCommandRefs.push(`${parsed.packageId}:action:${action.name}->${String(trigger.commandId)}`);
        }
      }

      const subActionIds: string[] = [];
      collectSubActionActionIds(Array.isArray(action.subActions) ? action.subActions : [], subActionIds);
      for (const actionId of subActionIds) {
        if (!actionIds.has(actionId)) {
          missingActionRefs.push(`${parsed.packageId}:subAction:${action.name}->${actionId}`);
        }
      }

      const hasExecutionPath =
        Boolean(action.handler) ||
        Boolean(action.type) ||
        (Array.isArray(action.subActions) && action.subActions.length > 0) ||
        (Array.isArray(action.triggers) && action.triggers.length > 0);

      if (!hasExecutionPath) {
        warnings.push(`${parsed.packageId}:action:${action.name}:no-explicit-runtime-path`);
      }
    }

    return {
      packageId: parsed.packageId,
      ok: missingCommandRefs.length === 0 && missingActionRefs.length === 0,
      importedCommands: imported.commands,
      importedActions: imported.actions,
      missingCommandRefs,
      missingActionRefs,
      warnings,
    };
  } catch (error: any) {
    return {
      packageId: parsed.packageId,
      ok: false,
      importedCommands: 0,
      importedActions: 0,
      missingCommandRefs: [],
      missingActionRefs: [],
      warnings: [],
      error: error?.message || String(error),
    };
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const tenantId = process.env.FLOW_LIBRARY_SOURCE_TENANT?.trim() || '94371378';
  const packages = await listTenantFlowPackages(tenantId);
  const visiblePackages = packages.filter((pkg) => pkg.visibility !== 'hidden');
  const results: VerificationResult[] = [];

  for (const pkg of visiblePackages) {
    results.push(await verifyPackage(pkg));
  }

  const summary = {
    sourceTenantId: tenantId,
    checked: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    warnings: results.reduce((count, result) => count + result.warnings.length, 0),
    generatedAt: new Date().toISOString(),
    results,
  };

  const outPath = path.resolve(process.cwd(), 'docs', 'flow-package-verification.json');
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify({ ...summary, results: undefined, outPath }, null, 2));
}

main().catch((error) => {
  console.error('[verify-flow-packages] Failed:', error);
  process.exit(1);
});
