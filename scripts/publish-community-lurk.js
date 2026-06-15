const fs = require('fs');
const path = require('path');

const persistRoot = process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime');
const globalDir = path.join(persistRoot, 'global');
const flowLibraryDir = path.join(globalDir, 'flow-library');
const flowManifestDir = path.join(globalDir, 'flow-library-manifests');

const bundledPackagePath = path.join(process.cwd(), 'data', 'runtime', 'global', 'flow-library', 'flow.utility.lurk.json');
const bundledManifestPath = path.join(process.cwd(), 'data', 'runtime', 'global', 'flow-library-manifests', 'flow.utility.lurk.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function main() {
  ensureDir(flowLibraryDir);
  ensureDir(flowManifestDir);

  const pkg = readJson(bundledPackagePath);
  const manifest = readJson(bundledManifestPath);

  const packageOut = path.join(flowLibraryDir, 'flow.utility.lurk.json');
  const manifestOut = path.join(flowManifestDir, 'flow.utility.lurk.json');

  writeJson(packageOut, pkg);
  writeJson(manifestOut, manifest);

  console.log(JSON.stringify({
    ok: true,
    packageOut,
    manifestOut,
    packageId: pkg.packageId,
    packageName: pkg.name,
  }, null, 2));
}

main();
