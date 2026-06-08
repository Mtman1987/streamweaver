import assert from 'node:assert/strict';

async function main() {
  const flowModule = await import('../src/lib/flow-packages');
  const sandboxModule = await import('../src/lib/flow-package-sandbox');
  const streamerbotModule = await import('../src/lib/streamerbot-export');

  const flow = (flowModule as any).default || flowModule;
  const sandbox = (sandboxModule as any).default || sandboxModule;
  const streamerbot = (streamerbotModule as any).default || streamerbotModule;

  assert.equal(typeof flow.listTenantFlowPackages, 'function', 'listTenantFlowPackages missing');
  assert.equal(typeof flow.buildFlowPackageManifestDraft, 'function', 'buildFlowPackageManifestDraft missing');
  assert.equal(typeof sandbox.sandboxFlowPackage, 'function', 'sandboxFlowPackage missing');
  assert.equal(typeof streamerbot.exportFlowPackageToStreamerbot, 'function', 'exportFlowPackageToStreamerbot missing');

  const packages = await flow.listTenantFlowPackages();
  assert.ok(Array.isArray(packages) && packages.length > 0, 'expected at least one tenant flow package');

  const pkg = packages.find((item: any) => item.packageId === 'flow.utility.shoutout') || packages[0];
  assert.ok(pkg.items?.commands && pkg.items?.actions, 'package items metadata missing');

  const manifestDraft = flow.buildFlowPackageManifestDraft(pkg);
  assert.equal(manifestDraft.packageId, pkg.packageId, 'manifest draft packageId mismatch');
  assert.ok(Array.isArray(manifestDraft.items.commands), 'manifest commands missing');
  assert.ok(Array.isArray(manifestDraft.items.actions), 'manifest actions missing');

  const commandKey = pkg.commands?.[0]
    ? String(pkg.commands[0].id || pkg.commands[0].command || pkg.commands[0].name || '')
    : undefined;

  const sandboxResult = sandbox.sandboxFlowPackage({
    package: pkg,
    commandKey,
    sandboxInput: {
      userName: 'SmokeTester',
      rawInput: '@raider',
      message: `${commandKey || ''} @raider`.trim(),
      platform: 'twitch',
      channel: 'smoke-channel',
    },
  });

  assert.equal(sandboxResult.packageId, pkg.packageId, 'sandbox package mismatch');
  assert.ok(Array.isArray(sandboxResult.events), 'sandbox events missing');
  assert.ok(Array.isArray(sandboxResult.chatTranscript), 'sandbox transcript missing');
  assert.ok(typeof sandboxResult.variables === 'object' && sandboxResult.variables, 'sandbox variables missing');
  assert.ok(typeof sandboxResult.obsState === 'object' && sandboxResult.obsState, 'sandbox obs state missing');

  const sbExport = streamerbot.exportFlowPackageToStreamerbot(pkg);
  assert.equal(sbExport.packageId, pkg.packageId, 'streamerbot export package mismatch');
  assert.ok(Array.isArray(sbExport.commands), 'streamerbot commands missing');
  assert.ok(Array.isArray(sbExport.actions), 'streamerbot actions missing');
  assert.ok(typeof sbExport.summary?.commands === 'number', 'streamerbot summary missing');

  console.log(JSON.stringify({
    packageId: pkg.packageId,
    manifestCommandCount: manifestDraft.items.commands.length,
    manifestActionCount: manifestDraft.items.actions.length,
    sandboxEvents: sandboxResult.events.length,
    sandboxWarnings: sandboxResult.warnings.length,
    transcriptMessages: sandboxResult.chatTranscript.length,
    streamerbotExport: sbExport.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
