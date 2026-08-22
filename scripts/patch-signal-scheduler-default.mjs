import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.ts');
const before = fs.readFileSync(serverPath, 'utf8').replace(/\r\n/g, '\n');

const enabledOnly = "if (process.env.SIGNAL_SCHEDULER_ENABLED === 'true') {";
const defaultOn = "if (process.env.SIGNAL_SCHEDULER_ENABLED !== 'false') {";

if (before.includes(defaultOn)) {
  console.log('[SignalSchedulerDefault] already applied');
  process.exit(0);
}
if (!before.includes(enabledOnly)) {
  throw new Error('Signal scheduler startup gate not found; refusing to patch blindly');
}

const after = before.replace(enabledOnly, defaultOn);
fs.writeFileSync(serverPath, after, 'utf8');
console.log('[SignalSchedulerDefault] scheduler now defaults ON unless SIGNAL_SCHEDULER_ENABLED=false');
