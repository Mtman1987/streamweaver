import { promises as fsp } from 'fs';
import * as path from 'path';
import { getFlowLibraryDir, listTenantFlowPackages, publishFlowPackage } from '@/lib/flow-packages';

async function main() {
  const tenantId = process.env.FLOW_LIBRARY_SOURCE_TENANT?.trim() || '94371378';
  const packages = await listTenantFlowPackages(tenantId);
  const visiblePackages = packages.filter((pkg) => pkg.visibility !== 'hidden');
  const libraryDir = getFlowLibraryDir();

  await fsp.mkdir(libraryDir, { recursive: true });

  const existing = await fsp.readdir(libraryDir).catch(() => []);
  for (const file of existing) {
    if (file.endsWith('.json')) {
      await fsp.unlink(path.join(libraryDir, file));
    }
  }

  for (const pkg of visiblePackages) {
    await publishFlowPackage(pkg);
  }

  const summary = {
    sourceTenantId: tenantId,
    outputDir: libraryDir,
    publishedPackages: visiblePackages.length,
    packageIds: visiblePackages.map((pkg) => pkg.packageId),
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[sync-flow-library] Failed:', error);
  process.exit(1);
});
