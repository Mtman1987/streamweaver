import fs from 'fs';
import path from 'path';

type ArchiverFactory = (format: string, options?: unknown) => {
  pipe: (stream: NodeJS.WritableStream) => void;
  file: (filePath: string, options: { name: string }) => void;
  finalize: () => Promise<void>;
};

const PLUGINS_DIR = path.join(process.cwd(), 'src', 'plugins');
const EXPORTS_DIR = path.join(process.cwd(), 'plugin-exports');

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  tags: string[];
  commands: string[];
  features: string[];
  files: string[];
  setup: string[];
}

export async function exportPlugin(pluginId: string): Promise<string> {
  const archiver = require('archiver') as ArchiverFactory;
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  const manifestPath = path.join(pluginDir, 'plugin.json');
  
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found: ${pluginId}`);
  }
  
  const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const exportPath = path.join(EXPORTS_DIR, `${pluginId}-v${manifest.version}.zip`);
  
  const output = fs.createWriteStream(exportPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.pipe(output);
  
  // Add manifest
  archive.file(manifestPath, { name: 'plugin.json' });
  
  // Add all plugin files
  for (const file of manifest.files) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: file });
    }
  }
  
  await archive.finalize();
  
  return exportPath;
}

export async function importPlugin(zipPath: string): Promise<void> {
  // Extract and install plugin
  // Implementation depends on your needs
  console.log(`[Plugin] Import from ${zipPath} - coming soon`);
}

export function listAvailablePlugins(): PluginManifest[] {
  const plugins: PluginManifest[] = [];
  
  if (!fs.existsSync(PLUGINS_DIR)) return plugins;
  
  const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const dir of dirs) {
    const manifestPath = path.join(PLUGINS_DIR, dir, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      plugins.push(manifest);
    }
  }
  
  return plugins;
}
